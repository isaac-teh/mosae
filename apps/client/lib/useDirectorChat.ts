import { useCallback, useEffect, useRef, useState as useReactState, type Dispatch, type SetStateAction, type MutableRefObject } from "react";
import { directionFocus, deriveChat, canConfirmStory, getSetAsideSummary, getStoryRepository, matchExistingPersonAnswer, type ChatInput, type ChatState, type Direction, type DirectionOptions, type DurationChoice, type Film, type ProjectSummary, type StoryPlan, type StoryRepository } from "@mosae/core";
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

export function useDirectorChat(projectId: string, repository: StoryRepository = getStoryRepository(), storyFlow?: { repository: "api" | "fixture"; projectId?: string }, localState: Pick<ChatInput, "localMediaPending" | "uploadFailuresAcknowledged" | "localUpload"> = {}) {
  const projectIdentity = useRef(projectId);
  const projectEpoch = useRef(0);
  if (projectIdentity.current !== projectId) { projectIdentity.current = projectId; projectEpoch.current++; }
  const currentProjectEpoch = projectEpoch.current;
  const isCurrentProject = () => projectEpoch.current === currentProjectEpoch && projectIdentity.current === projectId;
  const [input, setInput] = useProjectState<ChatInput>(projectEpoch, currentProjectEpoch, EMPTY_INPUT);
  const [summary, setSummary] = useProjectState<ProjectSummary | null>(projectEpoch, currentProjectEpoch, null);
  const [error, setError] = useProjectState<string | null>(projectEpoch, currentProjectEpoch, null);
  const [pendingInterpret, setPendingInterpret] = useProjectState<{ reply: string; text: string; mentionedPeople?: string[]; storySummary?: string } | null>(projectEpoch, currentProjectEpoch, null);
  const [saving, setSaving] = useProjectState(projectEpoch, currentProjectEpoch, false);
  const [momentState, setMomentState] = useProjectState<Record<string, "keep" | "leave">>(projectEpoch, currentProjectEpoch, {});
  const [directionOptions, setDirectionOptions] = useProjectState<DirectionOptions | null>(projectEpoch, currentProjectEpoch, null);
  const [directionSelection, setDirectionSelection] = useProjectState<{ cadenceId: string; durationId: Direction["durationId"]; durationSec?: number; soundtrackId: string | null; focus: string; collageAmount: "few" | "lots" | "none"; motionFeel: "calm" | "playful"; aspect: "9:16" | "16:9" }>(projectEpoch, currentProjectEpoch, { cadenceId: "reflective", durationId: "2m", soundtrackId: null, focus: "family", collageAmount: "few", motionFeel: "calm", aspect: "9:16" });
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
  const generationSaving = useRef(false);
  const compositionRetryAvailable = useRef(false);
  const planLoad = useRef(false);
  const planFailed = useRef(false);
  const resumeProjectId = useRef<string | null>(null);
  const peopleEdits = useRef(new Map<string, { name: string | null; role: string | null; skipped: boolean }>());
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
    resumeProjectId.current = null;
    peopleEdits.current.clear();
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
  const state: ChatState = deriveChat({ ...input, ...(input.direction ? { direction: { ...input.direction, aspect: effectiveAspect } } : {}), ...confirmationState });

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
    setDirectionSelection((current) => ({ ...current, focus, cadenceId, durationId, ...(durationId === "short" ? { durationSec: lengthSec } : { durationSec: undefined }), soundtrackId: current.soundtrackId ?? options.soundtracks[0]?.id ?? null, collageAmount: preserveSelection ? current.collageAmount : options.collageAmount ?? current.collageAmount, motionFeel: preserveSelection ? current.motionFeel : options.motionFeel ?? current.motionFeel }));
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
    const result = await Promise.all([repository.getSummary(projectId), repository.getPeople(projectId)]).catch(cause => {
      if (stillValid()) throw cause;
      return null;
    });
    if (!result || !stillValid()) return;
    const [nextSummary, people] = result;
    if (!startedWhilePending && !previousLocalPending.current && refreshEpoch === uploadEpoch.current) acceptedSummaryEpoch.current = refreshEpoch;
    setSummary(nextSummary);
    if (activeFilmId.current) pollFilmRef.current(activeFilmId.current);
    const mapped = people?.map((person: DirectorPerson) => {
      const edit = peopleEdits.current.get(person.personId);
      return { ...person, ...(edit ?? (skipPeopleForNow.current ? { name: null, role: null, skipped: true } : { skipped: false })) };
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
        const setAside = getSetAsideSummary(plan);
        const needsFilteredPhotoReview = setAside.blurry + setAside.duplicates > 0;
        const isFilmReady = Boolean(film) && (resume.generationStatus === "playable" || resume.generationStatus === "rendering" || resume.generationStatus === "saved");
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
          directionNote: plan?.directionRecommendation ?? "For these moments, I’d suggest this.",
          momentsConfirmed: hasGeneration || Boolean(plan && !needsFilteredPhotoReview),
          direction: hasGeneration ? { confirmed: true, pace: "gentle", lengthSec: Math.max(30, film?.durationSec ?? 120), focus: "family", collageAmount: "few", motionFeel: "calm" } : null,
          generation,
        }));
        if (plan && !hasGeneration && !needsFilteredPhotoReview) await loadDirectionOptions(plan.planId, stillValid);
        if (stillValid() && resume.generationId && hasGeneration) {
          activeFilmId.current = resume.generationId;
          if (!isFilmReady) void pollFilmRef.current(resume.generationId);
        }
      } catch (cause) {
        if (stillValid()) { resumeProjectId.current = null; throw cause; }
      }
      return;
    }
    setInput((current) => ({ ...current, summary: nextSummary, people: nextSummary.ready.faces ? mapped : null, peopleConfirmed: current.peopleConfirmed || (nextSummary.ready.faces && mapped !== null && (skipPeopleForNow.current || mapped.length === 0)) }));
    if (proposalId.current && nextSummary.ready.plan && !planLoad.current && !currentPlan.current) {
      planLoad.current = true;
      try {
        const plan = await repository.getPlan(proposalId.current);
        if (stillValid()) {
          const setAside = getSetAsideSummary(plan);
          const needsFilteredPhotoReview = setAside.blurry + setAside.duplicates > 0;
          setInput((current) => ({ ...current, plan, momentsConfirmed: !needsFilteredPhotoReview }));
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
      catch (cause) { if (!localState.localMediaPending) setError(reportFailure(cause)); }
      finally { polling = false; }
    };
    void poll();
    const stopReadiness = repository.watchReadiness?.(projectId, () => { void poll(); }, () => undefined);
    // Readiness snapshots refresh promptly; this slower poll preserves old API
    // compatibility and recovers when the listener is unavailable.
    const timer = setInterval(() => { void poll(); }, 10_000);
    return () => { mounted.current = false; clearInterval(timer); stopReadiness?.(); };
  }, [refresh, localState.localMediaPending]);

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
        const message = (cause as { message?: unknown })?.message;
        setError(typeof message === "string" && message ? `${message}. Check the pace and length, then try again.` : "Your film could not be composed. Check the pace and length, then try again.");
      } else {
        setInput((current) => ({ ...current, generation: { status: "failed", stage: "failed", progress: current.generation?.progress ?? 0, stepsDone: current.generation?.stepsDone ?? 0, film: null } }));
        setError(reportFailure(cause));
      }
    } finally {
      if (isCurrentProject()) filmReadPending.current = false;
    }
  }, [repository, projectId, currentProjectEpoch, directionOptions, recoverDirectionOptions]);
  pollFilmRef.current = (filmId) => { void pollFilm(filmId); };

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
      try {
        const result = await repository.createPlan([storyText, ...input.notes].join("\n"), []);
        if (!isCurrentProject()) return;
        proposalId.current = result.planId;
        setInput((current) => ({ ...current, pendingResponse: undefined, earlyOccasionAnswer: undefined, earlyOccasionStoryText: undefined, intent: { text: answer ?? input.earlyOccasionAnswer ?? storyText }, ...(mentionedPeople?.length ? { mentionedPeople } : {}), ...(storySummary ? { storySummary } : {}) }));
        setPendingInterpret(null);
        await refresh();
      } catch (cause) {
        if (!isCurrentProject()) return;
        planFailed.current = true; reportFailure(cause);
        setInput((current) => ({ ...current, pendingResponse: undefined, ...(!current.intent && current.earlyOccasionAnswer ? { earlyOccasionAnswer: undefined, earlyOccasionStoryText: undefined } : {}) }));
        setError("I couldn't shape this one. Try again.");
      }
      finally { if (isCurrentProject()) { occasionSaving.current = false; setSaving(false); } }
    },
    async setPerson(personId: string, role: string, name?: string) {
      if (personSaving.current) return;
      personSaving.current = true;
      setError(null);
      const people = input.people ?? [];
      const roleValue = role === "My daughter" || role === "My son" ? "child" : role === "Skip" ? "other" : "parent";
      const personName = name ?? (role === "Skip" ? undefined : role);
      const previousEdit = peopleEdits.current.get(personId);
      peopleEdits.current.set(personId, { name: role === "Skip" ? null : personName ?? null, role: roleValue, skipped: role === "Skip" });
      const updated = people.map((person) => person.personId === personId ? { ...person, role: roleValue, name: personName ?? null, skipped: role === "Skip" } : person);
      const duplicate = personName && role !== "Skip" ? matchExistingPersonAnswer(personName, people.filter((person) => person.personId !== personId)) : null;
      const target = duplicate ? people.find((person) => person.personId === duplicate.personId) : undefined;
      const source = updated.find((person) => person.personId === personId);
      const duplicateEvent = duplicate && target && source ? { id: `merge-followup-${personId}`, personId, targetPersonId: target.personId, answer: duplicate.answer, targetName: target.name ?? duplicate.answer, sampleFaces: (target.sampleFaces ?? []).slice(0, 2).map((face) => face.uri), questionFaces: (source.sampleFaces ?? []).slice(0, 2).map((face) => face.uri), momentCount: source.momentCount, ...(duplicate.mode === "automatic" ? { automatic: true } : {}) } : undefined;
      if (duplicate?.mode === "confirm") {
        const event = duplicateEvent!;
        setInput((current) => ({ ...current, people: updated, mergeEvents: [...(current.mergeEvents ?? []).filter(({ id }) => id !== event.id), event] }));
        personSaving.current = false;
        return;
      }
      setInput((current) => ({ ...current, people: updated, pendingResponse: "person" }));
      try {
        const merge = duplicate?.mode === "automatic" ? [{ fromPersonId: personId, toPersonId: duplicate.personId }] : [];
        const castPeople = merge.length ? updated.filter((person) => person.personId !== personId) : updated;
        const result = storyFlow?.repository === "fixture" ? null : await confirmCast(projectId, { people: castPeople.map((person) => ({ personId: person.personId, role: person.role as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], ...(merge.length ? { merges: merge } : {}), ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
        const revisedPlan = result?.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
        if (!isCurrentProject()) return;
        if (result?.proposalId) proposalId.current = result.proposalId;
        setInput((current) => ({ ...current, people: castPeople, pendingResponse: undefined, ...(revisedPlan ? { plan: revisedPlan, momentsConfirmed: getSetAsideSummary(revisedPlan).blurry + getSetAsideSummary(revisedPlan).duplicates === 0 } : {}), peopleConfirmed: false, ...(duplicateEvent ? { mergeEvents: [...(current.mergeEvents ?? []).filter(({ id }) => id !== duplicateEvent.id), duplicateEvent] } : {}) }));
        setError(null);
      } catch (cause) {
        if (previousEdit) peopleEdits.current.set(personId, previousEdit);
        else peopleEdits.current.delete(personId);
        setInput((current) => ({ ...current, people, pendingResponse: undefined }));
        setError(reportFailure(cause));
      }
      finally { if (isCurrentProject()) personSaving.current = false; }
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
          const updated = input.people ?? [];
          const result = storyFlow?.repository === "fixture" ? null : await confirmCast(projectId, { people: updated.map((person) => ({ personId: person.personId, role: (person.role ?? "other") as "child" | "parent" | "other", name: person.name ?? undefined, excluded: person.skipped })), focus: [], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
          const revisedPlan = result?.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
          if (!isCurrentProject()) return;
          if (result?.proposalId) proposalId.current = result.proposalId;
          setInput((current) => ({ ...current, ...(revisedPlan ? { plan: revisedPlan, momentsConfirmed: getSetAsideSummary(revisedPlan).blurry + getSetAsideSummary(revisedPlan).duplicates === 0 } : {}), mergeEvents: current.mergeEvents?.map((item) => item.id === eventId ? { ...item, response } : item) }));
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
        const result = await confirmCast(projectId, { people: people.map((person) => ({ personId: person.personId, role: "other" as const, excluded: false })), focus: [], ...(input.plan && proposalId.current ? { proposalId: proposalId.current } : {}) });
        const revisedPlan = result.proposalId ? { ...await repository.getPlan(result.proposalId), planId: result.proposalId } : undefined;
        if (!isCurrentProject()) return;
        if (result.proposalId) proposalId.current = result.proposalId;
        setInput((current) => ({ ...current, people, peopleSummaryConfirmed: false, ...(revisedPlan ? { plan: revisedPlan, momentsConfirmed: getSetAsideSummary(revisedPlan).blurry + getSetAsideSummary(revisedPlan).duplicates === 0 } : {}), peopleConfirmed: true })); setError(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save this. Please try again."); }
      finally { if (isCurrentProject()) personSaving.current = false; }
    },
    async completeMissedPerson(personId: string, name: string, momentCount: number, sampleUri?: string) {
      setInput((current) => {
        const people = current.people ?? [];
        const sampleFaces = sampleUri ? [{ shotId: "manual-sample", uri: sampleUri, bbox: [0, 0, 1, 1] as [number, number, number, number] }] : undefined;
        const updatedPeople = people.some((person) => person.personId === personId) ? people.map((person) => person.personId === personId ? { ...person, momentCount, ...(sampleFaces ? { sampleFaces } : {}) } : person) : [...people, { personId, name, role: "other", skipped: false, momentCount, sampleShotIds: [], days: [], ...(sampleFaces ? { sampleFaces } : {}) }];
        const missedPeople = (current.missedPeople ?? []).map((person) => person.personId === personId ? { ...person, momentCount } : person);
        const next = missedPeople.find((person) => person.momentCount === 0 && person.personId !== personId);
        return { ...current, people: updatedPeople, missedPeople, missedPersonTagging: next ? { personId: next.personId, name: next.name } : null };
      });
    },
    updatePersonTagCount(personId: string, momentCount: number) {
      setInput((current) => ({ ...current, people: (current.people ?? []).map((person) => person.personId === personId ? { ...person, momentCount } : person) }));
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
        setInput((current) => ({ ...current, peopleConfirmed: true, peopleSummaryConfirmed: true, ...(revisedPlan ? { plan: revisedPlan, momentsConfirmed: getSetAsideSummary(revisedPlan).blurry + getSetAsideSummary(revisedPlan).duplicates === 0 } : {}) }));
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
        const direction: Direction & { focus: string } = { note: `${directionOptions?.note ?? ""}${directionOptions?.note ? "\n" : ""}Focus: ${focusLabel}.`, cadenceId: directionSelection.cadenceId, soundtrackId: directionSelection.soundtrackId, durationId: directionSelection.durationId, ...(directionSelection.durationId === "short" ? { durationSec: directionSelection.durationSec } : {}), focus: focus.selected, collageAmount: directionSelection.collageAmount, motionFeel: directionSelection.motionFeel, aspect: effectiveAspect };
        compositionStartedAt.current = Date.now();
        setInput((current) => ({ ...current, direction: current.direction ? { ...current.direction, confirmed: true } : current.direction }));
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
      if (!text.trim()) return;
      if (state.step === "people" && state.items.some((item) => item.kind === "anyone-else")) {
        const names = text.split(/\s*(?:,|\band\b)\s*/i).map((name) => name.trim()).filter(Boolean);
        const added = names.map((name, index) => ({ personId: `p-missed-${Date.now()}-${index}`, name, momentCount: 0 }));
        if (added.length) setInput((current) => ({ ...current, missedPeople: [...(current.missedPeople ?? []), ...added], missedPersonTagging: added[0]! }));
        return;
      }
      if (!input.intent && (!canConfirmStory({ ...input, ...confirmationState }) || input.earlyOccasionAnswer)) {
        setInput((current) => current.earlyOccasionAnswer
          ? ({ ...current, notes: [...current.notes, text.trim()] })
          : ({ ...current, earlyOccasionAnswer: text.trim() }));
        return;
      }
      if (!summary) return;
      try {
        const step = state.step === "people" || state.step === "moments" || state.step === "direction" ? state.step : "occasion";
        const result = await repository.interpret(projectId, { step, text, context: { summary, people: (input.people ?? []).map(({ personId, name, role }) => ({ personId, name, role })) } });
        if (result.change.kind === "unclear") { setPendingInterpret({ reply: result.reply || UNCLEAR, text }); return; }
        const interpretedPeople = result.change.kind === "occasion" && Array.isArray(result.change.mentionedPeople)
          ? result.change.mentionedPeople.filter((person): person is string => typeof person === "string") : [];
        const storySummary = result.change.kind === "occasion" && typeof result.change.storyText === "string" ? result.change.storyText : undefined;
        setPendingInterpret({ reply: result.reply, text, ...(interpretedPeople.length ? { mentionedPeople: interpretedPeople } : {}), ...(storySummary ? { storySummary } : {}) });
      } catch (cause) { setError(reportFailure(cause)); }
    },
    async confirmInterpret() { if (pendingInterpret) return actions.confirmOccasion(pendingInterpret.text, undefined, pendingInterpret.mentionedPeople, pendingInterpret.storySummary); },
    answerOccasion(text: string, storyText?: string) {
      if (occasionSaving.current) return;
      const questionUploadComplete = state.items.find((item) => item.kind === "occasion-question")?.uploadComplete;
      setInput((current) => ({ ...current, earlyOccasionAnswer: text, ...(questionUploadComplete === undefined ? {} : { earlyOccasionQuestionUploadComplete: questionUploadComplete }), ...(storyText ? { earlyOccasionStoryText: storyText } : {}) }));
      if (canConfirmStory({ ...input, ...confirmationState })) void actions.confirmOccasion(text, storyText);
    },
    discardInterpret() { setPendingInterpret(null); },
  };
  useEffect(() => {
    if (!input.earlyOccasionAnswer || !canConfirmStory({ ...input, ...confirmationState }) || occasionSaving.current || input.intent) return;
    void actions.confirmOccasion(input.earlyOccasionAnswer, input.earlyOccasionStoryText);
  }, [input.earlyOccasionAnswer, input.earlyOccasionStoryText, input.summary, localState.localMediaPending, localState.uploadFailuresAcknowledged]);
  return { state, actions, error, retry: () => { setError(null); if (compositionRetryAvailable.current) { compositionRetryAvailable.current = false; void actions.shapeIt(); } else if (activeFilmId.current) void pollFilm(activeFilmId.current); else if (pendingDirectionOptions.current) void recoverDirectionOptions(pendingDirectionOptions.current); else void refresh().catch(cause => { if (isCurrentProject()) setError(reportFailure(cause)); }); }, pendingInterpret, saving, summary, plan: input.plan, directionOptions, directionSelection: { ...directionSelection, aspect: effectiveAspect }, people: input.people ?? [] };
}
