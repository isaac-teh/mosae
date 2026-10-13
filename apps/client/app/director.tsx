import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Asset } from "expo-asset";
import { ChatComposer, ChatDirectionCard, ChatHeader, ChatMessage, ChatProposal, ChatSetAsideCard, ChatShaping, ChatTyping } from "@/components/chat";
import { ChatPersonQuestion, FacePreviewStrip } from "@/components/chat/ChatPersonQuestion";
import { FilmPlayer } from "@/components/FilmPlayer";
import { Button } from "@/components/ds";
import { durationsForCadence, useDirectorChat } from "@/lib/useDirectorChat";
import { shouldAutoScrollAfterAction } from "@/lib/chatScroll";
import { useStoryFlow } from "@/lib/storyFlow";
import { EditorPreview } from "@/components/editor/EditorPreview";
import { demoImage } from "@/lib/demoAssets";
import { PendingPreviewUrls } from "@/lib/pendingPreviewUrls";
import { StableUriImage } from "@/components/StableUriImage";
import type { Timeline } from "@mosae/contracts";
import { createUploadRecoveryOwner, directionFocus, contentTypeFor, getPendingMediaAssets, getPendingMediaProjectId, getUploadFailure, getUploadPreparationProgress, getUploadProgress, getUploadRecoveryOwner, personAnswerChips, subscribeUploadProgress, retryPendingMedia, hasPendingMediaRetry, setPendingMedia, setPendingMediaRetry, setUploadFailure, setUploadProgress, setUploadRecoveryOwner, uploadMedia, runUploadRecovery, type UploadRecoveryEntry } from "@mosae/core";
import { MediaPicker, type MediaPickerHandle } from "@/components/MediaPicker";
import { consumeTaggedPersonResult } from "@/lib/taggedPersonResult";

const previewSourceUri = (value: string) => value === "demo:film" ? Asset.fromModule(require("../assets/demo/film.mp4")).uri : value.startsWith("demo:") ? Asset.fromModule(demoImage(value.slice(5))).uri : value;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

function UploadSpinner({ reducedMotion }: { reducedMotion: boolean }) {
  return reducedMotion
    ? <Text accessibilityLabel="In progress" className="font-sans text-caption text-ink-muted">◌</Text>
    : <ActivityIndicator size="small" color="#786f66" accessibilityLabel="In progress" />;
}

function PulsingSegment({ reducedMotion }: { reducedMotion: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reducedMotion) { opacity.setValue(1); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.4, duration: 500, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion]);
  return <Animated.View className="h-1.5 flex-1 rounded-pill bg-accent" style={{ opacity }} testID="upload-progress-segment" />;
}

function titleFromSummary(summary: { country: string | null; season: string | null; places: string[] } | null): string {
  if (!summary) return "Your film";
  const season = summary.season?.toLowerCase() ?? "";
  const monthName = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.exec(season)?.[0];
  const seasonName = /spring|summer|autumn|fall|winter/.exec(season)?.[0]?.replace("fall", "autumn")
    ?? (/(january|february)/.test(season) ? "winter"
      : /march|april|may/.test(season) ? "spring"
        : /june|july|august/.test(season) ? "summer"
          : /september|october|november/.test(season) ? "autumn"
            : /december/.test(season) ? "winter" : null);
  if (summary.country && (monthName || seasonName)) return `${summary.country}, ${monthName ? monthName[0]!.toUpperCase() + monthName.slice(1) : seasonName}`;
  return summary.places[0] || "Your film";
}

