import { useCallback, useEffect, useRef, useState } from "react";
import { deriveChat, getStoryRepository, type ChatInput, type ChatState, type Direction, type DirectionOptions, type PlanEdits, type ProjectSummary, type StoryPlan } from "@mosae/core";
import type { DirectorPerson } from "@mosae/core/src/story/repository";
import { confirmCast } from "./characters";
import { useRouter } from "expo-router";

const EMPTY_INPUT: ChatInput = { summary: null, intent: null, people: null, peopleConfirmed: false, plan: null, momentsConfirmed: false, conflict: null, direction: null, generation: null, notes: [] };
const UNCLEAR = "I didn't catch that. Pick one below, or say it another way.";

export function useDirectorChat(projectId: string) {
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
  const planLoad = useRef(false);
  const peopleEdits = useRef(new Map<string, { name: string | null; role: string | null; skipped: boolean }>());
  const skipPeopleForNow = useRef(false);
  const mounted = useRef(true);
  const repository = getStoryRepository();
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
      return { ...person, ...(edit ?? (skipPeopleForNow.current ? { name: "Family", role: "parent", skipped: false } : { skipped: false })) };
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
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Couldn't load this project."));
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  const actions = {
    async confirmOccasion(text?: string) {
      if (saving) return;
      setSaving(true); setError(null);
      const storyText = text ?? pendingInterpret?.text ?? summary?.places.join(", ") ?? "Our story";
      try {
        const result = await repository.createPlan(storyText, []);
        proposalId.current = result.planId;
        setInput((current) => ({ ...current, intent: { text: storyText } }));
        setPendingInterpret(null);
        await refresh();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save this. Please try again."); }
      finally { setSaving(false); }
    },
    async setPerson(personId: string, role: string, name?: string) {
      const people = input.people ?? [];
      const roleValue = role === "My daughter" || role === "My son" ? "child" : role === "Skip" ? "other" : "parent";
      const personName = name ?? (role === "Skip" ? undefined : role);
      peopleEdits.current.set(personId, { name: role === "Skip" ? null : personName ?? null, role: roleValue, skipped: role === "Skip" });
      const updated = people.map((person) => person.personId === personId ? { ...person, role: roleValue, name: personName ?? null, skipped: role === "Skip" } : person);
      try {
        await confirmCast(projectId, { people: updated.map((person) => ({ personId: person.personId, role: person.role as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], ...(proposalId.current ? { proposalId: proposalId.current } : {}) });
        setInput((current) => ({ ...current, people: updated, peopleConfirmed: updated.every((person) => person.name || person.role || person.skipped) }));
        setError(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save this. Please try again."); }
    },
    async skipPeople() {
      skipPeopleForNow.current = true;
      const people = (input.people ?? []).map((person) => ({ ...person, skipped: true }));
      try {
        await confirmCast(projectId, { people: people.map((person) => ({ personId: person.personId, role: "other" as const, excluded: false })), focus: [], ...(proposalId.current ? { proposalId: proposalId.current } : {}) });
        setInput((current) => ({ ...current, people, peopleConfirmed: true })); setError(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save this. Please try again."); }
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
        const mustIncludeMomentIds = [...new Set([...Object.entries(momentState).filter(([, value]) => value === "keep").map(([id]) => id)])];
        const excludedShotIds = Object.entries(momentState).filter(([, value]) => value === "leave").map(([id]) => id);
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
        } else setError(reason.message ?? "Couldn't save your moments. Please try again.");
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
        await repository.directFilm(input.plan.planId, direction);
        setInput((current) => ({ ...current, direction: current.direction ? { ...current.direction, confirmed: true } : current.direction }));
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't start shaping your film. Please try again."); }
      finally { setSaving(false); }
    },
    async send(text: string) {
      if (!summary) return;
      try {
        const step = state.step === "people" || state.step === "moments" || state.step === "direction" ? state.step : "occasion";
        const result = await repository.interpret(projectId, { step, text, context: { summary, people: (input.people ?? []).map(({ personId, name, role }) => ({ personId, name, role })) } });
        if (result.change.kind === "unclear") { setPendingInterpret({ reply: result.reply || UNCLEAR, text }); return; }
        setPendingInterpret({ reply: result.reply, text });
      } catch { setPendingInterpret({ reply: UNCLEAR, text }); }
    },
    confirmInterpret() { if (pendingInterpret) void actions.confirmOccasion(pendingInterpret.text); },
  };
  return { state, actions, error, retry: () => { setError(null); void refresh(); }, pendingInterpret, saving, summary, plan: input.plan, momentState, pickerOpen, directionOptions, people: input.people ?? [], setPickerOpen };
}
