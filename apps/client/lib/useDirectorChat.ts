import { useCallback, useEffect, useRef, useState as useReactState, type Dispatch, type SetStateAction, type MutableRefObject } from "react";
import { directionFocus, deriveChat, canConfirmStory, getSetAsideSummary, getStoryRepository, matchExistingPersonAnswer, type ChatInput, type ChatState, type Direction, type DirectionOptions, type DurationChoice, type Film, type ProjectSummary, type StoryPlan, type StoryRepository } from "@mosae/core";
import type { DirectorPerson } from "@mosae/core/src/story/repository";
import { confirmCast } from "./characters";
import { mapShapingProgress } from "./shapingProgress";
import { useRouter } from "expo-router";

const EMPTY_INPUT: ChatInput = { summary: null, intent: null, people: null, peopleConfirmed: false, plan: null, momentsConfirmed: false, conflict: null, direction: null, generation: null, notes: [] };
const UNCLEAR = "I didn't catch that. Pick one below, or say it another way.";
const REQUEST_FAILURE = "I couldn't do that. Try again?";

export function defaultSoundtrackId(currentId: string | null, soundtracks: DirectionOptions["soundtracks"]): string | null {
  return currentId ?? soundtracks.find(({ suggested }) => suggested)?.id ?? soundtracks[0]?.id ?? null;
}

function reportFailure(cause: unknown): string {
  const error = cause as { code?: unknown; message?: unknown };
  if (error?.code === "demo_limit_reached") return "Demo limit reached — try the options";
  console.info("Director chat request failed", error?.code ?? error?.message ?? "unknown");
  return REQUEST_FAILURE;
}

function mergeSummary(current: ProjectSummary | null, next: ProjectSummary): ProjectSummary {
  if (!current) return next;
  return { ...current, ...next,
    flowRevision: Math.max(current.flowRevision ?? 0, next.flowRevision ?? 0),
    processed: { ingested: Math.max(current.processed.ingested, next.processed.ingested), understood: Math.max(current.processed.understood, next.processed.understood), faces: Math.max(current.processed.faces, next.processed.faces) },
    ready: { ...next.ready, summary: current.ready.summary || next.ready.summary, faces: current.ready.faces || next.ready.faces, story: current.ready.story || next.ready.story, plan: current.ready.plan || next.ready.plan, film: current.ready.film || next.ready.film },
  };
}

export function durationsForCadence(options: DirectionOptions, cadenceId: string): DurationChoice[] {
  const maximum = options.maximumDurationSecByCadence?.[cadenceId] ?? options.maximumDurationSec ?? Infinity;
  const standard = options.durations.filter(({ id, seconds }) => id !== "short" && seconds <= maximum);
  if (standard.length) return standard;
  const shortSeconds = Number.isFinite(maximum) ? Math.min(20, Math.round(maximum)) : 0;
  if (shortSeconds < 3) return [];
  const serverShort = options.durations.find(({ id }) => id === "short");
  return [{ id: "short", label: serverShort?.label ?? "Short", caption: `About ${shortSeconds} seconds`, seconds: shortSeconds }];
}

function useProjectState<T>(epochRef: MutableRefObject<number>, epoch: number, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [stored, setStored] = useReactState({ epoch, value: initial });
  if (stored.epoch !== epoch) setStored({ epoch, value: initial });
  const value = stored.epoch === epoch ? stored.value : initial;
  return [value, (update) => {
    if (epochRef.current !== epoch) return;
    setStored(current => epochRef.current !== epoch ? current : ({ epoch, value: typeof update === "function" ? (update as (value: T) => T)(current.epoch === epoch ? current.value : initial) : update }));
  }];
}