export default function DirectorScreen() {
  const reducedMotion = useReducedMotion();
  const params = useLocalSearchParams<{ projectId?: string; completedPersonId?: string; completedPersonName?: string; completedMomentCount?: string; completedIsMissed?: string; completedSampleUri?: string }>();
  const projectId = params.projectId ?? "";
  const story = useStoryFlow();
  const router = useRouter();
  const mediaPicker = useRef<MediaPickerHandle>(null);
  const [name, setName] = useState("");
  const [namingPerson, setNamingPerson] = useState<string | null>(null);
  const [filmTimeline, setFilmTimeline] = useState<{ filmId: string; timeline: Timeline; sources: Record<string, string> } | null>(null);
  const [filmPlayerFailed, setFilmPlayerFailed] = useState(false);
  const [filmPreviewPlaying, setFilmPreviewPlaying] = useState(false);
  const chatScroll = useRef<React.ElementRef<typeof ScrollView>>(null);
  const actionPendingScroll = useRef(false);
  const userScrolledUp = useRef(false);
  const userDragging = useRef(false);
  const previewUrls = useRef<PendingPreviewUrls | null>(null);
  if (!previewUrls.current) previewUrls.current = new PendingPreviewUrls();
  const previewUnmountVersion = useRef(0);
  const pendingProjectId = useSyncExternalStore(subscribeUploadProgress, getPendingMediaProjectId, getPendingMediaProjectId);
  const ownsPendingMedia = pendingProjectId === null || pendingProjectId === projectId;
  const sharedUploadProgress = useSyncExternalStore(subscribeUploadProgress, getUploadProgress, getUploadProgress);
  const uploadProgress = ownsPendingMedia ? sharedUploadProgress : null;
  const sharedPreparationProgress = useSyncExternalStore(subscribeUploadProgress, getUploadPreparationProgress, getUploadPreparationProgress);
  const preparationProgress = ownsPendingMedia ? sharedPreparationProgress : null;
  const sharedUploadFailure = useSyncExternalStore(subscribeUploadProgress, getUploadFailure, getUploadFailure);
  const uploadFailure = ownsPendingMedia ? sharedUploadFailure : null;
  const pendingMedia = useSyncExternalStore(subscribeUploadProgress, getPendingMediaAssets, getPendingMediaAssets);
  const pendingPhotos = (ownsPendingMedia ? pendingMedia : []).filter(({ file }) => !contentTypeFor(file).startsWith("video/"));
  const [uploadFailuresAcknowledged, setUploadFailuresAcknowledged] = useState(false);
  const localMediaPending = Boolean(preparationProgress) || Boolean(uploadProgress && (uploadProgress.finishedFiles + uploadProgress.failedFiles < uploadProgress.totalFiles || uploadProgress.finishedFiles === 0)) || Boolean((uploadFailure || uploadProgress?.failedFiles) && !uploadFailuresAcknowledged);
  const localUpload = uploadProgress || preparationProgress ? { total: uploadProgress?.totalFiles ?? preparationProgress!.totalFiles, settled: uploadProgress?.finishedFiles ?? 0, failed: uploadProgress?.failedFiles ?? 0, photos: pendingPhotos.length, clips: (ownsPendingMedia ? pendingMedia : []).length - pendingPhotos.length } : undefined;
  const { state, actions, error, retry, pendingInterpret, saving, summary: projectSummary, plan, directionOptions, directionSelection, people } = useDirectorChat(projectId, story.repository, story.flow, { localMediaPending, uploadFailuresAcknowledged, ...(localUpload ? { localUpload } : {}), ...(params.completedPersonId && params.completedSampleUri ? { taggedPerson: { personId: params.completedPersonId, name: params.completedPersonName ?? "", photos: [params.completedSampleUri] }, taggedMomentCount: Number(params.completedMomentCount ?? 0) } : {}) });
  const tagActions = useRef(actions);
  tagActions.current = actions;
  useFocusEffect(useCallback(() => {
    const result = consumeTaggedPersonResult();
    if (!result) return;
    if (result.isMissed) void tagActions.current.completeMissedPerson(result.personId, result.name ?? "", result.momentCount, result.sampleUri);
    else tagActions.current.updatePersonTagCount(result.personId, result.momentCount, result.sampleUri, result.name);
  }, []));
  useEffect(() => {
    if (!params.completedPersonId) return;
    if (params.completedIsMissed === "true") void actions.completeMissedPerson(params.completedPersonId, params.completedPersonName ?? "", Number(params.completedMomentCount ?? 0), params.completedSampleUri);
    else actions.updatePersonTagCount(params.completedPersonId, Number(params.completedMomentCount ?? 0), params.completedSampleUri, params.completedPersonName);
    router.setParams({ completedPersonId: undefined, completedPersonName: undefined, completedMomentCount: undefined, completedIsMissed: undefined, completedSampleUri: undefined });
  }, [params.completedPersonId, params.completedPersonName, params.completedMomentCount, params.completedIsMissed, params.completedSampleUri]);
  useEffect(() => { setUploadFailuresAcknowledged(false); }, [uploadProgress?.failedFiles, preparationProgress?.totalFiles]);
  useEffect(() => { previewUrls.current!.retain(pendingPhotos.map(({ file }) => file)); });
  useEffect(() => {
    previewUnmountVersion.current += 1;
    return () => {
      const unmountVersion = ++previewUnmountVersion.current;
      queueMicrotask(() => { if (previewUnmountVersion.current === unmountVersion) previewUrls.current!.dispose(); });
    };
  }, []);
  const filmItem = state.items.find((item) => item.kind === "film");
  const film = filmItem?.kind === "film" ? filmItem.film : null;
  const onFilmPlayerError = useCallback(() => setFilmPlayerFailed(true), []);
  const scrollAfterAction = useCallback((action: () => void | Promise<unknown>) => {
    userScrolledUp.current = false;
    actionPendingScroll.current = true;
    const result = action();
    requestAnimationFrame(() => {
      if (shouldAutoScrollAfterAction(actionPendingScroll.current, userScrolledUp.current)) chatScroll.current?.scrollToEnd({ animated: true });
    });
    void Promise.resolve(result).then(() => {
      requestAnimationFrame(() => {
        if (shouldAutoScrollAfterAction(actionPendingScroll.current, userScrolledUp.current)) chatScroll.current?.scrollToEnd({ animated: true });
        actionPendingScroll.current = false;
      });
    }, () => {
      requestAnimationFrame(() => { actionPendingScroll.current = false; });
    });
    return result;
  }, []);
  const replaceMissingMedia = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const replacementFiles = files.filter((file) => Boolean(contentTypeFor(file)));
    if (!replacementFiles.length) return;
    let owner = getUploadRecoveryOwner(projectId);
    if (!owner || owner.projectId !== projectId) {
      let recoverySummary = projectSummary;
      if (!recoverySummary) {
        try { recoverySummary = await story.repository.getSummary(projectId); }
        catch { setUploadFailure("Couldn't load the missing uploads. Check your connection and pick the files again."); return; }
      }
      // Another picker callback may have started while the summary was loading.
      owner = getUploadRecoveryOwner(projectId);
      if (owner) return;
      const legacyFailedIds = recoverySummary.upload?.failedAssetIds ?? [];
      const terminalTargets = recoverySummary.upload?.failedEntries ?? legacyFailedIds.map((assetId) => ({ assetId, sessionId: "" }));
      const pendingTargets = recoverySummary.upload?.closed ? recoverySummary.upload.pendingEntries?.map((entry) => ({ ...entry, pending: true })) ?? [] : [];
      const pendingCount = pendingTargets.length;
      const targets: { assetId: string; sessionId: string; pending?: boolean }[] = [...terminalTargets, ...pendingTargets];
      const transferFailed = recoverySummary.upload?.failed ?? terminalTargets.length;
      const uploaded = recoverySummary.upload?.uploaded ?? Math.max(0, (recoverySummary.upload?.settled ?? 0) - transferFailed - (recoverySummary.upload?.cancelled ?? 0));
      owner = createUploadRecoveryOwner(projectId, {
        totalFiles: recoverySummary.upload?.expected ?? recoverySummary.total ?? targets.length,
        uploadedFiles: uploaded,
        failedFiles: transferFailed + (recoverySummary.upload?.cancelled ?? 0),
        bytesSent: 0,
        totalBytes: 0,
      });
      owner.failedTargets = targets.map((target) => ({ assetId: target.assetId, sessionId: target.sessionId, ...(target.pending ? { pending: true } : {}) }));
      if (pendingCount > 0) setUploadFailure(`${pendingCount} uploads are still pending from a closed session. Pick those files again to resume them.`);
      setUploadRecoveryOwner(owner);
    }
    if (owner.retryInFlight) return;
    const retryTargets = owner.failedTargets.slice(0, replacementFiles.length);
    const additions = replacementFiles.slice(Math.min(owner.failedTargets.length, replacementFiles.length));
    const addedEntries: UploadRecoveryEntry[] = replacementFiles.map((file, index) => ({
      file,
      assetId: null,
      sessionId: null,
      status: "pending",
      ...(retryTargets[index] ? { replacesAssetId: retryTargets[index]!.assetId, replacesPending: Boolean(retryTargets[index]!.pending), ...(retryTargets[index]!.sessionId ? { replacesSessionId: retryTargets[index]!.sessionId } : {}) } : {}),
    }));
    owner.entries = owner.entries.filter((entry) => !retryTargets.some((target) => target.assetId === (entry.assetId ?? entry.replacesAssetId)));
    owner.entries.push(...addedEntries);
    owner.aggregate.totalFiles += additions.length;
    const recoveryOwner = owner;
    setPendingMedia(owner.entries.map((entry) => entry.file), owner.entries.map((entry) => entry.assetId ?? ""), projectId, owner.entries.map((entry) => entry.sessionId ?? ""));
    const runRecovery = async (selectedFiles: File[], entries: UploadRecoveryEntry[]) => {
      if (recoveryOwner.closeRetry) {
        try { await recoveryOwner.closeRetry(); recoveryOwner.closeRetry = null; }
        catch { setUploadFailure("The upload session couldn't close. Retry closing it before sending more files."); return; }
      }
      if (!entries.length) { setUploadFailure(null); return; }
      const previous = { ...recoveryOwner.aggregate };
      const replacingFailures = entries.filter((entry) => entry.status === "failed" || (entry.replacesAssetId && !entry.replacesPending)).length;
      const recoveryBaseFailed = Math.max(0, previous.failedFiles - replacingFailures);
      const replacesAssetIds = entries.map((entry) => entry.replacesAssetId ?? "");
      const replacesSessionIds = entries.map((entry) => entry.replacesSessionId ?? "");
      try {
        const result = await uploadMedia(selectedFiles, {
          mode: "memory",
          projectId,
          replacesAssetIds,
          replacesSessionIds,
          onEntryRegistered: ({ fileIndex, assetId, sessionId }) => {
            const entry = entries[fileIndex]!;
            entry.assetId = assetId;
            entry.sessionId = sessionId;
            entry.status = "pending";
            // A later retry must claim this successor, rather than its predecessor.
            entry.replacesAssetId = assetId;
            entry.replacesSessionId = sessionId;
            entry.replacesPending = false;
            recoveryOwner.failedTargets = recoveryOwner.failedTargets.filter((target) => target.assetId !== replacesAssetIds[fileIndex]);
            setPendingMedia(recoveryOwner.entries.map((item) => item.file), recoveryOwner.entries.map((item) => item.assetId ?? ""), projectId, recoveryOwner.entries.map((item) => item.sessionId ?? ""));
          },
          onProgress: (progress) => {
            progress.assetStatuses?.forEach((status) => {
              const entry = entries.find((item) => item.assetId === status.assetId);
              if (entry) entry.status = status.status === "uploaded" ? "uploaded" : status.status === "failed" ? "failed" : "pending";
            });
            const currentFailed = recoveryBaseFailed + progress.failedFiles;
            const currentUploaded = previous.uploadedFiles + progress.finishedFiles;
            recoveryOwner.aggregate = { ...previous, uploadedFiles: currentUploaded, failedFiles: currentFailed, bytesSent: previous.bytesSent + progress.bytesSent, totalBytes: Math.max(previous.totalBytes, previous.bytesSent + progress.totalBytes) };
            setUploadProgress({ ...progress, totalFiles: previous.totalFiles, finishedFiles: currentUploaded, failedFiles: currentFailed, bytesSent: recoveryOwner.aggregate.bytesSent, totalBytes: recoveryOwner.aggregate.totalBytes, assetStatuses: [...recoveryOwner.entries.filter((entry) => entry.status === "uploaded" && entry.assetId && !entries.includes(entry)).map((entry) => ({ assetId: entry.assetId!, sessionId: entry.sessionId ?? undefined, status: "uploaded" as const })), ...(progress.assetStatuses ?? [])] });
          },
          onCloseFailure: (retry) => { recoveryOwner.closeRetry = retry; setUploadFailure("The upload session couldn't close. Your transferred files are saved; retry closing the session."); },
          onReady: () => setPendingMedia(recoveryOwner.entries.map((item) => item.file), recoveryOwner.entries.map((item) => item.assetId ?? ""), projectId, recoveryOwner.entries.map((item) => item.sessionId ?? "")),
        });
        recoveryOwner.aggregate.uploadedFiles = previous.uploadedFiles + result.finished;
        recoveryOwner.aggregate.failedFiles = recoveryBaseFailed + result.failed;
        const freshFailures = entries.filter((entry) => entry.status === "failed" && entry.assetId && entry.sessionId).map((entry) => ({ assetId: entry.assetId!, sessionId: entry.sessionId! }));
        for (const target of freshFailures) if (!recoveryOwner.failedTargets.some((existing) => existing.assetId === target.assetId)) recoveryOwner.failedTargets.push(target);
        // Keep failed files and their newest successor receipts available for another retry.
        if (!recoveryOwner.closeRetry) setUploadFailure(recoveryOwner.failedTargets.length ? `${recoveryOwner.failedTargets.length} files still need to upload. Retry or pick the missing files again.` : null);
      } catch {
        entries.filter((entry) => entry.status !== "uploaded").forEach((entry) => { entry.status = "failed"; });
        recoveryOwner.aggregate.failedFiles = recoveryBaseFailed + entries.filter((entry) => entry.status === "failed").length;
        setUploadFailure("These files couldn't upload. Pick the missing files again to retry.");
      }
    };
    const guarded = () => runUploadRecovery(recoveryOwner, () => runRecovery(replacementFiles, addedEntries));
    setPendingMediaRetry(projectId, async () => {
      const failedEntries = recoveryOwner.entries.filter((entry) => entry.status !== "uploaded");
      await runRecovery(failedEntries.map((entry) => entry.file), failedEntries);
    });
    setUploadFailure(null);
    void guarded().finally(() => {
      const progress = getUploadProgress();
      if (getPendingMediaProjectId() === projectId && progress) setUploadProgress({ ...progress });
    });
  }, [projectId, projectSummary, story.repository]);
  useEffect(() => {
    if (!shouldAutoScrollAfterAction(actionPendingScroll.current, userScrolledUp.current)) return;
    requestAnimationFrame(() => {
      if (shouldAutoScrollAfterAction(actionPendingScroll.current, userScrolledUp.current)) chatScroll.current?.scrollToEnd({ animated: true });
    });
  }, [state.items, pendingInterpret, saving, error]);
  useEffect(() => {
    let active = true;
    setFilmPlayerFailed(false);
    if (!film) { setFilmTimeline(null); return () => { active = false; }; }
    setFilmTimeline(null);
    void story.repository.getFilmTimeline(projectId, film.filmId).then((result) => {
      if (active) setFilmTimeline({ filmId: film.filmId, timeline: result.timeline, sources: Object.fromEntries(Object.entries(result.sources).map(([id, source]) => [id, previewSourceUri(source)])) });
    }).catch(() => { if (active) setFilmPlayerFailed(true); });
    return () => { active = false; };
  }, [film?.filmId, projectId, story.repository]);
  const recoveryOwner = getUploadRecoveryOwner(projectId);
  const missingPending = !uploadProgress && projectSummary?.upload?.closed ? projectSummary.upload.pendingEntries?.length ?? 0 : 0;
  const failedUploads = uploadProgress ? uploadProgress.failedFiles : (projectSummary?.upload?.failed ?? 0) + (projectSummary?.upload?.cancelled ?? 0);
  const hasUploadFailure = Boolean(uploadFailure || failedUploads > 0 || missingPending > 0);
  const canRetryLocal = hasPendingMediaRetry(projectId) && (!recoveryOwner || Boolean(recoveryOwner.closeRetry) || recoveryOwner.entries.some((entry) => entry.status !== "uploaded"));
  const uploadBusy = Boolean(preparationProgress || recoveryOwner?.initialUploadInFlight || recoveryOwner?.retryInFlight || (!recoveryOwner && uploadProgress && uploadProgress.finishedFiles + uploadProgress.failedFiles < uploadProgress.totalFiles));
  const uploadFailureAlert = hasUploadFailure ? <View key="upload-failure-alert" accessibilityRole="alert" className="gap-2 rounded-md bg-critical/10 p-3"><Text className="font-sans text-caption text-critical">{uploadFailure ?? (missingPending ? `${failedUploads} files failed and ${missingPending} still need to upload.` : `${failedUploads} files could not upload.`)}</Text>
    <Button label={canRetryLocal ? "Retry uploads" : "Pick the missing files again"} variant="secondary" disabled={uploadBusy} onPress={() => { if (canRetryLocal) { setUploadFailuresAcknowledged(false); void retryPendingMedia(projectId); } else mediaPicker.current?.open(); }} />
    {Boolean(uploadProgress ? uploadProgress.finishedFiles : projectSummary && projectSummary.total > 0 && projectSummary.processed.understood > 0) && !uploadFailuresAcknowledged && <Button label="Continue with uploaded files" onPress={() => setUploadFailuresAcknowledged(true)} />}
  </View> : null;
  return <View className="flex-1 bg-surface">
    <MediaPicker ref={mediaPicker} onFiles={(files) => { void replaceMissingMedia(files); }} />
    <ChatHeader title={titleFromSummary(projectSummary)} confirmed={state.confirmed} ready={state.step === "ready"} onBack={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} />
    <ScrollView ref={chatScroll} accessibilityLabel="Director chat history" className="min-h-0 flex-1 px-5" contentContainerClassName="gap-5 py-6" contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => { userDragging.current = true; }} onScroll={(event: any) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      if (userDragging.current && contentOffset && contentSize && layoutMeasurement) userScrolledUp.current = contentOffset.y + layoutMeasurement.height < contentSize.height - 32;
    }} onScrollEndDrag={() => { userDragging.current = false; }} onMomentumScrollEnd={() => { userDragging.current = false; }} onContentSizeChange={() => { if (!userScrolledUp.current) requestAnimationFrame(() => chatScroll.current?.scrollToEnd({ animated: false })); }} scrollEventThrottle={16} style={{ flex: 1, minHeight: 0 }}>
      {state.items.map((item) => {
        if (item.kind === "mosae" && item.id === "moments-conflict") return <ChatProposal key={item.id} question={item.text.endsWith("?") ? item.text : `${item.text} What would you like to do?`} replies={[{ id: "keep", label: "Keep it" }, { id: "leave", label: "Leave it out" }]} onReply={(choice) => scrollAfterAction(() => actions.resolveConflict(choice as "keep" | "leave"))} />;
        if (item.kind === "mosae") return <ChatMessage key={item.id} from="mosae" text={item.text} photos={item.photos} faceSamples={item.faceSamples} />;
        if (item.kind === "upload-status") {
          const uploadProgressValue = item.uploadTotal ? item.uploadDone / item.uploadTotal : 0;
          const understoodProgressValue = item.understoodTotal ? Math.min(item.understood, item.understoodTotal) / item.understoodTotal : 0;
          const complete = item.uploadComplete && item.understoodComplete && (!item.facesApplicable || item.facesComplete);
          const overallProgress = uploadProgressValue * 0.45 + understoodProgressValue * 0.45 + (item.facesApplicable && item.facesComplete ? 0.1 : 0);
          const filledSegments = complete ? 10 : Math.floor(overallProgress * 10);
          const activeSegment = !complete && overallProgress < 1 ? filledSegments : -1;
          const segmentRow = <View className="flex-row gap-1">{Array.from({ length: 10 }, (_, index) => index === activeSegment
            ? <PulsingSegment key={index} reducedMotion={reducedMotion} />
            : <View key={index} testID="upload-progress-segment" className={`h-1.5 flex-1 rounded-pill ${index < filledSegments ? "bg-ink-muted" : "bg-line"}`} />)}</View>;
          const progressIcon = (done: boolean, active: boolean) => done
            ? <Text className="font-sans text-caption text-ink-muted">✓</Text>
            : active ? <UploadSpinner reducedMotion={reducedMotion} /> : <Text className="font-sans text-caption text-ink-muted">○</Text>;
          const subject = item.photos && item.clips ? "photos and clips" : item.photos ? `photo${item.photos === 1 ? "" : "s"}` : `clip${item.clips === 1 ? "" : "s"}`;
          return <Fragment key={item.id}><View accessibilityRole="progressbar" aria-label={`Uploading ${item.uploadDone} of ${item.uploadTotal}`} className="gap-3 rounded-md bg-surface-sunken p-3">
            {segmentRow}
            <View className="flex-row items-center gap-2">{progressIcon(item.uploadComplete, !item.uploadComplete)}<Text className="flex-1 font-sans text-caption text-ink">{item.uploadComplete ? item.uploadFailed ? `Uploaded ${item.uploadDone} of your ${subject}` : `Uploaded your ${subject}` : `Uploading your ${subject}`}</Text><Text className="font-sans text-caption text-ink-muted">{item.uploadDone} of {item.uploadTotal}{item.uploadFailed ? ` · ${item.uploadFailed} failed` : ""}</Text></View>
            <View className="flex-row items-center gap-2">{progressIcon(item.understoodComplete, item.understandingActive && !item.understoodComplete)}<Text className="flex-1 font-sans text-caption text-ink">{item.understoodComplete ? "Looked through all of them" : "Looking through them"}</Text>{item.understandingActive && !item.understoodComplete && <Text className="font-sans text-caption text-ink-muted">{item.understood} of {item.understoodTotal}</Text>}</View>
            {item.facesApplicable && <View className="flex-row items-center gap-2">{progressIcon(item.facesComplete, item.understoodComplete && !item.facesComplete)}<Text className="flex-1 font-sans text-caption text-ink">{item.facesComplete ? "Found the people in them" : "Finding the people in them"}</Text></View>}
          </View>{uploadFailureAlert}</Fragment>;
        }
        if (item.kind === "late-video") return item.status === "added"
          ? <View key={item.id} className="gap-2"><ChatMessage from="mosae" text={item.text} /><Button label="Undo" variant="quiet" onPress={() => scrollAfterAction(() => actions.resolveLateVideo(item.assetId, "undo"))} /></View>
          : <ChatProposal key={item.id} question={item.text} replies={[{ id: "add", label: "Add" }, { id: "dismiss", label: "No thanks" }]} onReply={(choice) => scrollAfterAction(() => actions.resolveLateVideo(item.assetId, choice as "add" | "dismiss"))} />;
        if (item.kind === "you") return <ChatMessage key={item.id} from="you" text={item.text} />;
        if (item.kind === "preparing-videos") return <View key={item.id} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 1, now: item.progress }} className="gap-2 rounded-md bg-surface-raised p-3"><Text className="font-sans text-body text-ink">{item.text}</Text><View className="h-2 overflow-hidden rounded-full bg-line"><View className="h-full rounded-full bg-action" style={{ width: `${Math.round(item.progress * 100)}%` }} /></View></View>;
        if (item.kind === "typing") {
          return <ChatTyping key={item.id} text={item.text} />;
        }
        if (item.kind === "shaping") return <ChatShaping key={item.id} progress={item.progress} stepsDone={item.stepsDone} />;
        if (item.kind === "set-aside") {
          const blurryLabel = `${item.blurry} blurry ${item.blurry === 1 ? "shot" : "shots"}`;
          const duplicateLabel = `${item.duplicates} near-duplicate${item.duplicates === 1 ? "" : "s"}`;
          const message = `I've set aside ${blurryLabel} and ${duplicateLabel}, keeping the best of each burst. Your originals are untouched.`;
          return <View key={item.id} className="gap-3">
            <ChatMessage from="mosae" text={message} />
            <Text className="font-sans text-caption text-ink-muted">Tap on the photos to view.</Text>
            <ChatSetAsideCard blurryCount={item.blurry} blurryPhotos={item.blurryPhotos} blurryMore={item.blurryMore} duplicateCount={item.duplicates} duplicatePhotos={item.duplicatePhotos} duplicateMore={item.duplicateMore} onOpen={() => scrollAfterAction(actions.seeSetAside)} onPhotoOpen={(photo) => scrollAfterAction(() => router.push({ pathname: "/photo-viewer", params: { uri: photo.uri } } as any))} />
            <ChatProposal replies={[{ id: "confirm", label: "Looks good" }]} onReply={() => scrollAfterAction(actions.confirmMoments)} />
          </View>;
        }
        if (item.kind === "direction" && error === "I couldn't put your film together this time.") return null;
        if (item.kind === "direction") {
          const { options: focusOptions } = directionFocus(people, item.focus, true);
          return <View key={item.id} className="gap-4"><ChatDirectionCard aspect={item.aspect} orientation={item.orientation} pace={item.pace as "gentle" | "lively"} focus={item.focus} collageAmount={directionSelection.collageAmount} motionFeel={directionSelection.motionFeel} focusOptions={focusOptions} onChange={(change) => scrollAfterAction(() => actions.setDirection(change))} /><Button label="Sounds good" disabled={saving || !directionOptions} onPress={() => scrollAfterAction(actions.shapeIt)} /></View>;
        }
        if (item.kind === "film") return <View key={item.id} className="gap-4">
          <Text accessibilityRole="header" className="font-title text-heading text-positive">Film ready</Text>
          <ChatMessage from="mosae" text="Here's your first cut. Tap to watch." />
          {item.film.videoUrl
            ? <FilmPlayer source={item.film.videoUrl} poster={{ uri: item.film.posterKey }} durationSec={item.film.durationSec} aspect={item.film.aspect === "16:9" ? "landscape" : "portrait"} />
            : filmTimeline?.filmId === item.film.filmId && !filmPlayerFailed
              ? <View className="relative w-full overflow-hidden rounded-[23px] bg-ink" style={{ aspectRatio: item.film.aspect === "16:9" ? 16 / 9 : 9 / 16 }}>
                  <EditorPreview timeline={filmTimeline.timeline} sources={filmTimeline.sources} poster={item.film.posterKey || undefined} onError={onFilmPlayerError} onPlayingChange={setFilmPreviewPlaying} controls="chat" />
                  {!filmPreviewPlaying && <View testID="film-preview-play-overlay" pointerEvents="none" className="absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-raised"><Text className="text-2xl text-accent">▶</Text></View>}
                </View>
              : item.film.posterKey
                ? <View className="relative w-full overflow-hidden rounded-[23px] bg-ink" style={{ aspectRatio: item.film.aspect === "16:9" ? 16 / 9 : 9 / 16 }}>
                    <Image source={{ uri: item.film.posterKey }} accessibilityLabel="Film poster" resizeMode="cover" className="size-full" />
                    <View className="absolute inset-x-0 bottom-0 bg-black/60 p-3"><Text className="font-sans text-caption text-on-screen">{filmPlayerFailed ? "Preview unavailable" : "Preparing your film…"}</Text></View>
                  </View>
                : <View className="w-full items-center justify-center rounded-[23px] bg-ink" style={{ aspectRatio: item.film.aspect === "16:9" ? 16 / 9 : 9 / 16 }}><Text className="font-sans text-body text-on-screen">{filmPlayerFailed ? "Preview unavailable" : "Loading your film…"}</Text></View>}
          <View className="gap-1"><Text className="font-title text-heading text-ink">{item.film.title}</Text><Text className="font-sans text-caption text-ink-muted">{plan?.chapters.length ?? 0} chapters</Text></View>
          <View className="gap-2"><Text className="font-sans-semibold text-button text-ink">How I directed it</Text>{item.film.reasons.slice(0, 3).map((reason, index) => <Text key={`${item.id}-reason-${index}`} className="font-sans text-body text-ink">• {reason}</Text>)}</View>
          <View className="flex-row flex-wrap gap-2"><Button label="Open in editor" variant="secondary" onPress={() => router.push({ pathname: "/editor", params: { projectId: projectId || "fixture", planId: item.film.planId, generationId: item.film.filmId, request: "", ...story.flow } } as any)} /><Button label={item.film.generationStatus === "saved" ? "Saved" : "Save film"} disabled={saving || item.film.generationStatus === "saved"} onPress={() => scrollAfterAction(actions.saveFilm)} /></View>
        </View>;
        if (item.kind === "occasion-question") return pendingInterpret ? null : <View key={item.id} className="gap-2"><ChatMessage from="mosae" text={item.uploadComplete ? "Tell me a little about them. Is it a trip, a birthday celebration, or something else?" : "While they come in, tell me a little about them. Is it a trip, a birthday celebration, or something else?"} /><View className="flex-row flex-wrap gap-2"><Pressable role="button" aria-label="A trip" onPress={() => scrollAfterAction(() => actions.answerOccasion("A trip", projectSummary?.country ? `${projectSummary.country} trip` : "Our trip"))} className="active:scale-[0.97] active:bg-surface-sunken rounded-pill border border-line-strong px-4 py-2" style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })}><Text className="font-sans text-caption text-ink">A trip</Text></Pressable><Pressable role="button" aria-label="A birthday celebration" onPress={() => scrollAfterAction(() => actions.answerOccasion("A birthday celebration", "Birthday celebration"))} className="active:scale-[0.97] active:bg-surface-sunken rounded-pill border border-line-strong px-4 py-2" style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })}><Text className="font-sans text-caption text-ink">A birthday celebration</Text></Pressable></View><Text className="font-sans text-caption text-ink-muted">Something else? Type it in the box below.</Text></View>;
        if (item.kind === "person") return <View key={item.id} className="gap-3">
          <ChatPersonQuestion momentCount={item.momentCount} samples={item.sampleFaces} days={item.days} question={item.questionText} chips={personAnswerChips(item.ageBand, people.filter((person) => person.personId !== item.personId).map((person) => person.name ?? ""))} onPick={(role) => scrollAfterAction(() => actions.setPerson(item.personId, role))} onTypeName={() => scrollAfterAction(() => setNamingPerson(item.personId))} onSkip={() => scrollAfterAction(() => actions.setPerson(item.personId, "Skip"))} onTagIt={() => scrollAfterAction(() => router.push({ pathname: "/tag-moments", params: { projectId, repository: story.flow.repository, personId: item.personId, name: "", faceUri: item.sampleFaces[0]?.uri, source: "identity" } } as any))} />
          {namingPerson === item.personId && <View className="flex-row gap-2"><TextInput accessibilityLabel="Person name" placeholder="What's their name?" value={name} onChangeText={setName} className="min-h-11 flex-1 rounded-md border border-line-strong px-3 font-sans text-ink" /><Pressable role="button" onPress={() => scrollAfterAction(() => { const answerName = name.trim(); setName(""); setNamingPerson(null); return answerName ? actions.setPerson(item.personId, "Type a name", answerName) : undefined; })} style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })} className="active:scale-[0.97] active:bg-surface-sunken min-h-11 justify-center px-3"><Text className="font-sans-semibold text-action">Save name</Text></Pressable></View>}
        </View>;
        if (item.kind === "person-confirm") return <View key={item.id} className="gap-3">
          <ChatMessage from="mosae" text={item.text} /><FacePreviewStrip samples={item.sampleFaces} limit={2} />
          <ChatProposal replies={[{ id: "yes", label: "Yes" }, { id: "someone-else", label: "Someone else" }]} onReply={(choice) => scrollAfterAction(() => actions.resolveMentionedPerson(item.personId, item.label, choice === "yes"))} />
          <Button label="Skip this person" variant="quiet" onPress={() => scrollAfterAction(() => actions.setPerson(item.personId, "Skip"))} />
        </View>;
        if (item.kind === "merge-followup") return <View key={item.id} className="gap-3">
          <ChatMessage from="mosae" text={item.text} />
          {item.faceSamples?.length ? <FacePreviewStrip samples={item.faceSamples} limit={2} /> : <View className="flex-row gap-2">{item.photos.slice(0, 2).map((uri, index) => <StableUriImage key={`${item.id}-${index}`} uri={uri} accessibilityLabel={`Previously identified person ${index + 1}`} className="size-[72px] rounded-md" />)}</View>}
          {item.response
            ? <ChatMessage from="you" text={item.response === "No, another person" ? `No, another ${item.text.replace(/^Same | as before\?$/g, "")}` : item.response} />
            : <ChatProposal question={item.answer} replies={[{ id: "same", label: "Yes, same person" }, { id: "different", label: `No, another ${item.text.replace(/^Same | as before\?$/g, "")}` }]} onReply={(choice) => scrollAfterAction(() => actions.resolvePersonMerge(item.id, choice === "same"))} />}
        </View>;
        if (item.kind === "anyone-else") return <View key={item.id} className="gap-3"><ChatMessage from="mosae" text={item.text ?? "Did I miss anyone? Type the names of who were missed in the box below."} /><ChatProposal replies={[{ id: "no", label: "That's everyone" }]} onReply={() => scrollAfterAction(actions.confirmPeopleSummary)} /></View>;
        if (item.kind === "missed-person") return <View key={item.id} className="gap-2"><Button label="Tap to select" variant="secondary" onPress={() => scrollAfterAction(() => router.push({ pathname: "/tag-moments", params: { projectId, repository: story.flow.repository, personId: item.personId, name: item.name, source: "missed" } } as any))} /></View>;
        if (item.kind === "people-summary") return <View key={item.id} className="gap-3">
          <View className="overflow-hidden rounded-md border border-line bg-surface-raised">{item.people.map((person) => <View key={person.personId} className="flex-row items-center gap-2 border-b border-line p-3">
            <Pressable role="button" accessibilityLabel={`Review ${person.name}`} onPress={() => router.push({ pathname: "/tag-moments", params: { projectId, repository: story.flow.repository, personId: person.personId, name: person.name } } as any)} style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })} className="active:scale-[0.97] active:bg-surface-sunken flex-1 flex-row items-center gap-3">
              {person.sampleFace ? <FacePreviewStrip samples={[person.sampleFace]} limit={1} size={48} rounded /> : person.sampleUri ? <StableUriImage uri={person.sampleUri} accessibilityLabel={`${person.name} face`} className="size-12 rounded-full" /> : <View className="size-12 rounded-full bg-surface-sunken" />}
              <View className="flex-1"><Text className="font-sans-semibold text-label text-ink">{person.name}</Text><Text className="font-sans text-caption text-ink-muted">Tagged in {person.momentCount} {person.momentCount === 1 ? "moment" : "moments"}</Text></View><Text className="text-heading text-ink-muted">›</Text>
            </Pressable>
            <Pressable role="button" accessibilityLabel={`Change ${person.name}`} onPress={() => router.push({ pathname: "/tag-moments", params: { projectId, repository: story.flow.repository, personId: person.personId, name: person.name } } as any)} className="min-h-11 justify-center px-2"><Text className="font-sans-semibold text-caption text-action">Change</Text></Pressable>
          </View>)}</View>
          <Text className="font-sans text-caption text-ink-muted">Tap a person to check their moments.</Text>
        </View>;
        return null;
      })}
      {!state.items.some((item) => item.kind === "upload-status") && uploadFailureAlert}
      {state.step === "people" && !state.items.some((item) => item.kind === "person" || item.kind === "anyone-else" || item.kind === "people-summary") && <Button label="Skip for now" variant="quiet" onPress={() => scrollAfterAction(actions.skipPeople)} />}
      {pendingInterpret && !localMediaPending && <View className="gap-3"><ChatMessage from="you" text={pendingInterpret.text} /><ChatMessage from="mosae" text={pendingInterpret.reply} />{(pendingInterpret.change?.kind === "person" || pendingInterpret.mentionedPeople || pendingInterpret.storySummary) && <ChatProposal replies={[{ id: "confirm", label: "Yes, that's right" }, { id: "discard", label: "Not quite" }]} onReply={(choice) => scrollAfterAction(() => choice === "confirm" ? actions.confirmInterpret() : actions.discardInterpret())} />}</View>}
      {error && <View className="gap-2"><ChatMessage from="mosae" text={error} /><Pressable role="button" onPress={() => scrollAfterAction(() => { retry(); if (state.step === "occasion") return actions.confirmOccasion(); })} style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })} className="active:scale-[0.97] active:bg-surface-sunken min-h-11 self-start justify-center"><Text className="font-sans-semibold text-action">Try again</Text></Pressable></View>}
    </ScrollView>
    {<ChatComposer placeholder={state.placeholder} disabled={saving} onSend={(text) => scrollAfterAction(() => state.step === "ready" ? actions.askForChange(text) : actions.send(text))} />}
  </View>;
}
