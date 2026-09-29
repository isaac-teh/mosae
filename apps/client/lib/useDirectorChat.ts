import { useCallback, useEffect, useRef, useState } from "react";
import { deriveChat, getStoryRepository, type ChatInput, type ChatState, type Direction, type DirectionOptions, type Film, type PlanEdits, type ProjectSummary, type StoryPlan, type StoryRepository } from "@mosae/core";
import type { DirectorPerson } from "@mosae/core/src/story/repository";
import { confirmCast } from "./characters";
import { useRouter } from "expo-router";

const EMPTY_INPUT: ChatInput = { summary: null, intent: null, people: null, peopleConfirmed: false, plan: null, momentsConfirmed: false, conflict: null, direction: null, generation: null, notes: [] };
const UNCLEAR = "I didn't catch that. Pick one below, or say it another way.";
const REQUEST_FAILURE = "I couldn't do that. Try again?";

function reportFailure(cause: unknown): string {
  const error = cause as { code?: unknown; message?: unknown };
  console.info("Director chat request failed", error?.code ?? error?.message ?? "unknown");
  return REQUEST_FAILURE;
}

export function useDirectorChat(projectId: string, repository: StoryRepository = getStoryRepository(), storyFlow?: { repository: "api" | "fixture"; projectId?: string }) {
  const [input, setInput] = useState<ChatInput>(EMPTY_INPUT);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingInterpret, setPendingInterpret] = useState<{ reply: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [momentState, setMomentState] = useState<Record<string, "keep" | "leave">>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [directionOptions, setDirectionOptions] = useState<DirectionOptions | null>(null);
  const [directionSelection, setDirectionSelection] = useState<{ cadenceId: string; durationId: Direction["durationId"]; soundtrackId: string | null; focus: string }>({ cadenceId: "reflective", durationId: "2m", soundtrackId: null, focus: "family" });
  const proposalId = useRef<string | null>(null);
  const personSaving = useRef(false);
  const planLoad = useRef(false);
  const peopleEdits = useRef(new Map<string, { name: string | null; role: string | null; skipped: boolean }>());
  const skipPeopleForNow = useRef(false);
  const mounted = useRef(true);
  const generationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const state: ChatState = deriveChat(input);

  const loadDirectionOptions = useCallback(async (planId: string) => {
    const options = await repository.getDirectionOptions(planId);
    setDirectionOptions(options);
    const cadenceId = options.recommendedCadence;
    const durationId = options.recommendedDuration;
    const lengthSec = options.durations.find(({ id }) => id === durationId)?.seconds ?? 120;
    setDirectionSelection((current) => ({ ...current, cadenceId, durationId }));
    setInput((current) => ({ ...current, direction: { confirmed: false, pace: /gentle|reflective/i.test(cadenceId) ? "gentle" : "lively", lengthSec, focus: "family" } }));
  }, [repository]);

  const refresh = useCallback(async () => {
    const [nextSummary, people] = await Promise.all([repository.getSummary(projectId), repository.getPeople(projectId)]);
    if (!mounted.current) return;
    setSummary(nextSummary);
    const mapped = people.map((person: DirectorPerson) => {
      const edit = peopleEdits.current.get(person.personId);
      return { ...person, ...(edit ?? (skipPeopleForNow.current ? { name: null, role: null, skipped: true } : { skipped: false })) };
    });
    setInput((current) => ({ ...current, summary: nextSummary, people: nextSummary.ready.faces ? mapped : null, peopleConfirmed: nextSummary.ready.faces && (skipPeopleForNow.current || mapped.length === 0) }));
    if (proposalId.current && nextSummary.ready.plan && !planLoad.current && !input.plan) {
      planLoad.current = true;
      try {
        const plan = await repository.getPlan(proposalId.current);
        if (mounted.current) setInput((current) => ({ ...current, plan }));
      } finally { planLoad.current = false; }
    }
  }, [projectId, repository, input.plan]);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch((cause) => setError(reportFailure(cause)));
    const timer = setInterval(() => { void refresh().catch((cause) => setError(reportFailure(cause))); }, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  useEffect(() => () => { if (generationTimer.current) clearTimeout(generationTimer.current); }, []);

  const pollFilm = useCallback(async (filmId: string) => {
    try {
      const film = await repository.getFilm(filmId);
      if (!mounted.current) return;
      if (film.rendering) {
        const nextStepsDone = Math.max(0, Math.min(2, Math.floor((film.renderProgress ?? 0) * 3)));
        setInput((current) => ({ ...current, generation: { status: "running", stepsDone: nextStepsDone, film: null } }));
        generationTimer.current = setTimeout(() => { void pollFilm(filmId); }, 2000);
      } else {
        setInput((current) => ({ ...current, generation: { status: "done", stepsDone: 3, film } }));
      }
    } catch (cause) {
      if (!mounted.current) return;
      setInput((current) => ({ ...current, generation: { status: "failed", stepsDone: 0, film: null } }));
      setError(reportFailure(cause));
    }
  }, [repository]);

  const actions = {
    async confirmOccasion(answer?: string, storyTextOverride?: string) {
      if (saving) return;
      setSaving(true); setError(null);
      const storyText = storyTextOverride ?? answer ?? pendingInterpret?.text ?? (summary?.country ? `${summary.country} trip` : summary?.places[0] || "Our story");
      try {
        const result = await repository.createPlan(storyText, []);
        proposalId.current = result.planId;
        setInput((current) => ({ ...current, intent: { text: answer ?? storyText } }));
        setPendingInterpret(null);
        await refresh();
      } catch (cause) { setError(reportFailure(cause)); }
      finally { setSaving(false); }
    },
    async setPerson(personId: string, role: string, name?: string) {
      if (personSaving.current) return;
      personSaving.current = true;
      const people = input.people ?? [];
      const roleValue = role === "My daughter" || role === "My son" ? "child" : role === "Skip" ? "other" : "parent";
      const personName = name ?? (role === "Skip" ? undefined : role);
      peopleEdits.current.set(personId, { name: role === "Skip" ? null : personName ?? null, role: roleValue, skipped: role === "Skip" });
      const updated = people.map((person) => person.personId === personId ? { ...person, role: roleValue, name: personName ?? null, skipped: role === "Skip" } : person);
      try {
        const result = await confirmCast(projectId, { people: updated.map((person) => ({ personId: person.personId, role: person.role as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
        const revisedPlan = result.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
        if (result.proposalId) proposalId.current = result.proposalId;
        setInput((current) => ({ ...current, people: updated, ...(revisedPlan ? { plan: revisedPlan } : {}), peopleConfirmed: false }));
        setError(null);
      } catch (cause) { setError(reportFailure(cause)); }
      finally { personSaving.current = false; }
    },
    async skipPeople() {
      if (personSaving.current) return;
      personSaving.current = true;
      skipPeopleForNow.current = true;
      const people = (input.people ?? []).map((person) => ({ ...person, skipped: true }));
      try {
        const result = await confirmCast(projectId, { people: people.map((person) => ({ personId: person.personId, role: "other" as const, excluded: false })), focus: [], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
        const revisedPlan = result.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
        if (result.proposalId) proposalId.current = result.proposalId;
        setInput((current) => ({ ...current, people, ...(revisedPlan ? { plan: revisedPlan } : {}), peopleConfirmed: true })); setError(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save this. Please try again."); }
      finally { personSaving.current = false; }
    },
    toggleMoment(shotId: string) {
      setMomentState((current) => {
        const next = { ...current };
        if (!current[shotId]) next[shotId] = "keep";
        else if (current[shotId] === "keep") next[shotId] = "leave";
        else delete next[shotId];
        return next;
      });
    },
    async confirmMoments() {
      if (!input.plan || saving) return;
      setSaving(true); setError(null);
      try {
        const momentIdsByShot = new Map(input.plan.moments.map((moment) => [moment.shotId ?? moment.id, moment.id]));
        const mustIncludeMomentIds = [...new Set(Object.entries(momentState)
          .filter(([, value]) => value === "keep")
          .map(([shotId]) => momentIdsByShot.get(shotId))
          .filter((momentId): momentId is string => Boolean(momentId)))];
        const keptShotIds = new Set(Object.entries(momentState).filter(([, value]) => value === "keep").map(([shotId]) => shotId));
        const excludedShotIds = [...new Set([...(input.plan.edits?.excludedShotIds ?? []), ...Object.entries(momentState).filter(([, value]) => value === "leave").map(([id]) => id)])].filter((id) => !keptShotIds.has(id));
        const edits = { ...(input.plan.edits ?? { deselectedMomentIds: [], mustIncludeMomentIds: [], hiddenShotIds: [], momentOrder: [], photoSwaps: {} }), mustIncludeMomentIds, excludedShotIds } as PlanEdits;
        const updated = await repository.applyEdits(input.plan.planId, edits);
        setInput((current) => ({ ...current, plan: updated, momentsConfirmed: true, conflict: null }));
        await loadDirectionOptions(updated.planId);
      } catch (cause) {
        const reason = cause as { status?: number; message?: string; code?: string };
        if (reason.status === 409) {
          const message = reason.code === "stale_proposal" ? "Your plan changed while you were picking moments. Keep these choices and try again?" : reason.message ?? "These moment choices conflict. Which should stay in the film?";
          setInput((current) => ({ ...current, momentsConfirmed: false, conflict: { shotIds: Object.entries(momentState).filter(([, value]) => value === "keep" || value === "leave").map(([id]) => id), message } }));
          setError(null);
        } else setError(reportFailure(cause));
      } finally { setSaving(false); }
    },
    openPicker() { setPickerOpen(true); },
    async confirmPicker(shotIds: string[]) {
      setMomentState((current) => ({ ...current, ...Object.fromEntries(shotIds.map((id) => [id, "keep" as const])) }));
      setPickerOpen(false);
      // Picker selection is staged; Done sends all inline and sheet choices together.
    },
    seeSetAside() {
      if (!input.plan) return;
      router.push({ pathname: "/review-moments", params: { planId: input.plan.planId, tab: "left-out" } } as any);
    },
    resolveConflict(choice: "keep" | "leave") {
      const shotIds = input.conflict?.shotIds ?? [];
      setMomentState((current) => ({ ...current, ...Object.fromEntries(shotIds.map((id) => [id, choice])) }));
      setInput((current) => ({ ...current, conflict: null }));
    },
    setDirection(patch: { pace?: "gentle" | "lively"; lengthSec?: number; focus?: string }) {
      setInput((current) => ({ ...current, direction: current.direction ? { ...current.direction, ...patch } : { confirmed: false, pace: patch.pace ?? "gentle", lengthSec: patch.lengthSec ?? 120, focus: patch.focus ?? "family" } }));
      setDirectionSelection((current) => {
        const next = { ...current };
        if (patch.pace) next.cadenceId = directionOptions?.cadences.find((cadence) => /gentle|reflective/i.test(`${cadence.id} ${cadence.name}`) === (patch.pace === "gentle"))?.id ?? current.cadenceId;
        if (patch.lengthSec) next.durationId = directionOptions?.durations.find(({ seconds }) => seconds === patch.lengthSec)?.id ?? directionOptions?.durations.reduce((closest, option) => Math.abs(option.seconds - patch.lengthSec!) < Math.abs(closest.seconds - patch.lengthSec!) ? option : closest, directionOptions.durations[0]!)?.id ?? current.durationId;
        if (patch.focus) next.focus = patch.focus;
        return next;
      });
    },
    async shapeIt() {
      if (!input.plan || !input.direction) return;
      setSaving(true); setError(null);
      try {
        const focusLabel = directionSelection.focus === "family" ? "Whole family" : input.people?.find(({ personId }) => personId === directionSelection.focus)?.name ?? "Her reactions";
        const direction: Direction & { focus: string } = { note: `${directionOptions?.note ?? ""}${directionOptions?.note ? "\n" : ""}Focus: ${focusLabel}.`, cadenceId: directionSelection.cadenceId, soundtrackId: directionSelection.soundtrackId, durationId: directionSelection.durationId, focus: directionSelection.focus };
        setInput((current) => ({ ...current, direction: current.direction ? { ...current.direction, confirmed: true } : current.direction, generation: { status: "queued", stepsDone: 0, film: null } }));
        const { filmId } = await repository.directFilm(input.plan.planId, direction);
        if (mounted.current) { setInput((current) => ({ ...current, generation: { status: "running", stepsDone: 0, film: null } })); void pollFilm(filmId); }
      } catch (cause) {
        setInput((current) => ({ ...current, generation: { status: "failed", stepsDone: 0, film: null } }));
        setError(reportFailure(cause));
      }
      finally { setSaving(false); }
    },
    async saveFilm() {
      const film = input.generation?.film;
      if (!film || saving) return;
      setSaving(true); setError(null);
      try {
        await repository.saveFilm(film.filmId);
        router.push({ pathname: "/save-film", params: { filmId: film.filmId, directorChat: "true", ...(storyFlow ?? {}) } } as any);
      } catch (cause) { setError(reportFailure(cause)); }
      finally { setSaving(false); }
    },
    askForChange(text: string) {
      const film = input.generation?.film;
      if (!film || !text.trim()) return;
      router.push({ pathname: "/editor", params: { projectId: projectId || "fixture", planId: film.planId, generationId: film.filmId, request: text.trim(), ...(storyFlow ?? {}) } } as any);
    },
    async send(text: string) {
      if (!summary) return;
      try {
        const step = state.step === "people" || state.step === "moments" || state.step === "direction" ? state.step : "occasion";
        const result = await repository.interpret(projectId, { step, text, context: { summary, people: (input.people ?? []).map(({ personId, name, role }) => ({ personId, name, role })) } });
        if (result.change.kind === "unclear") { setPendingInterpret({ reply: result.reply || UNCLEAR, text }); return; }
        setPendingInterpret({ reply: result.reply, text });
      } catch (cause) { setError(reportFailure(cause)); }
    },
    confirmInterpret() { if (pendingInterpret) void actions.confirmOccasion(pendingInterpret.text); },
  };
  return { state, actions, error, retry: () => { setError(null); void refresh(); }, pendingInterpret, saving, summary, plan: input.plan, momentState, pickerOpen, directionOptions, people: input.people ?? [], setPickerOpen };
}