export function useDirectorChat(projectId: string, repository: StoryRepository = getStoryRepository(), storyFlow?: { repository: "api" | "fixture"; projectId?: string }, localState: Pick<ChatInput, "localMediaPending" | "uploadFailuresAcknowledged" | "localUpload"> & { taggedPerson?: ChatInput["taggedPerson"]; taggedMomentCount?: number } = {}) {
  const projectIdentity = useRef(projectId);
  const projectEpoch = useRef(0);
  if (projectIdentity.current !== projectId) { projectIdentity.current = projectId; projectEpoch.current++; }
  const currentProjectEpoch = projectEpoch.current;
  const isCurrentProject = () => projectEpoch.current === currentProjectEpoch && projectIdentity.current === projectId;
  const [input, setInput] = useProjectState<ChatInput>(projectEpoch, currentProjectEpoch, EMPTY_INPUT);
  const [resumeLoaded, setResumeLoaded] = useProjectState(projectEpoch, currentProjectEpoch, false);
  const [summary, setSummary] = useProjectState<ProjectSummary | null>(projectEpoch, currentProjectEpoch, null);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const [error, setError] = useProjectState<string | null>(projectEpoch, currentProjectEpoch, null);
  const [pendingInterpret, setPendingInterpret] = useProjectState<{ reply: string; text: string; mentionedPeople?: string[]; storySummary?: string; change?: { kind: string; personId?: string | null; name?: string; role?: string } } | null>(projectEpoch, currentProjectEpoch, null);
  const [saving, setSaving] = useProjectState(projectEpoch, currentProjectEpoch, false);
  const [momentState, setMomentState] = useProjectState<Record<string, "keep" | "leave">>(projectEpoch, currentProjectEpoch, {});
  const [directionOptions, setDirectionOptions] = useProjectState<DirectionOptions | null>(projectEpoch, currentProjectEpoch, null);
  const [directionSelection, setDirectionSelection] = useProjectState<{ cadenceId: string; durationId: Direction["durationId"]; durationSec?: number; soundtrackId: string | null; soundtrackExplicit: boolean; focus: string; collageAmount: "few" | "lots" | "none"; motionFeel: "calm" | "playful"; aspect: "9:16" | "16:9" }>(projectEpoch, currentProjectEpoch, { cadenceId: "reflective", durationId: "2m", soundtrackId: null, soundtrackExplicit: false, focus: "family", collageAmount: "few", motionFeel: "calm", aspect: "9:16" });
  const [aspectSelectedByUser, setAspectSelectedByUser] = useProjectState(projectEpoch, currentProjectEpoch, false);
  const effectiveAspect = aspectSelectedByUser ? directionSelection.aspect : summary?.orientation?.suggested ?? "9:16";
  const directionSelectionRef = useRef(directionSelection);
  directionSelectionRef.current = directionSelection;
  const [focusExplicit, setFocusExplicit] = useProjectState(projectEpoch, currentProjectEpoch, false);
  const resolvedFocus = directionFocus(input.people, directionSelection.focus, focusExplicit);
  const peopleRef = useRef(input.people);
  peopleRef.current = input.people;
  const focusChoiceRef = useRef({ selected: directionSelection.focus, explicit: focusExplicit });
  focusChoiceRef.current = { selected: directionSelection.focus, explicit: focusExplicit };
  useEffect(() => {
    setDirectionSelection(current => current.focus === resolvedFocus.selected ? current : { ...current, focus: resolvedFocus.selected });
    setInput(current => !current.direction || current.direction.focus === resolvedFocus.selected ? current : { ...current, direction: { ...current.direction, focus: resolvedFocus.selected } });
  }, [resolvedFocus.selected, currentProjectEpoch]);
  const currentPlan = useRef(input.plan);
  currentPlan.current = input.plan;
  const proposalId = useRef<string | null>(null);
  const personSaving = useRef(false);
  const occasionSaving = useRef(false);
  const interpretInFlight = useRef(false);
  const generationSaving = useRef(false);
  const compositionRetryAvailable = useRef(false);
  const planLoad = useRef(false);
  const planFailed = useRef(false);
  const planWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeProjectId = useRef<string | null>(null);
  const peopleEdits = useRef(new Map<string, { name: string | null; role: string | null; skipped: boolean }>());
  const personTagCounts = useRef(new Map<string, number>());
  const taggedPersonRef = useRef<ChatInput["taggedPerson"]>(localState.taggedPerson);
  if (localState.taggedPerson && localState.taggedMomentCount !== undefined) personTagCounts.current.set(localState.taggedPerson.personId, localState.taggedMomentCount);
  const flowRevision = useRef(0);
  const flowSnapshot = useRef(input.flow);
  const actionSequence = useRef(0);
  const skipPeopleForNow = useRef(false);
  const mounted = useRef(true);
  const generationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFilmId = useRef<string | null>(null);
  const filmReadPending = useRef(false);
  const pendingDirectionOptions = useRef<string | null>(null);
  const directionOptionsLoading = useRef(false);
  const pollFilmRef = useRef<(filmId: string) => void>(() => {});
  const compositionStartedAt = useRef<number | null>(null);
  const router = useRouter();
  const resetEpoch = useRef(currentProjectEpoch);
  const refreshRequest = useRef(0);
  const uploadEpoch = useRef(0);
  const previousLocalPending = useRef(Boolean(localState.localMediaPending));
  const acceptedSummaryEpoch = useRef(-1);
  if (resetEpoch.current !== currentProjectEpoch) {
    resetEpoch.current = currentProjectEpoch;
    uploadEpoch.current++;
    acceptedSummaryEpoch.current = -1;
    proposalId.current = null;
    personSaving.current = false;
    occasionSaving.current = false;
    generationSaving.current = false;
    planLoad.current = false;
    planFailed.current = false;
    if (planWaitTimer.current) clearTimeout(planWaitTimer.current);
    planWaitTimer.current = null;
    resumeProjectId.current = null;
    peopleEdits.current.clear();
    personTagCounts.current.clear();
    taggedPersonRef.current = undefined;
    flowRevision.current = 0;
    flowSnapshot.current = undefined;
    actionSequence.current = 0;
    skipPeopleForNow.current = false;
    compositionStartedAt.current = null;
    activeFilmId.current = null;
    filmReadPending.current = false;
    pendingDirectionOptions.current = null;
    directionOptionsLoading.current = false;
    if (generationTimer.current) clearTimeout(generationTimer.current);
    generationTimer.current = null;
  }
  if (previousLocalPending.current !== Boolean(localState.localMediaPending)) {
    uploadEpoch.current++;
    previousLocalPending.current = Boolean(localState.localMediaPending);
  }
  const confirmationState = { ...localState, localMediaPending: Boolean(localState.localMediaPending) || acceptedSummaryEpoch.current !== uploadEpoch.current };
  const derivedState: ChatState = deriveChat({ ...input, ...(input.direction ? { direction: { ...input.direction, aspect: effectiveAspect } } : {}), ...confirmationState });
  const state: ChatState = resumeLoaded ? derivedState : { items: [{ kind: "typing", id: "resume-loading", text: "Loading your story" }], step: "occasion", confirmed: 0, placeholder: "" };

  const loadDirectionOptions = useCallback(async (planId: string, stillValid: () => boolean = isCurrentProject, preserveSelection = false) => {
    const options = await repository.getDirectionOptions(planId).catch(cause => {
      if (isCurrentProject() && stillValid()) throw cause;
      return null;
    });
    if (!options || !isCurrentProject() || !stillValid()) return;
    setDirectionOptions(options);
    const selected = directionSelectionRef.current;
    const cadenceId = preserveSelection && options.cadences.some(({ id }) => id === selected.cadenceId) ? selected.cadenceId : options.recommendedCadence;
    const availableDurations = durationsForCadence(options, cadenceId);
    const duration = (preserveSelection ? availableDurations.find(({ id }) => id === selected.durationId) : undefined) ?? availableDurations.find(({ id }) => id === options.recommendedDuration) ?? availableDurations.at(-1) ?? options.durations.find(({ id }) => id === options.recommendedDuration);
    const durationId = duration?.id ?? options.recommendedDuration;
    const lengthSec = duration?.seconds ?? 120;
    const focus = directionFocus(peopleRef.current, focusChoiceRef.current.selected, focusChoiceRef.current.explicit).selected;
    setDirectionSelection((current) => ({ ...current, focus, cadenceId, durationId, ...(durationId === "short" ? { durationSec: lengthSec } : { durationSec: undefined }), soundtrackId: defaultSoundtrackId(current.soundtrackId, options.soundtracks), collageAmount: preserveSelection ? current.collageAmount : options.collageAmount ?? current.collageAmount, motionFeel: preserveSelection ? current.motionFeel : options.motionFeel ?? current.motionFeel }));
    setInput((current) => ({ ...current, directionNote: options.recommendation ?? "For these moments, I’d suggest this.", direction: { confirmed: false, pace: /gentle|reflective/i.test(cadenceId) ? "gentle" : "lively", lengthSec, focus } }));
  }, [repository, projectId, currentProjectEpoch]);

  const recoverDirectionOptions = useCallback(async (planId: string) => {
    if (directionOptionsLoading.current || !isCurrentProject()) return;
    directionOptionsLoading.current = true;
    pendingDirectionOptions.current = planId;
    try {
      await loadDirectionOptions(planId, () => mounted.current && isCurrentProject(), true);
      if (mounted.current && isCurrentProject()) { pendingDirectionOptions.current = null; setError(null); }
    } catch (cause) {
      if (mounted.current && isCurrentProject()) setError(reportFailure(cause));
    } finally {
      if (isCurrentProject()) directionOptionsLoading.current = false;
    }
  }, [loadDirectionOptions, projectId, currentProjectEpoch]);

  const refresh = useCallback(async () => {
    if (planFailed.current) return;
    const refreshEpoch = uploadEpoch.current;
    const requestId = ++refreshRequest.current;
    const stillValid = () => mounted.current && isCurrentProject() && refreshEpoch === uploadEpoch.current && requestId === refreshRequest.current;
    const startedWhilePending = previousLocalPending.current;
    const result = await Promise.all([repository.getSummary(projectId), repository.getPeople(projectId), repository.getFlow?.(projectId) ?? Promise.resolve(null)]).catch(cause => {
      if (stillValid()) throw cause;
      return null;
    });
    if (!result || !stillValid()) return;
    const [nextSummary, people, nextFlow] = result;
    const acceptedFlow = nextFlow && nextFlow.revision >= flowRevision.current ? nextFlow : flowSnapshot.current;
    if (acceptedFlow) { flowRevision.current = Math.max(flowRevision.current, acceptedFlow.revision); flowSnapshot.current = acceptedFlow; }
    if (!startedWhilePending && !previousLocalPending.current && refreshEpoch === uploadEpoch.current) acceptedSummaryEpoch.current = refreshEpoch;
    const mergedSummary = mergeSummary(summaryRef.current, nextSummary);
    summaryRef.current = mergedSummary;
    setSummary(mergedSummary);
    if (acceptedFlow) setInput((current) => {
      const missedPeople = acceptedFlow.missedPeople?.length ? acceptedFlow.missedPeople.map((person) => {
        const stored = acceptedFlow.people.find((entry) => entry.personId === person.personId);
        const local = current.missedPeople?.find((entry) => entry.personId === person.personId);
        const storedCount = stored ? Math.max(0, stored.manualShotAdds.length - stored.manualShotRemoves.length) : 0;
        const sampleUris = stored?.samplePhotoUris?.length ? stored.samplePhotoUris : local?.sampleUris;
        return { ...person, momentCount: Math.max(storedCount, local?.momentCount ?? 0), ...(sampleUris?.length ? { sampleUris } : {}), ...(local?.skipped ? { skipped: true } : {}) };
      }) : current.missedPeople;
      const nextMissedPerson = missedPeople?.find((person) => !person.skipped && person.momentCount === 0);
      const historyTurns = acceptedFlow.missedClarifications?.map((turn) => ({ ...turn, stage: "missed" as const })) ?? current.interpTurns?.filter((turn) => turn.stage === "missed") ?? [];
      return { ...current, flow: acceptedFlow, missedPeople, missedPeopleConfirmed: acceptedFlow.missedPeopleConfirmed ?? current.missedPeopleConfirmed, missedPersonTagging: nextMissedPerson ? { personId: nextMissedPerson.personId, name: nextMissedPerson.name, momentCount: 0 } : null,
      intent: current.intent ?? (acceptedFlow.story.answer ? { text: acceptedFlow.story.answer } : null),
      ...(acceptedFlow.story.storySummary ? { storySummary: acceptedFlow.story.storySummary } : {}),
      ...(acceptedFlow.story.mentionedPeople.length ? { mentionedPeople: acceptedFlow.story.mentionedPeople } : {}),
      missedAnswer: current.missedAnswer ?? acceptedFlow.missedAnswer,
      missedReply: current.missedReply ?? acceptedFlow.missedReply,
      interpTurns: [...(current.interpTurns ?? []).filter((turn) => turn.stage !== "missed"), ...historyTurns],
      people: current.people?.map((person) => { const stored = acceptedFlow.people.find((entry) => entry.personId === person.personId); return stored ? { ...person, name: person.name ?? stored.name, role: person.role ?? stored.role, answerText: person.answerText ?? stored.answerText, skipped: person.skipped || stored.skipped } : person; }) ?? current.people };
    });
    if (activeFilmId.current) pollFilmRef.current(activeFilmId.current);
    const mapped = people?.map((person: DirectorPerson) => {
      const edit = peopleEdits.current.get(person.personId);
      const stored = acceptedFlow?.people.find((entry) => entry.personId === person.personId);
      return { ...person, ...(personTagCounts.current.has(person.personId) ? { momentCount: personTagCounts.current.get(person.personId)! } : {}), ...(!edit && stored ? { name: person.name ?? stored.name, role: person.role ?? stored.role, skipped: stored.skipped } : {}), ...(edit ?? (skipPeopleForNow.current ? { name: null, role: null, skipped: true } : { skipped: false })) };
    }) ?? null;
    if (resumeProjectId.current !== projectId) {
      try {
        const resume = repository.getProjectResume
          ? await repository.getProjectResume(projectId)
          : { proposalId: null, storyText: null, generationId: null, generationStatus: null };
        if (!stillValid()) return;
        const [plan, film] = await Promise.all([
          resume.proposalId ? repository.getPlan(resume.proposalId).catch(() => null) : Promise.resolve(null),
          resume.generationId ? repository.getFilm(resume.generationId).catch(() => null) : Promise.resolve(null),
        ]);
        if (!stillValid()) return;
        resumeProjectId.current = projectId;
        proposalId.current = resume.proposalId;
        const confirmedStory = resume.storyText ?? (nextSummary.country ? `Yes, our ${nextSummary.country} trip` : `Yes, that's our story`);
        const hasGeneration = Boolean(resume.generationId);
        const hasFlowRecord = typeof repository.getFlow === "function";
        const allFlowPeopleAnswered = nextSummary.ready.faces && mapped !== null && (mapped.length === 0 || mapped.every((person) => {
          const stored = acceptedFlow?.people.find((entry) => entry.personId === person.personId);
          return Boolean(stored && (stored.confirmed || stored.skipped || stored.mergedInto));
        }));
        const peopleSummaryConfirmed = acceptedFlow?.peopleSummaryConfirmed === true || (hasFlowRecord && acceptedFlow?.peopleSummaryConfirmed === undefined && (hasGeneration || allFlowPeopleAnswered));
        const setAside = getSetAsideSummary(plan);
        const needsFilteredPhotoReview = setAside.blurry + setAside.duplicates > 0;
        const isFilmReady = Boolean(film) && (resume.generationStatus === "playable" || resume.generationStatus === "rendering" || resume.generationStatus === "saved");
        const generation = hasGeneration ? isFilmReady
          ? { status: "done" as const, stage: resume.generationStatus!, progress: 1, stepsDone: 3, film }
          : { status: "running" as const, stage: resume.generationStatus === "rendering" ? "rendering" as const : "composing" as const, progress: 0, stepsDone: 2, film: null }
          : null;
        setInput((current) => ({
          ...current,
          ...(taggedPersonRef.current ? { taggedPerson: taggedPersonRef.current } : {}),
          summary: mergedSummary,
          intent: current.intent ?? (resume.proposalId || hasGeneration ? { text: confirmedStory } : null),
          people: mergedSummary.ready.faces ? mapped?.map((person) => {
            const local = current.people?.find((item) => item.personId === person.personId);
            return local?.name || local?.skipped || peopleEdits.current.has(person.personId) ? { ...person, ...local } : person;
          }) ?? null : current.people,
          peopleConfirmed: hasFlowRecord ? allFlowPeopleAnswered : Boolean(resume.proposalId || hasGeneration) || (nextSummary.ready.faces && mapped !== null && (skipPeopleForNow.current || mapped.length === 0)),
          peopleSummaryConfirmed: hasFlowRecord ? peopleSummaryConfirmed : undefined,
          plan,
          directionNote: plan?.directionRecommendation ?? "For these moments, I’d suggest this.",
          momentsConfirmed: hasGeneration || Boolean(plan && !needsFilteredPhotoReview),
          direction: hasGeneration ? { confirmed: true, pace: "gentle", lengthSec: Math.max(30, film?.durationSec ?? 120), focus: "family", collageAmount: "few", motionFeel: "calm" } : null,
          generation,
        }));
        setResumeLoaded(true);
        if (plan && !hasGeneration && !needsFilteredPhotoReview) await loadDirectionOptions(plan.planId, stillValid);
        if (plan && planWaitTimer.current) { clearTimeout(planWaitTimer.current); planWaitTimer.current = null; }
        if (stillValid() && resume.generationId && hasGeneration) {
          activeFilmId.current = resume.generationId;
          if (!isFilmReady) void pollFilmRef.current(resume.generationId);
        }
      } catch (cause) {
        if (stillValid()) { resumeProjectId.current = null; throw cause; }
      }
      return;
    }
    setInput((current) => ({ ...current, ...(taggedPersonRef.current ? { taggedPerson: taggedPersonRef.current } : {}), summary: mergedSummary, people: mergedSummary.ready.faces ? mapped?.map((person) => {
      const local = current.people?.find((item) => item.personId === person.personId);
      return local?.name || local?.skipped || peopleEdits.current.has(person.personId) ? { ...person, ...local } : person;
    }) ?? null : current.people, peopleConfirmed: typeof repository.getFlow !== "function" ? current.peopleConfirmed || (nextSummary.ready.faces && mapped !== null && (skipPeopleForNow.current || mapped.length === 0)) : nextSummary.ready.faces && mapped !== null && (mapped.length === 0 || mapped.every((person) => {
      const stored = acceptedFlow?.people.find((entry) => entry.personId === person.personId);
      return Boolean(stored && (stored.confirmed || stored.skipped || stored.mergedInto));
    })), peopleSummaryConfirmed: typeof repository.getFlow !== "function" ? current.peopleSummaryConfirmed : acceptedFlow?.peopleSummaryConfirmed === true || (acceptedFlow?.peopleSummaryConfirmed === undefined && (current.peopleSummaryConfirmed === true || Boolean(current.generation) || (nextSummary.ready.faces && mapped !== null && mapped.length > 0 && mapped.every((person) => {
      const stored = acceptedFlow?.people.find((entry) => entry.personId === person.personId);
      return Boolean(stored && (stored.confirmed || stored.skipped || stored.mergedInto));
    })))) }));
    setResumeLoaded(true);
    if (proposalId.current && nextSummary.ready.plan && !planLoad.current && !currentPlan.current) {
      planLoad.current = true;
      try {
        const plan = await repository.getPlan(proposalId.current);
        if (stillValid()) {
          const setAside = getSetAsideSummary(plan);
          const needsFilteredPhotoReview = setAside.blurry + setAside.duplicates > 0;
          setInput((current) => ({ ...current, plan, planFailed: false, momentsConfirmed: !needsFilteredPhotoReview }));
          if (planWaitTimer.current) { clearTimeout(planWaitTimer.current); planWaitTimer.current = null; }
          if (!needsFilteredPhotoReview) await loadDirectionOptions(plan.planId, stillValid);
        }
      } catch (cause) {
        if (stillValid()) throw cause;
      } finally { if (isCurrentProject()) planLoad.current = false; }
    }
  }, [projectId, repository, loadDirectionOptions, currentProjectEpoch]);

  useEffect(() => {
    mounted.current = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try { await refresh(); }
      catch (cause) { setResumeLoaded(true); if (!localState.localMediaPending) setError(reportFailure(cause)); }
      finally { polling = false; }
    };
    void poll();
    const stopReadiness = repository.watchReadiness?.(projectId, () => { void poll(); }, () => undefined);
    // Readiness snapshots refresh promptly; this slower poll preserves old API
    // compatibility and recovers when the listener is unavailable.
    const timer = setInterval(() => { void poll(); }, 10_000);
    return () => { mounted.current = false; clearInterval(timer); stopReadiness?.(); };
  }, [refresh, localState.localMediaPending]);

  useEffect(() => () => { if (generationTimer.current) clearTimeout(generationTimer.current); if (planWaitTimer.current) clearTimeout(planWaitTimer.current); }, []);

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
    if (filmReadPending.current || !isCurrentProject()) return;
    filmReadPending.current = true;
    if (generationTimer.current) clearTimeout(generationTimer.current);
    generationTimer.current = null;
    activeFilmId.current = filmId;
    try {
      const film = await repository.getFilm(filmId);
      if (!mounted.current || !isCurrentProject()) return;
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
        setError(null);
        setInput((current) => ({ ...current, generation: { status: "done", stage: film.generationStatus === "saved" ? "saved" : "playable", progress: 1, stepsDone: 3, film } }));
      }
    } catch (cause) {
      if (!mounted.current || !isCurrentProject()) return;
      if ((cause as { code?: string })?.code === "generation_failed") {
        activeFilmId.current = null;
        compositionStartedAt.current = null;
        compositionRetryAvailable.current = true;
        setInput(current => ({ ...current, direction: current.direction ? { ...current.direction, confirmed: false } : null, generation: null }));
        if (!directionOptions && proposalId.current) await recoverDirectionOptions(proposalId.current);
        setError("I couldn't put your film together this time.");
      } else {
        setInput((current) => ({ ...current, generation: { status: "failed", stage: "failed", progress: current.generation?.progress ?? 0, stepsDone: current.generation?.stepsDone ?? 0, film: null } }));
        setError(reportFailure(cause));
      }
    } finally {
      if (isCurrentProject()) filmReadPending.current = false;
    }
  }, [repository, projectId, currentProjectEpoch, directionOptions, recoverDirectionOptions]);
  pollFilmRef.current = (filmId) => { void pollFilm(filmId); };

  const commitFlowAction = async (action: import("@mosae/contracts").FlowAction) => {
    if (!repository.mutateFlow) return null;
    const actionId = `${projectId}-${Date.now()}-${++actionSequence.current}`;
    const snapshot = await repository.mutateFlow(projectId, actionId, action);
    if (snapshot.revision >= flowRevision.current) {
      flowRevision.current = snapshot.revision;
      flowSnapshot.current = snapshot;
      setInput((current) => ({ ...current, flow: snapshot }));
    }
    return snapshot;
  };

  const actions = {
    async resolveLateVideo(assetId: string, choice: "add" | "undo" | "dismiss") {
      const film = input.generation?.film;
      const event = film?.lateVideoEvents?.find((item) => item.assetId === assetId);
      if (!event || !film) {
        setInput((current) => ({ ...current, lateVideoDismissals: [...new Set([...(current.lateVideoDismissals ?? []), assetId])] }));
        return;
      }
      try {
        if (choice !== "dismiss") {
          const edits = await repository.getEdits(projectId, film.filmId);
          const ops = choice === "undo"
            ? event.previousOps ?? []
            : [...edits.ops, { op: "add" as const, shotId: event.shotId, kind: "video" as const, afterClipId: event.afterClipId, durationSec: event.sourceOutSec - event.sourceInSec, sourceInSec: event.sourceInSec, sourceOutSec: event.sourceOutSec }];
          await repository.saveEdits(projectId, film.filmId, edits.revision + 1, ops);
        }
        await repository.dismissLateVideo(projectId, film.filmId, assetId);
        setInput((current) => ({ ...current, lateVideoDismissals: [...new Set([...(current.lateVideoDismissals ?? []), assetId])] }));
        void pollFilm(film.filmId);
      } catch (cause) { setError(reportFailure(cause)); }
    },
    async confirmOccasion(answer?: string, storyTextOverride?: string, mentionedPeople?: string[], storySummary?: string) {
      if (occasionSaving.current || !canConfirmStory({ ...input, ...confirmationState })) return;
      occasionSaving.current = true;
      setInput((current) => ({ ...current, pendingResponse: "occasion" }));
      planFailed.current = false;
      setSaving(true); setError(null);
      const storyText = storyTextOverride ?? answer ?? pendingInterpret?.text ?? input.earlyOccasionAnswer ?? (summary?.country ? `${summary.country} trip` : summary?.places[0] || "Our story");
      setInput((current) => ({ ...current, intent: current.intent ?? { text: answer ?? input.earlyOccasionAnswer ?? storyText }, ...(mentionedPeople?.length ? { mentionedPeople } : {}), ...(storySummary ? { storySummary } : {}) }));
      try {
        await commitFlowAction({ type: "story-answer", answer: answer ?? input.earlyOccasionAnswer ?? storyText, storySummary: storySummary ?? input.earlyOccasionStoryText ?? null, mentionedPeople: mentionedPeople ?? [] });
        const result = await repository.createPlan([storyText, ...input.notes].join("\n"), []);
        if (!isCurrentProject()) return;
        proposalId.current = result.planId;
        if (planWaitTimer.current) clearTimeout(planWaitTimer.current);
        planWaitTimer.current = setTimeout(() => {
          if (!isCurrentProject() || currentPlan.current) return;
          planFailed.current = true;
          setInput((current) => ({ ...current, pendingResponse: undefined, planFailed: true }));
          setError("I couldn't put the story together this time.");
        }, 180_000);
        setInput((current) => ({ ...current, pendingResponse: undefined, planFailed: false, earlyOccasionAnswer: undefined, earlyOccasionStoryText: undefined, intent: current.intent ?? { text: answer ?? input.earlyOccasionAnswer ?? storyText }, ...(mentionedPeople?.length ? { mentionedPeople } : {}), ...(storySummary ? { storySummary } : {}) }));
        setPendingInterpret(null);
        void refresh().catch((refreshCause) => { if (isCurrentProject()) setError(reportFailure(refreshCause)); });
      } catch (cause) {
        if (!isCurrentProject()) return;
        planFailed.current = true; reportFailure(cause);
        setInput((current) => ({ ...current, pendingResponse: undefined, planFailed: true }));
        setError("I couldn't put the story together this time.");
      }
      finally { if (isCurrentProject()) { occasionSaving.current = false; setSaving(false); } }
    },
    async setPerson(personId: string, role: string, name?: string, answerText?: string) {
      if (personSaving.current) return;
      personSaving.current = true;
      setError(null);
      const people = input.people ?? [];
      const normalizedRole = role.trim().toLocaleLowerCase();
      const roleValue = role === "child" || /^(my\s+)?(daughter|son)$/.test(normalizedRole) ? "child" : role === "other" || /^(friend|family|skip)$/.test(normalizedRole) ? "other" : "parent";
      const personName = name ?? (role === "Skip" ? undefined : role);
      const previousEdit = peopleEdits.current.get(personId);
      peopleEdits.current.set(personId, { name: role === "Skip" ? null : personName ?? null, role: roleValue, skipped: role === "Skip" });
      const updated = people.map((person) => person.personId === personId ? { ...person, role: roleValue, name: personName ?? null, ...(answerText ? { answerText } : {}), skipped: role === "Skip" } : person);
      const completedPersonIds = input.flow?.peopleProgress?.completedPersonIds ?? input.proceededPersonIds ?? [];
      // Reflect the typed answer immediately while persistence/cast refresh runs.
      // The card remains gated by Proceed, and the failed-save path restores the prior list.
      setInput((current) => ({ ...current, people: updated, proceededPersonIds: completedPersonIds, pendingResponse: "person" }));
      const duplicate = personName && role !== "Skip" ? matchExistingPersonAnswer(personName, people.filter((person) => person.personId !== personId)) : null;
      const priorPerson = duplicate ? people.find((person) => person.personId === duplicate.personId) : undefined;
      const mergeEvent = duplicate && priorPerson ? {
        id: `merge-${personId}`, personId, targetPersonId: priorPerson.personId, answer: duplicate.answer,
        targetName: priorPerson.name ?? duplicate.answer,
        sampleFaces: (priorPerson.sampleFaces ?? []).slice(0, 2).map((face) => face.uri),
        questionFaces: (updated.find((person) => person.personId === personId)?.sampleFaces ?? []).slice(0, 2).map((face) => face.uri),
        faceSamples: [...(priorPerson.sampleFaces ?? []).slice(0, 1), ...(updated.find((person) => person.personId === personId)?.sampleFaces ?? []).slice(0, 1)],
        momentCount: updated.find((person) => person.personId === personId)?.momentCount ?? 0,
      } : null;
      const castPeople = updated;
      setInput((current) => ({ ...current, people: updated, pendingResponse: "person" }));
      setPendingInterpret(null);
      try {
        const priorProgress = input.flow?.peopleProgress?.completedPersonIds;
        const completedPersonIds = [...new Set([...(priorProgress ?? input.proceededPersonIds ?? []), ...(role === "Skip" ? [personId] : [])])];
      const allAnsweredNow = castPeople.every((person) => person.skipped || Boolean(person.name));
      const allProceededNow = castPeople.every((person) => person.skipped || completedPersonIds.includes(person.personId));
        await commitFlowAction({ type: "batch", actions: [
          { type: "person", personId, name: role === "Skip" ? null : personName ?? null, role: roleValue, ...(answerText ? { answerText } : {}), confirmed: role !== "Skip", skipped: role === "Skip" },
          ...(priorProgress === undefined ? [{ type: "people-progress" as const, completedPersonIds }] : role === "Skip" ? [{ type: "people-progress" as const, completedPersonIds }] : []),
          ...(role === "Skip" && allAnsweredNow && allProceededNow ? [{ type: "missed-people-confirmed" as const, confirmed: false }] : []),
          { type: "people-summary-confirmed", confirmed: false },
        ] });
        const result = storyFlow?.repository === "fixture" ? null : await confirmCast(projectId, { people: castPeople.map((person) => ({ personId: person.personId, role: person.role as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
        const revisedPlan = result?.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
        if (!isCurrentProject()) return;
        if (result?.proposalId) proposalId.current = result.proposalId;
        const allAnswered = castPeople.every((person) => person.skipped || Boolean(person.name));
        setInput((current) => ({ ...current, people: castPeople, proceededPersonIds: current.flow?.peopleProgress?.completedPersonIds ?? completedPersonIds, ...(mergeEvent ? { mergeEvents: [...(current.mergeEvents ?? []).filter((event) => event.id !== mergeEvent.id), mergeEvent] } : {}), pendingResponse: undefined, ...(revisedPlan ? { plan: revisedPlan, momentsConfirmed: getSetAsideSummary(revisedPlan).blurry + getSetAsideSummary(revisedPlan).duplicates === 0 } : {}), peopleConfirmed: allAnswered && allProceededNow && !mergeEvent && !(current.missedPeople ?? []).length, missedPeopleConfirmed: allAnswered && allProceededNow && role === "Skip" ? false : current.missedPeopleConfirmed, peopleSummaryConfirmed: allAnswered && allProceededNow && role === "Skip" && !mergeEvent && !(current.missedPeople ?? []).length ? false : current.peopleSummaryConfirmed }));
        setError(null);
      } catch (cause) {
        if (previousEdit) peopleEdits.current.set(personId, previousEdit);
        else peopleEdits.current.delete(personId);
        setInput((current) => ({ ...current, people, pendingResponse: undefined }));
        setError(reportFailure(cause));
      }
      finally { if (isCurrentProject()) personSaving.current = false; }
    },
    async proceedPerson(personId: string) {
      if (personSaving.current) return;
      personSaving.current = true;
      try {
        const completedPersonIds = [...new Set([...(input.flow?.peopleProgress?.completedPersonIds ?? input.proceededPersonIds ?? []), personId])];
        const allResolved = (input.people ?? []).every((person) => person.skipped || Boolean(person.name));
        const allProceeded = (input.people ?? []).every((person) => person.skipped || completedPersonIds.includes(person.personId));
        await commitFlowAction({ type: "batch", actions: [
          { type: "people-progress", completedPersonIds },
          ...(allResolved && allProceeded ? [{ type: "missed-people-confirmed" as const, confirmed: false }] : []),
        ] });
        if (!isCurrentProject()) return;
        setInput((current) => ({ ...current, proceededPersonIds: completedPersonIds, peopleConfirmed: allResolved && allProceeded, missedPeopleConfirmed: allResolved && allProceeded ? false : current.missedPeopleConfirmed, peopleSummaryConfirmed: allResolved && allProceeded ? false : current.peopleSummaryConfirmed }));
      } catch (cause) { setError(reportFailure(cause)); }
      finally { if (isCurrentProject()) personSaving.current = false; }
    },
    async addMissedPeople(names: string[], answerText?: string) {
      const existing: NonNullable<ChatInput["missedPeople"]> = input.missedPeople ?? [];
      const normalize = (name: string) => name.trim().replace(/^my\s+/i, "").toLocaleLowerCase();
      const known = new Map([...existing.map(({ name }) => [normalize(name), name] as const), ...(input.people ?? []).flatMap(({ name }) => name ? [[normalize(name), name] as const] : [])]);
      const duplicates: string[] = [];
      const added = names.map((name) => name.trim()).filter((name) => {
        if (!name) return false;
        const key = normalize(name);
        if (known.has(key)) { const displayName = known.get(key)!; if (!duplicates.some((prior) => normalize(prior) === key)) duplicates.push(displayName.replace(/^my\s+/i, "")); return false; }
        known.set(key, name);
        return true;
      }).map((name, index) => ({ personId: `p-missed-${Date.now()}-${index}`, name, momentCount: 0 }));
      const all = [...existing, ...added];
      const missedReply = duplicates.length ? `${duplicates.join(" and ")} ${duplicates.length === 1 ? "is" : "are"} already tagged.` : undefined;
      const allAlreadyTagged = added.length === 0 && duplicates.length > 0;
      await commitFlowAction({ type: "batch", actions: [
        { type: "missed-people", people: all.map((person) => ({ personId: person.personId, name: person.name, ...((person as { skipped?: boolean }).skipped ? { skipped: true } : {}) })), ...(answerText ? { answer: answerText } : {}), reply: missedReply ?? null },
        { type: "missed-people-confirmed", confirmed: allAlreadyTagged },
      ] });
      setInput((current) => ({ ...current, missedPeople: all, ...(answerText ? { missedAnswer: answerText } : {}), missedReply, missedPersonTagging: null, peopleConfirmed: true, missedPeopleConfirmed: allAlreadyTagged, peopleSummaryConfirmed: false }));
    },
    async confirmMissedPeople() {
      await commitFlowAction({ type: "missed-people-confirmed", confirmed: true });
      setInput((current) => ({ ...current, peopleConfirmed: true, missedPeopleConfirmed: true, peopleSummaryConfirmed: false }));
    },
    reopenPerson(personId: string) {
      const person = input.people?.find((entry) => entry.personId === personId && !entry.skipped);
      if (!person) return;
      peopleEdits.current.set(person.personId, { name: null, role: null, skipped: false });
      void commitFlowAction({ type: "batch", actions: [
        { type: "person", personId: person.personId, name: null, role: null, confirmed: false, skipped: false },
        { type: "people-summary-confirmed", confirmed: false },
      ] }).catch((cause) => setError(reportFailure(cause)));
      setInput((current) => ({ ...current, people: (current.people ?? []).map((entry) => entry.personId === person.personId ? { ...entry, name: null } : entry), peopleConfirmed: false, peopleSummaryConfirmed: undefined }));
    },
    async resolvePersonMerge(eventId: string, samePerson: boolean) {
      const event = input.mergeEvents?.find(({ id }) => id === eventId);
      if (!event || personSaving.current) return;
      personSaving.current = true;
      const response = samePerson ? "Yes, same person" as const : "No, another person" as const;
      try {
        if (samePerson) {
          const castPeople = (input.people ?? []).filter((person) => person.personId !== event.personId);
          const result = storyFlow?.repository === "fixture" ? null : await confirmCast(projectId, { people: castPeople.map((person) => ({ personId: person.personId, role: (person.role ?? "other") as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], merges: [{ fromPersonId: event.personId, toPersonId: event.targetPersonId }], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
          const revisedPlan = result?.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
          if (!isCurrentProject()) return;
          if (result?.proposalId) proposalId.current = result.proposalId;
          setInput((current) => ({ ...current, people: castPeople, ...(revisedPlan ? { plan: revisedPlan, momentsConfirmed: getSetAsideSummary(revisedPlan).blurry + getSetAsideSummary(revisedPlan).duplicates === 0 } : {}), peopleConfirmed: false, mergeEvents: current.mergeEvents?.map((item) => item.id === eventId ? { ...item, response } : item) }));
        } else {
          const duplicateName = (input.people ?? []).some((person) => person.personId === event.personId && person.name?.trim().replace(/^my\s+/i, "").toLocaleLowerCase() === event.answer.trim().replace(/^my\s+/i, "").toLocaleLowerCase());
          const updated = duplicateName
            ? (input.people ?? []).map((person) => person.personId === event.personId ? { ...person, name: null, role: null, skipped: false } : person)
            : (input.people ?? []);
          if (duplicateName) peopleEdits.current.set(event.personId, { name: null, role: null, skipped: false });
          const result = storyFlow?.repository === "fixture" ? null : await confirmCast(projectId, { people: updated.map((person) => ({ personId: person.personId, role: (person.role ?? "other") as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
          const revisedPlan = result?.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
          if (!isCurrentProject()) return;
          if (result?.proposalId) proposalId.current = result.proposalId;
          setInput((current) => ({ ...current, ...(duplicateName ? { people: updated } : {}), ...(revisedPlan ? { plan: revisedPlan, momentsConfirmed: getSetAsideSummary(revisedPlan).blurry + getSetAsideSummary(revisedPlan).duplicates === 0 } : {}), mergeEvents: current.mergeEvents?.map((item) => item.id === eventId ? { ...item, response } : item) }));
        }
      } catch (cause) { setError(reportFailure(cause)); }
      finally { if (isCurrentProject()) personSaving.current = false; }
    },
    async resolveMentionedPerson(personId: string, label: string, confirm: boolean) {
      if (!confirm) {
        setInput((current) => ({ ...current, dismissedPersonSuggestionIds: [...new Set([...(current.dismissedPersonSuggestionIds ?? []), personId])] }));
        return;
      }
      const relation = /^My\s+(?:son|daughter|wife|husband|mum|mom|mother|dad|father|partner)$/i.test(label);
      return relation ? this.setPerson(personId, label) : this.setPerson(personId, "Type a name", label);
    },
    async skipPeople() {
      if (personSaving.current) return;
      personSaving.current = true;
      skipPeopleForNow.current = true;
      const people = (input.people ?? []).map((person) => ({ ...person, skipped: true }));
      try {
        const skipped = (input.people ?? []).map((person) => ({ type: "person" as const, personId: person.personId, name: null, role: "other", confirmed: false, skipped: true }));
        if (skipped.length) await commitFlowAction({ type: "batch", actions: [...skipped, { type: "people-summary-confirmed", confirmed: false }] });
        const result = await confirmCast(projectId, { people: people.map((person) => ({ personId: person.personId, role: "other" as const, excluded: false })), focus: [], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
        const revisedPlan = result.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
        if (!isCurrentProject()) return;
        if (result.proposalId) proposalId.current = result.proposalId;
        setInput((current) => ({ ...current, people, peopleSummaryConfirmed: false, ...(revisedPlan ? { plan: revisedPlan, momentsConfirmed: getSetAsideSummary(revisedPlan).blurry + getSetAsideSummary(revisedPlan).duplicates === 0 } : {}), peopleConfirmed: true })); setError(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save this. Please try again."); }
      finally { if (isCurrentProject()) personSaving.current = false; }
    },
    async completeMissedPerson(personId: string, name: string, momentCount: number, sampleUri?: string, sampleUris?: string[]) {
      const sampleFaces = sampleUri ? [{ shotId: "manual-sample", uri: sampleUri, bbox: [0, 0, 1, 1] as [number, number, number, number] }] : undefined;
      await commitFlowAction({ type: "missed-person-completed", personId });
      setInput((current) => {
        const people = current.people ?? [];
        const updatedPeople = people.some((person) => person.personId === personId)
          ? people.map((person) => person.personId === personId ? { ...person, momentCount, ...(sampleFaces ? { sampleFaces } : {}) } : person)
          : [...people, { personId, name, role: "other", skipped: false, momentCount, sampleShotIds: [], days: [], ...(sampleFaces ? { sampleFaces } : {}) }];
        const missedPeople = (current.missedPeople ?? []).map((person) => person.personId === personId ? { ...person, momentCount, ...(sampleUris?.length ? { sampleUris: sampleUris.slice(0, 4) } : sampleUri ? { sampleUri } : {}) } : person);
        const allMissedPeopleResolved = missedPeople.every((person) => person.skipped || person.momentCount > 0);
        const next = missedPeople.find((person) => !person.skipped && person.momentCount === 0);
        return { ...current, people: updatedPeople, missedPeople, peopleConfirmed: true, ...(allMissedPeopleResolved ? { missedPeopleConfirmed: true } : {}), peopleSummaryConfirmed: false, missedPersonTagging: next ? { personId: next.personId, name: next.name } : null };
      });
    },
    async skipMissedPerson(personId: string) {
      const missedPeople = (input.missedPeople ?? []).map((person) => person.personId === personId ? { ...person, skipped: true } : person);
      await commitFlowAction({ type: "missed-people", people: missedPeople.map(({ personId: id, name, skipped }) => ({ personId: id, name, ...(skipped ? { skipped: true } : {}) })), ...(input.missedAnswer ? { answer: input.missedAnswer } : {}), ...(input.missedReply ? { reply: input.missedReply } : {}) });
      const next = missedPeople.find((person) => !person.skipped && person.momentCount === 0);
      setInput((current) => ({ ...current, missedPeople, missedPersonTagging: next ? { personId: next.personId, name: next.name } : null }));
    },
    updatePersonTagCount(personId: string, momentCount: number, sampleUri?: string, name?: string | null) {
      personTagCounts.current.set(personId, momentCount);
      const person = input.people?.find((entry) => entry.personId === personId);
      if (sampleUri) taggedPersonRef.current = { personId, name: person?.name ?? (name === "this person" ? "" : name ?? ""), photos: [sampleUri] };
      // The selected grid image is a scene thumbnail, so preserve the face
      // crops on the original person question in chat history.
      setInput((current) => ({ ...current, ...(taggedPersonRef.current ? { taggedPerson: taggedPersonRef.current } : {}), people: (current.people ?? []).map((entry) => entry.personId === personId ? { ...entry, momentCount } : entry) }));
    },
    beginMissedPersonTagging(personId: string, name: string) { setInput((current) => ({ ...current, missedPersonTagging: { personId, name } })); },
    async confirmPeopleSummary() {
      if (personSaving.current) return;
      personSaving.current = true;
      try {
        const people = input.people ?? [];
        const result = storyFlow?.repository === "fixture" ? null : await confirmCast(projectId, { people: people.filter((person) => !person.personId.startsWith("p-missed-") || (input.missedPeople ?? []).some((missed) => missed.personId === person.personId)).map((person) => ({ personId: person.personId, role: (person.role ?? "other") as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
        const revisedPlan = result?.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
        if (!isCurrentProject()) return;
        if (result?.proposalId) proposalId.current = result.proposalId;
        await commitFlowAction({ type: "people-summary-confirmed", confirmed: true });
        const setAside = revisedPlan ? getSetAsideSummary(revisedPlan) : null;
        const momentsConfirmed = setAside
          ? setAside.blurry + setAside.duplicates === 0
          : input.momentsConfirmed;
        setInput((current) => ({ ...current, peopleConfirmed: true, peopleSummaryConfirmed: true, momentsConfirmed, ...(revisedPlan ? { plan: revisedPlan } : {}) }));
        const nextPlan = revisedPlan ?? input.plan;
        if (momentsConfirmed && nextPlan && input.summary?.ready.plan) await loadDirectionOptions(nextPlan.planId);
      } catch (cause) { setError(reportFailure(cause)); }
      finally { if (isCurrentProject()) personSaving.current = false; }
    },
    async confirmPeople() {
      if (personSaving.current) return;
      personSaving.current = true;
      try {
        const people = input.people ?? [];
        const result = storyFlow?.repository === "fixture" ? null : await confirmCast(projectId, { people: people.map((person) => ({ personId: person.personId, role: (person.role ?? "other") as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
        const revisedPlan = result?.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
        if (!isCurrentProject()) return;
        if (result?.proposalId) proposalId.current = result.proposalId;
        await commitFlowAction({ type: "people-summary-confirmed", confirmed: false });
        setInput((current) => ({ ...current, peopleConfirmed: true, peopleSummaryConfirmed: false, ...(revisedPlan ? { plan: revisedPlan, momentsConfirmed: getSetAsideSummary(revisedPlan).blurry + getSetAsideSummary(revisedPlan).duplicates === 0 } : {}) }));
      } catch (cause) { setError(reportFailure(cause)); }
      finally { if (isCurrentProject()) personSaving.current = false; }
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
    setDirection(patch: { pace?: "gentle" | "lively"; lengthSec?: number; focus?: string; collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful"; aspect?: "9:16" | "16:9" }) {
      const next = { ...directionSelection };
      if (patch.pace) next.cadenceId = directionOptions?.cadences.find((cadence) => /gentle|reflective/i.test(`${cadence.id} ${cadence.name}`) === (patch.pace === "gentle"))?.id ?? next.cadenceId;
      if (patch.lengthSec) {
        const selected = directionOptions?.durations.find(({ seconds }) => seconds === patch.lengthSec);
        next.durationId = selected?.id ?? (patch.lengthSec < 30 ? "short" : directionOptions?.durations.reduce((closest, option) => Math.abs(option.seconds - patch.lengthSec!) < Math.abs(closest.seconds - patch.lengthSec!) ? option : closest, directionOptions.durations[0]!)?.id ?? next.durationId);
        next.durationSec = next.durationId === "short" ? patch.lengthSec : undefined;
      }
      if (patch.focus) { next.focus = directionFocus(input.people, patch.focus, true).selected; setFocusExplicit(true); }
      if (patch.collageAmount) next.collageAmount = patch.collageAmount;
      if (patch.motionFeel) next.motionFeel = patch.motionFeel;
      if (patch.aspect) { next.aspect = patch.aspect; setAspectSelectedByUser(true); }
      const maximumDurationSec = directionOptions?.maximumDurationSecByCadence?.[next.cadenceId] ?? directionOptions?.maximumDurationSec ?? Infinity;
      const availableDurations = directionOptions ? durationsForCadence(directionOptions, next.cadenceId) : [];
      const selectedDuration = availableDurations.find(({ id }) => id === next.durationId) ?? availableDurations.at(-1);
      if (selectedDuration) { next.durationId = selectedDuration.id; next.durationSec = selectedDuration.id === "short" ? selectedDuration.seconds : undefined; }
      setDirectionSelection(next);
      setInput((current) => ({ ...current, direction: current.direction
        ? { ...current.direction, ...patch, ...(selectedDuration ? { lengthSec: selectedDuration.seconds } : {}) }
        : { confirmed: false, pace: patch.pace ?? "gentle", lengthSec: selectedDuration?.seconds ?? patch.lengthSec ?? 120, focus: patch.focus ?? "family" } }));
    },
    async shapeIt() {
      if (!input.plan || !input.direction || saving || generationSaving.current || input.generation || !directionOptions) return;
      const maximum = directionOptions.maximumDurationSecByCadence?.[directionSelection.cadenceId] ?? directionOptions.maximumDurationSec ?? Infinity;
      const availableDurations = durationsForCadence(directionOptions, directionSelection.cadenceId);
      const selectedDuration = availableDurations.find(duration => duration.id === directionSelection.durationId && duration.seconds === (duration.id === "short" ? directionSelection.durationSec : duration.seconds));
      if (!selectedDuration || selectedDuration.seconds > maximum) return;
      generationSaving.current = true;
      compositionRetryAvailable.current = false;
      setSaving(true); setError(null);
      try {
        const focus = directionFocus(input.people, directionSelection.focus, focusExplicit);
        const focusLabel = focus.label;
        const direction: Direction & { focus: string } = { note: `${directionOptions?.note ?? ""}${directionOptions?.note ? "\n" : ""}Focus: ${focusLabel}.`, cadenceId: directionSelection.cadenceId, soundtrackId: directionSelection.soundtrackId, soundtrackExplicit: directionSelection.soundtrackExplicit, durationId: directionSelection.durationId, ...(directionSelection.durationId === "short" ? { durationSec: directionSelection.durationSec } : {}), focus: focus.selected, collageAmount: directionSelection.collageAmount, motionFeel: directionSelection.motionFeel, aspect: effectiveAspect };
        compositionStartedAt.current = Date.now();
        setInput((current) => ({ ...current, direction: current.direction ? {
          ...current.direction,
          confirmed: true,
          pace: /gentle|reflective/i.test(directionSelection.cadenceId) ? "gentle" : "lively",
          focus: focus.selected,
          collageAmount: directionSelection.collageAmount,
          aspect: effectiveAspect,
        } : current.direction }));
        let latestSummary = input.summary;
        const pendingVideos = () => latestSummary?.videoStatuses?.filter((video) => video.status === "processing") ?? [];
        const waitingVideoCount = pendingVideos().length;
        const waitStarted = Date.now();
        if (waitingVideoCount) {
          while (Date.now() - waitStarted < 60_000 && isCurrentProject() && pendingVideos().length > 0) {
            const elapsedSec = Math.floor((Date.now() - waitStarted) / 1000);
            setInput((current) => ({ ...current, filmWait: { elapsedSec, videoCount: waitingVideoCount } }));
            await new Promise((resolve) => setTimeout(resolve, 1000));
            try {
              latestSummary = await repository.getSummary(projectId);
              if (!isCurrentProject()) return;
              latestSummary = mergeSummary(summaryRef.current, latestSummary);
              summaryRef.current = latestSummary;
              setSummary(latestSummary);
              setInput((current) => ({ ...current, summary: latestSummary }));
            } catch { /* Existing summary polling will recover a transient read failure. */ }
          }
        }
        setInput((current) => ({ ...current, filmWait: undefined, generation: { status: "queued", stage: "queued", progress: 0, stepsDone: 0, film: null } }));
        const { filmId } = await repository.directFilm(input.plan.planId, direction);
        if (mounted.current && isCurrentProject()) { setInput((current) => ({ ...current, generation: current.generation ? { ...current.generation, status: "running", stage: "composing" } : current.generation })); void pollFilm(filmId); }
      } catch (cause) {
        if (!isCurrentProject()) return;
        compositionStartedAt.current = null;
        setInput((current) => ({ ...current, direction: current.direction ? { ...current.direction, confirmed: false } : null, generation: null }));
        setError(reportFailure(cause));
      }
      finally { if (isCurrentProject()) { generationSaving.current = false; setSaving(false); } }
    },
    async saveFilm() {
      const film = input.generation?.film;
      if (!film || saving) return;
      setSaving(true); setError(null);
      try {
        await repository.saveFilm(film.filmId);
        if (!isCurrentProject()) return;
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
      const answer = text.trim();
      if (!answer) return;
      if (interpretInFlight.current) return;
      if (pendingInterpret) {
        if (/^(yes|yeah|yep|ok|okay|correct|that's right|that’s right)$/i.test(answer)) { await actions.confirmInterpret(); return; }
        if (/^(no|nope|not quite)$/i.test(answer)) { actions.discardInterpret(); return; }
        actions.discardInterpret();
      }
      const activePerson = state.items.find((item) => item.kind === "person");
      const summaryVisible = state.items.some((item) => item.kind === "people-summary");
      const anyoneElseVisible = state.items.some((item) => item.kind === "anyone-else");
      const missedTaggingVisible = state.items.some((item) => item.kind === "missed-person") || Boolean(input.missedPersonTagging);
      const missedFlowActive = summaryVisible || anyoneElseVisible || missedTaggingVisible;
      if (!input.intent) {
        // Upload phase (localMediaPending): the user is answering the occasion question — capture directly.
        // Understand/faces phase (upload done, understood > 0): answer mid-flow questions inline.
        const flowStarted = !localState.localMediaPending && Boolean(input.summary?.processed && input.summary.processed.understood > 0);
        if (!flowStarted) {
          // Pre-upload "answer the occasion question" flow: keep capturing directly.
          setInput((current) => current.earlyOccasionAnswer
            ? ({ ...current, notes: [...current.notes, text.trim()] })
            : ({ ...current, earlyOccasionAnswer: text.trim() }));
          return;
        }
        // Automated phase (understand/faces): the model decides whether this is an occasion
        // answer (wait for explicit confirmation) or a mid-flow question (answer inline).
        if (!summary) return;
        interpretInFlight.current = true;
        setInput((current) => ({ ...current, interpTurns: [...(current.interpTurns ?? []), { question: text.trim() }], interpReplying: true }));
        try {
          const step = state.step === "people" || state.step === "moments" || state.step === "direction" ? state.step : "occasion";
          const peopleStage = activePerson?.kind === "person" ? "identify" : state.items.some((item) => item.kind === "person-tagged" && item.canProceed !== false) ? "tagged" : summaryVisible ? "summary" : missedFlowActive ? "missed" : undefined;
          const result = await repository.interpret(projectId, { step, text, context: { summary, people: (input.people ?? []).map(({ personId, name, role }) => ({ personId, name, role })), ...(peopleStage ? { peopleStage } : {}) } });
          if (canConfirmStory({ ...input, ...confirmationState }) && result.change.kind === "occasion") {
            // Ready to confirm: an occasion answer waits for explicit confirmation.
            setInput((current) => ({ ...current, interpTurns: (current.interpTurns ?? []).slice(0, -1), interpReplying: false }));
            const interpretedPeople = Array.isArray(result.change.mentionedPeople)
              ? result.change.mentionedPeople.filter((person): person is string => typeof person === "string") : [];
            const storySummary = typeof result.change.storyText === "string" ? result.change.storyText : undefined;
            setPendingInterpret({ reply: result.reply, text, ...(interpretedPeople.length ? { mentionedPeople: interpretedPeople } : {}), ...(storySummary ? { storySummary } : {}) });
            return;
          }
          // Mid-flow question: answer inline, don't disrupt the flow.
          const reply = result.change.kind === "unclear" ? (result.reply || UNCLEAR) : result.reply;
          setInput((current) => ({ ...current, interpTurns: (current.interpTurns ?? []).map((turn, index, turns) => index === turns.length - 1 ? { ...turn, reply } : turn), interpReplying: false }));
          if (result.change.kind === "occasion") {
            // User answered the occasion question mid-flow — capture it; confirmOccasion
            // proceeds once a plan can be confirmed. Do not force a step change.
            setInput((current) => ({ ...current, earlyOccasionAnswer: text.trim(), ...(typeof result.change.storyText === "string" ? { earlyOccasionStoryText: result.change.storyText } : {}) }));
          }
        } catch (cause) {
          setInput((current) => ({ ...current, interpReplying: false }));
          setError(reportFailure(cause));
        } finally { interpretInFlight.current = false; }
        return;
      }
      if (!summary) return;
      interpretInFlight.current = true;
      try {
        const step = state.step === "people" || state.step === "moments" || state.step === "direction" ? state.step : "occasion";
        const peopleStage = activePerson?.kind === "person" ? "identify" : state.items.some((item) => item.kind === "person-tagged" && item.canProceed !== false) ? "tagged" : summaryVisible ? "summary" : missedFlowActive ? "missed" : undefined;
        const result = await repository.interpret(projectId, { step, text, context: { summary, people: (input.people ?? []).map(({ personId, name, role }) => ({ personId, name, role })), ...(peopleStage ? { peopleStage } : {}) } });
        if (result.change.kind === "unclear") {
          setInput((current) => ({ ...current, interpTurns: [...(current.interpTurns ?? []), { ...(activePerson?.kind === "person" ? { personId: activePerson.personId } : {}), ...(step === "people" && peopleStage === "missed" ? { stage: "missed" as const } : {}), question: text.trim(), reply: result.reply || UNCLEAR }] }));
          return;
        }
        const interpretedPeople = result.change.kind === "occasion" && Array.isArray(result.change.mentionedPeople)
          ? result.change.mentionedPeople.filter((person): person is string => typeof person === "string") : [];
        const storySummary = result.change.kind === "occasion" && typeof result.change.storyText === "string" ? result.change.storyText : undefined;
        if (result.change.kind === "person") {
          const change = result.change as { intent?: string; name?: string; role?: string; names?: string[]; needsClarification?: boolean; clarifyingQuestion?: string };
          if (change.needsClarification) {
            const reply = change.clarifyingQuestion ?? "Could you tell me their names?";
            if (peopleStage === "missed") await commitFlowAction({ type: "missed-clarification-turn", question: text.trim(), reply });
            setInput((current) => ({ ...current, interpTurns: [...(current.interpTurns ?? []), { ...(activePerson?.kind === "person" ? { personId: activePerson.personId } : {}), ...(peopleStage === "missed" ? { stage: "missed" as const } : {}), question: text.trim(), reply }] }));
            return;
          }
          if (change.intent === "proceed") {
            const tagged = state.items.find((item) => item.kind === "person-tagged" && item.canProceed !== false);
            if (tagged?.kind === "person-tagged") return actions.proceedPerson(tagged.personId);
          }
          if (change.intent === "confirm") {
            const normalized = answer.replace(/[.!?]+$/, "").toLocaleLowerCase();
            return /^(?:that's everyone|that’s everyone|no|no one else|nobody else|that's all|that’s all|none)$/.test(normalized) ? actions.confirmMissedPeople() : actions.confirmPeopleSummary();
          }
          if (change.intent === "skip" && activePerson?.kind === "person") return actions.setPerson(activePerson.personId, "Skip", undefined, text.trim());
          if (change.intent === "assign" && activePerson?.kind === "person") {
            return actions.setPerson(activePerson.personId, String(change.role ?? "other"), String(change.name ?? text), text.trim());
          }
          if (change.intent === "missed" || change.intent === "assign") {
            const names = change.names?.length ? change.names : change.name ? [change.name] : [];
            if (names.length) return actions.addMissedPeople(names, text.trim());
          }
          if (change.intent === "change") {
            const name = change.names?.[0] ?? change.name ?? "";
            const existing = (input.people ?? []).find((person) => person.name?.toLocaleLowerCase().includes(name.toLocaleLowerCase()) || name.toLocaleLowerCase().includes(person.name?.toLocaleLowerCase() ?? "\u0000"));
            if (existing) {
              router.push({ pathname: "/tag-moments", params: { projectId, repository: storyFlow?.repository ?? "api", personId: existing.personId, name: existing.name ?? "" } } as any);
              return;
            }
            if (name) return actions.addMissedPeople([name], text.trim());
          }
          setInput((current) => ({ ...current, interpTurns: [...(current.interpTurns ?? []), { question: text, reply: result.reply || "Could you say who you mean?" }] }));
        }
        else if (result.change.kind === "occasion") setPendingInterpret({ reply: result.reply, text, ...(interpretedPeople.length ? { mentionedPeople: interpretedPeople } : {}), ...(storySummary ? { storySummary } : {}) });
      } catch (cause) { setError(reportFailure(cause)); }
      finally { interpretInFlight.current = false; }
    },
    async confirmInterpret() {
      if (pendingInterpret?.mentionedPeople || pendingInterpret?.storySummary) return actions.confirmOccasion(pendingInterpret.text, undefined, pendingInterpret.mentionedPeople, pendingInterpret.storySummary);
      if (pendingInterpret?.change?.kind === "person") {
        const personId = pendingInterpret.change.personId ?? state.items.find((item) => item.kind === "person")?.personId;
        if (!personId) return setPendingInterpret(null);
        const change = pendingInterpret.change;
        return actions.setPerson(personId, change.role ?? "Type a name", change.name ?? (change.role ? undefined : pendingInterpret.text.trim()));
      }
    },
    answerOccasion(text: string, storyText?: string) {
      if (occasionSaving.current) return;
      setInput((current) => ({ ...current, earlyOccasionAnswer: text, ...(storyText ? { earlyOccasionStoryText: storyText } : {}) }));
      if (canConfirmStory({ ...input, ...confirmationState })) void actions.confirmOccasion(text, storyText);
    },
    discardInterpret() { setPendingInterpret(null); },
  };
  useEffect(() => {
    if (!input.earlyOccasionAnswer || !canConfirmStory({ ...input, ...confirmationState }) || occasionSaving.current || input.intent) return;
    void actions.confirmOccasion(input.earlyOccasionAnswer, input.earlyOccasionStoryText);
  }, [input.earlyOccasionAnswer, input.earlyOccasionStoryText, input.summary, localState.localMediaPending, localState.uploadFailuresAcknowledged]);
  return { state, actions, error, retry: () => {
    setError(null);
    if (planFailed.current && input.intent) {
      planFailed.current = false;
      if (planWaitTimer.current) { clearTimeout(planWaitTimer.current); planWaitTimer.current = null; }
      setInput((current) => ({ ...current, planFailed: false }));
      void repository.createPlan([input.intent.text, ...input.notes].join("\n"), []).then((result) => {
        if (!isCurrentProject()) return;
        proposalId.current = result.planId;
      if (planWaitTimer.current) clearTimeout(planWaitTimer.current);
      planWaitTimer.current = setTimeout(() => {
        if (!isCurrentProject() || currentPlan.current) return;
        planFailed.current = true;
        setInput((current) => ({ ...current, planFailed: true }));
        setError("I couldn't put the story together this time.");
      }, 180_000);
        setInput((current) => ({ ...current, pendingResponse: undefined, planFailed: false }));
        void refresh().catch((cause) => { if (isCurrentProject()) setError(reportFailure(cause)); });
      }).catch((cause) => {
        if (!isCurrentProject()) return;
        planFailed.current = true;
        setInput((current) => ({ ...current, pendingResponse: undefined, planFailed: true }));
        setError("I couldn't put the story together this time.");
        reportFailure(cause);
      });
    } else if (compositionRetryAvailable.current) { compositionRetryAvailable.current = false; void actions.shapeIt(); }
    else if (activeFilmId.current) void pollFilm(activeFilmId.current);
    else if (pendingDirectionOptions.current) void recoverDirectionOptions(pendingDirectionOptions.current);
    else void refresh().catch(cause => { if (isCurrentProject()) setError(reportFailure(cause)); });
  }, pendingInterpret, saving, summary, plan: input.plan, directionOptions, directionSelection: { ...directionSelection, aspect: effectiveAspect }, people: input.people ?? [], missedPeopleConfirmed: input.missedPeopleConfirmed };
}
