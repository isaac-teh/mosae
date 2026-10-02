import { useCallback, useEffect, useRef, useState } from "react";
import { deriveChat, getSetAsideSummary, getStoryRepository, type ChatInput, type ChatState, type Direction, type DirectionOptions, type Film, type ProjectSummary, type StoryPlan, type StoryRepository } from "@mosae/core";
import type { DirectorPerson } from "@mosae/core/src/story/repository";
import { confirmCast } from "./characters";
import { mapShapingProgress } from "./shapingProgress";
import { useRouter } from "expo-router";

const EMPTY_INPUT: ChatInput = { summary: null, intent: null, people: null, peopleConfirmed: false, plan: null, momentsConfirmed: false, conflict: null, direction: null, generation: null, notes: [] };
const UNCLEAR = "I didn't catch that. Pick one below, or say it another way.";
const REQUEST_FAILURE = "I couldn't do that. Try again?";

function reportFailure(cause: unknown): string {
  const error = cause as { code?: unknown; message?: unknown };
  if (error?.code === "demo_limit_reached") return "Demo limit reached — try the options";
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
  const [directionOptions, setDirectionOptions] = useState<DirectionOptions | null>(null);
  const [directionSelection, setDirectionSelection] = useState<{ cadenceId: string; durationId: Direction["durationId"]; soundtrackId: string | null; focus: string; collageAmount: "few" | "lots" | "none"; motionFeel: "calm" | "playful" }>({ cadenceId: "reflective", durationId: "2m", soundtrackId: null, focus: "family", collageAmount: "few", motionFeel: "calm" });
  const proposalId = useRef<string | null>(null);
  const personSaving = useRef(false);
  const planLoad = useRef(false);
  const planFailed = useRef(false);
  const resumeProjectId = useRef<string | null>(null);
  const peopleEdits = useRef(new Map<string, { name: string | null; role: string | null; skipped: boolean }>());
  const skipPeopleForNow = useRef(false);
  const mounted = useRef(true);
  const generationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFilmRef = useRef<(filmId: string) => void>(() => {});
  const compositionStartedAt = useRef<number | null>(null);
  const router = useRouter();
  const state: ChatState = deriveChat(input);

  const loadDirectionOptions = useCallback(async (planId: string) => {
    const options = await repository.getDirectionOptions(planId);
    setDirectionOptions(options);
    const cadenceId = options.recommendedCadence;
    const maximumDurationSec = options.maximumDurationSecByCadence?.[cadenceId] ?? options.maximumDurationSec ?? Infinity;
    const availableDurations = options.durations.filter(({ seconds }) => seconds <= maximumDurationSec);
    const duration = availableDurations.find(({ id }) => id === options.recommendedDuration) ?? availableDurations.at(-1) ?? options.durations.find(({ id }) => id === options.recommendedDuration);
    const durationId = duration?.id ?? options.recommendedDuration;
    const lengthSec = duration?.seconds ?? 120;
    setDirectionSelection((current) => ({ ...current, cadenceId, durationId, soundtrackId: current.soundtrackId ?? options.soundtracks[0]?.id ?? null, collageAmount: options.collageAmount ?? current.collageAmount, motionFeel: options.motionFeel ?? current.motionFeel }));
    setInput((current) => ({ ...current, directionNote: options.note, direction: { confirmed: false, pace: /gentle|reflective/i.test(cadenceId) ? "gentle" : "lively", lengthSec, focus: "family" } }));
  }, [repository]);

  const refresh = useCallback(async () => {
    if (planFailed.current) return;
    const [nextSummary, people] = await Promise.all([repository.getSummary(projectId), repository.getPeople(projectId)]);
    if (!mounted.current) return;
    setSummary(nextSummary);
    const mapped = people?.map((person: DirectorPerson) => {
      const edit = peopleEdits.current.get(person.personId);
      return { ...person, ...(edit ?? (skipPeopleForNow.current ? { name: null, role: null, skipped: true } : { skipped: false })) };
    }) ?? null;
    if (resumeProjectId.current !== projectId) {
      resumeProjectId.current = projectId;
      try {
        const resume = repository.getProjectResume
          ? await repository.getProjectResume(projectId)
          : { proposalId: null, storyText: null, generationId: null, generationStatus: null };
        if (!mounted.current) return;
        proposalId.current = resume.proposalId;
        const [plan, film] = await Promise.all([
          resume.proposalId ? repository.getPlan(resume.proposalId).catch(() => null) : Promise.resolve(null),
          resume.generationId ? repository.getFilm(resume.generationId).catch(() => null) : Promise.resolve(null),
        ]);
        if (!mounted.current) return;
        const confirmedStory = resume.storyText ?? (nextSummary.country ? `Yes, our ${nextSummary.country} trip` : `Yes, that's our story`);
        const hasGeneration = Boolean(resume.generationId && film);
        const setAside = getSetAsideSummary(plan);
        const needsFilteredPhotoReview = setAside.blurry + setAside.duplicates > 0;
        const isFilmReady = resume.generationStatus === "playable" || resume.generationStatus === "rendering" || resume.generationStatus === "saved";
        const generation = hasGeneration ? isFilmReady
          ? { status: "done" as const, stage: resume.generationStatus!, progress: 1, stepsDone: 3, film }
          : { status: "running" as const, stage: resume.generationStatus === "rendering" ? "rendering" as const : "composing" as const, progress: 0, stepsDone: 2, film: null }
          : null;
        setInput((current) => ({
          ...current,
          summary: nextSummary,
          intent: resume.proposalId || hasGeneration ? { text: confirmedStory } : current.intent,
          people: nextSummary.ready.faces ? mapped : null,
          peopleConfirmed: Boolean(resume.proposalId || hasGeneration) || (nextSummary.ready.faces && mapped !== null && (skipPeopleForNow.current || mapped.length === 0)),
          plan,
          momentsConfirmed: hasGeneration || Boolean(plan && !needsFilteredPhotoReview),
          direction: hasGeneration ? { confirmed: true, pace: "gentle", lengthSec: Math.max(30, film?.durationSec ?? 120), focus: "family", collageAmount: "few", motionFeel: "calm" } : null,
          generation,
        }));
        if (plan && !hasGeneration && !needsFilteredPhotoReview) await loadDirectionOptions(plan.planId);
        if (resume.generationId && hasGeneration && !isFilmReady) void pollFilmRef.current(resume.generationId);
      } catch (cause) {
        resumeProjectId.current = null;
        throw cause;
      }
      return;
    }
    setInput((current) => ({ ...current, summary: nextSummary, people: nextSummary.ready.faces ? mapped : null, peopleConfirmed: current.peopleConfirmed || (nextSummary.ready.faces && mapped !== null && (skipPeopleForNow.current || mapped.length === 0)) }));
    if (proposalId.current && nextSummary.ready.plan && !planLoad.current && !input.plan) {
      planLoad.current = true;
      try {
        const plan = await repository.getPlan(proposalId.current);
        if (mounted.current) {
          const setAside = getSetAsideSummary(plan);
          const needsFilteredPhotoReview = setAside.blurry + setAside.duplicates > 0;
          setInput((current) => ({ ...current, plan, momentsConfirmed: !needsFilteredPhotoReview }));
          if (!needsFilteredPhotoReview) await loadDirectionOptions(plan.planId);
        }
      } finally { planLoad.current = false; }
    }
  }, [projectId, repository, input.plan, loadDirectionOptions]);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch((cause) => setError(reportFailure(cause)));
    const timer = setInterval(() => { void refresh().catch((cause) => setError(reportFailure(cause))); }, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  useEffect(() => () => { if (generationTimer.current) clearTimeout(generationTimer.current); }, []);

  useEffect(() => {
    const generation = input.generation;
    if (!generation || generation.status === "done" || generation.status === "failed" || (generation.stage !== "queued" && generation.stage !== "composing")) return;
    const timer = setInterval(() => {
      const startedAt = compositionStartedAt.current;
      const compositionProgress = startedAt === null ? 0 : Math.min(1, (Date.now() - startedAt) / 30_000);
      const mapped = mapShapingProgress(generation.stage, 0, compositionProgress);
      setInput((current) => {
        if (!current.generation || current.generation.status === "done" || current.generation.status === "failed") return current;
        return { ...current, generation: { ...current.generation, progress: Math.max(current.generation.progress, mapped.progress) } };
      });
    }, 100);
    return () => clearInterval(timer);
  }, [input.generation?.status, input.generation?.stage]);

  const pollFilm = useCallback(async (filmId: string) => {
    try {
      const film = await repository.getFilm(filmId);
      if (!mounted.current) return;
      if (film.rendering) {
        const stage = film.generationStatus ?? "rendering";
        const compositionProgress = stage === "composing"
          ? Math.min(1, (Date.now() - (compositionStartedAt.current ?? Date.now())) / 30_000)
          : 0;
        const mapped = mapShapingProgress(stage, film.renderProgress ?? 0, compositionProgress);
        setInput((current) => ({ ...current, generation: {
          status: "running",
          stage,
          progress: Math.max(current.generation?.progress ?? 0, mapped.progress),
          stepsDone: Math.max(current.generation?.stepsDone ?? 0, mapped.stepsDone),
          film: null,
        } }));
        generationTimer.current = setTimeout(() => { void pollFilm(filmId); }, 1500);
      } else {
        setInput((current) => ({ ...current, generation: { status: "done", stage: film.generationStatus === "saved" ? "saved" : "playable", progress: 1, stepsDone: 3, film } }));
      }
    } catch (cause) {
      if (!mounted.current) return;
      setInput((current) => ({ ...current, generation: { status: "failed", stage: "failed", progress: current.generation?.progress ?? 0, stepsDone: current.generation?.stepsDone ?? 0, film: null } }));
      setError(reportFailure(cause));
    }
  }, [repository]);
  pollFilmRef.current = (filmId) => { void pollFilm(filmId); };

  const actions = {
    async confirmOccasion(answer?: string, storyTextOverride?: string) {
      if (saving) return;
      planFailed.current = false;
      setSaving(true); setError(null);
      const storyText = storyTextOverride ?? answer ?? pendingInterpret?.text ?? (summary?.country ? `${summary.country} trip` : summary?.places[0] || "Our story");
      try {
        const result = await repository.createPlan(storyText, []);
        proposalId.current = result.planId;
        setInput((current) => ({ ...current, intent: { text: answer ?? storyText } }));
        setPendingInterpret(null);
        await refresh();
      } catch (cause) { planFailed.current = true; reportFailure(cause); setError("I couldn't shape this one. Try again."); }
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
    async confirmMoments() {
      if (!input.plan || saving) return;
      setSaving(true); setError(null);
      try {
        setInput((current) => ({ ...current, momentsConfirmed: true, conflict: null }));
        await loadDirectionOptions(input.plan.planId);
      } catch (cause) {
        setError(reportFailure(cause));
      } finally { setSaving(false); }
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
    setDirection(patch: { pace?: "gentle" | "lively"; lengthSec?: number; focus?: string; collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful" }) {
      const next = { ...directionSelection };
      if (patch.pace) next.cadenceId = directionOptions?.cadences.find((cadence) => /gentle|reflective/i.test(`${cadence.id} ${cadence.name}`) === (patch.pace === "gentle"))?.id ?? next.cadenceId;
      if (patch.lengthSec) next.durationId = directionOptions?.durations.find(({ seconds }) => seconds === patch.lengthSec)?.id ?? directionOptions?.durations.reduce((closest, option) => Math.abs(option.seconds - patch.lengthSec!) < Math.abs(closest.seconds - patch.lengthSec!) ? option : closest, directionOptions.durations[0]!)?.id ?? next.durationId;
      if (patch.focus) next.focus = patch.focus;
      if (patch.collageAmount) next.collageAmount = patch.collageAmount;
      if (patch.motionFeel) next.motionFeel = patch.motionFeel;
      const maximumDurationSec = directionOptions?.maximumDurationSecByCadence?.[next.cadenceId] ?? directionOptions?.maximumDurationSec ?? Infinity;
      const availableDurations = directionOptions?.durations.filter(({ seconds }) => seconds <= maximumDurationSec) ?? [];
      const selectedDuration = availableDurations.find(({ id }) => id === next.durationId) ?? availableDurations.at(-1);
      if (selectedDuration) next.durationId = selectedDuration.id;
      setDirectionSelection(next);
      setInput((current) => ({ ...current, direction: current.direction
        ? { ...current.direction, ...patch, ...(selectedDuration ? { lengthSec: selectedDuration.seconds } : {}) }
        : { confirmed: false, pace: patch.pace ?? "gentle", lengthSec: selectedDuration?.seconds ?? patch.lengthSec ?? 120, focus: patch.focus ?? "family" } }));
    },
    async shapeIt() {
      if (!input.plan || !input.direction) return;
      setSaving(true); setError(null);
      try {
        const focusLabel = directionSelection.focus === "family" ? "Whole family" : input.people?.find(({ personId }) => personId === directionSelection.focus)?.name ?? "Her reactions";
        const direction: Direction & { focus: string } = { note: `${directionOptions?.note ?? ""}${directionOptions?.note ? "\n" : ""}Focus: ${focusLabel}.`, cadenceId: directionSelection.cadenceId, soundtrackId: directionSelection.soundtrackId, durationId: directionSelection.durationId, focus: directionSelection.focus, collageAmount: directionSelection.collageAmount, motionFeel: directionSelection.motionFeel };
        compositionStartedAt.current = Date.now();
        setInput((current) => ({ ...current, direction: current.direction ? { ...current.direction, confirmed: true } : current.direction, generation: { status: "queued", stage: "queued", progress: 0, stepsDone: 0, film: null } }));
        const { filmId } = await repository.directFilm(input.plan.planId, direction);
        if (mounted.current) { setInput((current) => ({ ...current, generation: current.generation ? { ...current.generation, status: "running", stage: "composing" } : current.generation })); void pollFilm(filmId); }
      } catch (cause) {
        setInput((current) => ({ ...current, generation: { status: "failed", stage: "failed", progress: current.generation?.progress ?? 0, stepsDone: current.generation?.stepsDone ?? 0, film: null } }));
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
    discardInterpret() { setPendingInterpret(null); },
  };
  return { state, actions, error, retry: () => { setError(null); void refresh(); }, pendingInterpret, saving, summary, plan: input.plan, directionOptions, directionSelection, people: input.people ?? [] };
}
