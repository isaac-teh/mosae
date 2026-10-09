import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Asset } from "expo-asset";
import { ChatComposer, ChatDirectionCard, ChatHeader, ChatMessage, ChatPersonQuestion, ChatProposal, ChatSetAsideCard, ChatShaping, ChatTyping } from "@/components/chat";
import { FacePreviewStrip } from "@/components/chat/ChatPersonQuestion";
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
import { directionFocus, contentTypeFor, getPendingMediaAssets, getPendingMediaProjectId, getUploadFailure, getUploadPreparationProgress, getUploadProgress, personAnswerChips, subscribeUploadProgress, retryPendingMedia } from "@mosae/core";

const previewSourceUri = (value: string) => value === "demo:film" ? Asset.fromModule(require("../assets/demo/film.mp4")).uri : value.startsWith("demo:") ? Asset.fromModule(demoImage(value.slice(5))).uri : value;

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
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = params.projectId ?? "";
  const story = useStoryFlow();
  const router = useRouter();
  const [name, setName] = useState("");
  const [namingPerson, setNamingPerson] = useState<string | null>(null);
  const [filmTimeline, setFilmTimeline] = useState<{ filmId: string; timeline: Timeline; sources: Record<string, string> } | null>(null);
  const [filmPlayerFailed, setFilmPlayerFailed] = useState(false);
  const [filmPreviewPlaying, setFilmPreviewPlaying] = useState(false);
  const chatScroll = useRef<React.ElementRef<typeof ScrollView>>(null);
  const actionPendingScroll = useRef(false);
  const userScrolledUp = useRef(false);
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
  const { state, actions, error, retry, pendingInterpret, saving, summary: projectSummary, plan, directionOptions, directionSelection, people } = useDirectorChat(projectId, story.repository, story.flow, { localMediaPending, uploadFailuresAcknowledged, ...(localUpload ? { localUpload } : {}) });
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
  return <View className="flex-1 bg-surface">
    <ChatHeader title={titleFromSummary(projectSummary)} confirmed={state.confirmed} ready={state.step === "ready"} onBack={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} />
    <ScrollView ref={chatScroll} accessibilityLabel="Director chat history" className="min-h-0 flex-1 px-5" contentContainerClassName="gap-5 py-6" contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => { userScrolledUp.current = false; }} onScroll={(event: any) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      if (contentOffset && contentSize && layoutMeasurement) userScrolledUp.current = contentOffset.y + layoutMeasurement.height < contentSize.height - 32;
    }} scrollEventThrottle={16} style={{ flex: 1, minHeight: 0 }}>
      {(uploadFailure || (projectSummary?.upload?.failed ?? 0) + (projectSummary?.upload?.cancelled ?? 0) > 0) && <View accessibilityRole="alert" className="gap-2 rounded-md bg-critical/10 p-3"><Text className="font-sans text-caption text-critical">{uploadFailure ?? `${(projectSummary?.upload?.failed ?? 0) + (projectSummary?.upload?.cancelled ?? 0)} files could not upload.`}</Text>
        <Button label="Retry uploads" variant="secondary" disabled={Boolean(preparationProgress) || Boolean(uploadProgress && uploadProgress.finishedFiles + uploadProgress.failedFiles < uploadProgress.totalFiles)} onPress={() => { setUploadFailuresAcknowledged(false); void retryPendingMedia(projectId).then((retried) => { if (!retried) router.push("/"); }); }} />
        {Boolean(uploadProgress ? uploadProgress.finishedFiles : projectSummary && projectSummary.total > 0 && projectSummary.processed.understood > 0) && !uploadFailuresAcknowledged && <Button label="Continue with uploaded files" onPress={() => setUploadFailuresAcknowledged(true)} />}
      </View>}
      {state.items.map((item) => {
        if (item.kind === "mosae" && item.id === "moments-conflict") return <ChatProposal key={item.id} question={item.text.endsWith("?") ? item.text : `${item.text} What would you like to do?`} replies={[{ id: "keep", label: "Keep it" }, { id: "leave", label: "Leave it out" }]} onReply={(choice) => scrollAfterAction(() => actions.resolveConflict(choice as "keep" | "leave"))} />;
        if (item.kind === "mosae") return <ChatMessage key={item.id} from="mosae" text={item.text} photos={item.photos} />;
        if (item.kind === "upload-status") {
          const uploadProgressValue = item.uploadTotal ? item.uploadDone / item.uploadTotal : 0;
          const understoodProgressValue = item.understoodTotal ? item.understood / item.understoodTotal : 0;
          const complete = item.uploadComplete && item.understoodComplete;
          const overallProgress = uploadProgressValue * 0.5 + understoodProgressValue * 0.5;
          const filledSegments = complete ? 10 : Math.floor(overallProgress * 10);
          const activeSegment = !complete && overallProgress < 1 ? filledSegments : -1;
          const segmentRow = <View className="flex-row gap-1">{Array.from({ length: 10 }, (_, index) => <View key={index} testID="upload-progress-segment" className={`h-1.5 flex-1 rounded-pill ${index === activeSegment ? "bg-accent" : index < filledSegments ? "bg-ink-muted" : "bg-line"}`} />)}</View>;
          const subject = item.photos && item.clips ? "photos and clips" : item.photos ? `photo${item.photos === 1 ? "" : "s"}` : `clip${item.clips === 1 ? "" : "s"}`;
          return <View key={item.id} accessibilityRole="progressbar" aria-label={`Uploading ${item.uploadDone} of ${item.uploadTotal}`} className="gap-3 rounded-md bg-surface-sunken p-3">
            {segmentRow}
            <View className="flex-row items-center gap-2"><Text className="font-sans text-caption text-ink-muted">{item.uploadComplete ? "✓" : "◷"}</Text><Text className="flex-1 font-sans text-caption text-ink">{item.uploadComplete ? `Uploaded your ${subject}` : `Uploading your ${subject}`}</Text><Text className="font-sans text-caption text-ink-muted">{item.uploadDone} of {item.uploadTotal}</Text></View>
            <View className="flex-row items-center gap-2"><Text className="font-sans text-caption text-ink-muted">{item.understoodComplete ? "✓" : item.understandingActive ? "◷" : "○"}</Text><Text className="flex-1 font-sans text-caption text-ink">{item.understoodComplete ? "Looked through all of them" : "Looking through them"}</Text>{item.understandingActive && !item.understoodComplete && <Text className="font-sans text-caption text-ink-muted">{item.understood} of {item.understoodTotal}</Text>}</View>
          </View>;
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
            <ChatSetAsideCard blurryCount={item.blurry} blurryPhotos={item.blurryPhotos} blurryMore={item.blurryMore} duplicateCount={item.duplicates} duplicatePhotos={item.duplicatePhotos} duplicateMore={item.duplicateMore} onOpen={() => scrollAfterAction(actions.seeSetAside)} />
            <ChatProposal replies={[{ id: "confirm", label: "Looks fine" }]} onReply={() => scrollAfterAction(actions.confirmMoments)} />
          </View>;
        }
        if (item.kind === "direction") {
          const { options: focusOptions, label: focusLabel } = directionFocus(people, item.focus, true);
          const maximumDurationSec = directionOptions?.maximumDurationSecByCadence?.[directionSelection.cadenceId] ?? directionOptions?.maximumDurationSec ?? Infinity;
          const durationChoices = directionOptions ? durationsForCadence(directionOptions, directionSelection.cadenceId) : [];
          const durationLabel = durationChoices.find(({ seconds }) => seconds === item.lengthSec)?.label ?? `${item.lengthSec} sec`;
          const explanation = `For ${durationLabel}, I'll focus on ${focusLabel === "The moments" ? "the moments" : focusLabel} and the strongest scenery, and tell you what I left out.`;
          return <View key={item.id} className="gap-4"><ChatDirectionCard aspect={item.aspect} orientation={item.orientation} pace={item.pace as "gentle" | "lively"} lengthSec={item.lengthSec} durations={durationChoices} focus={item.focus} collageAmount={directionSelection.collageAmount} motionFeel={directionSelection.motionFeel} focusOptions={focusOptions} onChange={(change) => scrollAfterAction(() => actions.setDirection(change))} /><ChatMessage from="mosae" text={explanation} /><Button label="Sounds good" disabled={saving || !directionOptions || durationChoices.length === 0} onPress={() => scrollAfterAction(actions.shapeIt)} /></View>;
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
          <View className="flex-row gap-2"><Button label="Open in editor" variant="secondary" onPress={() => router.push({ pathname: "/editor", params: { projectId: projectId || "fixture", planId: item.film.planId, generationId: item.film.filmId, request: "", ...story.flow } } as any)} /><Button label={item.film.generationStatus === "saved" ? "Saved" : "Save film"} disabled={saving || item.film.generationStatus === "saved"} onPress={() => scrollAfterAction(actions.saveFilm)} /></View>
        </View>;
        if (item.kind === "occasion-question") return pendingInterpret ? null : <View key={item.id} className="gap-2"><ChatMessage from="mosae" text={item.uploadComplete ? "Tell me a little about them. Is it a trip, a birthday celebration, or something else?" : "While they come in, tell me a little about them. Is it a trip, a birthday celebration, or something else?"} /><View className="flex-row flex-wrap gap-2"><Pressable role="button" aria-label="A trip" onPress={() => scrollAfterAction(() => actions.answerOccasion("A trip", projectSummary?.country ? `${projectSummary.country} trip` : "Our trip"))} className="rounded-pill border border-line-strong px-4 py-2"><Text className="font-sans text-caption text-ink">A trip</Text></Pressable><Pressable role="button" aria-label="A birthday celebration" onPress={() => scrollAfterAction(() => actions.answerOccasion("A birthday celebration", "Birthday celebration"))} className="rounded-pill border border-line-strong px-4 py-2"><Text className="font-sans text-caption text-ink">A birthday celebration</Text></Pressable></View><Text className="font-sans text-caption text-ink-muted">Something else? Type it in the box below.</Text></View>;
        if (item.kind === "person") return <View key={item.id} className="gap-3">
          <ChatPersonQuestion momentCount={item.momentCount} samples={item.sampleFaces} days={item.days} question={item.questionText} chips={personAnswerChips(item.ageBand, people.filter((person) => person.personId !== item.personId).map((person) => person.name ?? ""))} onPick={(role) => scrollAfterAction(() => actions.setPerson(item.personId, role))} onTypeName={() => scrollAfterAction(() => setNamingPerson(item.personId))} onSkip={() => scrollAfterAction(() => actions.setPerson(item.personId, "Skip"))} />
          {namingPerson === item.personId && <View className="flex-row gap-2"><TextInput accessibilityLabel="Person name" value={name} onChangeText={setName} className="min-h-11 flex-1 rounded-md border border-line-strong px-3 font-sans text-ink" /><Pressable role="button" onPress={() => scrollAfterAction(() => { if (name.trim()) return actions.setPerson(item.personId, "Type a name", name.trim()); setName(""); setNamingPerson(null); })} className="min-h-11 justify-center px-3"><Text className="font-sans-semibold text-action">Save name</Text></Pressable></View>}
        </View>;
        if (item.kind === "person-confirm") return <View key={item.id} className="gap-3">
          <ChatMessage from="mosae" text={item.text} />
          <FacePreviewStrip samples={item.sampleFaces} limit={2} />
          <ChatProposal replies={[{ id: "yes", label: "Yes" }, { id: "someone-else", label: "Someone else" }]} onReply={(choice) => scrollAfterAction(() => actions.resolveMentionedPerson(item.personId, item.label, choice === "yes"))} />
          <Button label="Skip this person" variant="quiet" onPress={() => scrollAfterAction(() => actions.setPerson(item.personId, "Skip"))} />
        </View>;
        if (item.kind === "merge-followup") return <View key={item.id} className="gap-3">
          <ChatMessage from="mosae" text={item.text} />
          <View className="flex-row gap-2">{item.photos.slice(0, 2).map((uri, index) => <StableUriImage key={`${item.id}-${index}`} uri={uri} accessibilityLabel={`Previously identified person ${index + 1}`} className="size-[72px] rounded-md" />)}</View>
          {item.response
            ? <ChatMessage from="you" text={item.response === "No, another person" ? `No, another ${item.text.replace(/^Same | as before\?$/g, "")}` : item.response} />
            : <ChatProposal question={item.answer} replies={[{ id: "same", label: "Yes, same person" }, { id: "different", label: `No, another ${item.text.replace(/^Same | as before\?$/g, "")}` }]} onReply={(choice) => scrollAfterAction(() => actions.resolvePersonMerge(item.id, choice === "same"))} />}
        </View>;
        if (item.kind === "anyone-else") return <View key={item.id} className="gap-3"><ChatProposal question="Anyone else?" replies={[{ id: "no", label: "No, that's everyone" }]} onReply={() => scrollAfterAction(actions.skipPeople)} /></View>;
        return null;
      })}
      {state.step === "people" && !state.items.some((item) => item.kind === "person" || item.kind === "anyone-else") && <Button label="Skip for now" variant="quiet" onPress={() => scrollAfterAction(actions.skipPeople)} />}
      {pendingInterpret && !localMediaPending && <View className="gap-3"><ChatMessage from="you" text={pendingInterpret.text} /><ChatMessage from="mosae" text={pendingInterpret.reply} /><ChatProposal replies={[{ id: "confirm", label: "Yes, that's right" }, { id: "discard", label: "Not quite" }]} onReply={(choice) => scrollAfterAction(() => choice === "confirm" ? actions.confirmInterpret() : actions.discardInterpret())} /></View>}
      {error && <View className="gap-2"><ChatMessage from="mosae" text={error} /><Pressable role="button" onPress={() => scrollAfterAction(() => { retry(); if (state.step === "occasion") return actions.confirmOccasion(); })} className="min-h-11 self-start justify-center"><Text className="font-sans-semibold text-action">Try again</Text></Pressable></View>}
    </ScrollView>
    {<ChatComposer placeholder={state.placeholder} disabled={saving} onSend={(text) => scrollAfterAction(() => state.step === "ready" ? actions.askForChange(text) : actions.send(text))} />}
  </View>;
}
