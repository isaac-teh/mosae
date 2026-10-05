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
  const readingAssets = pendingPhotos.filter(({ assetId }) => Boolean(assetId)).map(({ file, assetId }) => ({ assetId: assetId!, key: previewUrls.current!.key(file), uri: previewUrls.current!.get(file) }));
  const selectedPhotos = pendingPhotos.map(({ file }, index) => ({ key: previewUrls.current!.key(file), uri: previewUrls.current!.get(file), index }));
  const [uploadFailuresAcknowledged, setUploadFailuresAcknowledged] = useState(false);
  const localMediaPending = Boolean(preparationProgress) || Boolean(uploadProgress && (uploadProgress.finishedFiles + uploadProgress.failedFiles < uploadProgress.totalFiles || uploadProgress.finishedFiles === 0)) || Boolean((uploadFailure || uploadProgress?.failedFiles) && !uploadFailuresAcknowledged);
  const { state, actions, error, retry, pendingInterpret, saving, summary: projectSummary, plan, directionOptions, directionSelection, people } = useDirectorChat(projectId, story.repository, story.flow, { localMediaPending, uploadFailuresAcknowledged });
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
      {(preparationProgress || uploadProgress && uploadProgress.finishedFiles + uploadProgress.failedFiles < uploadProgress.totalFiles) && <View accessibilityRole="progressbar" aria-label="Preparing and uploading selected photos" className="gap-3 rounded-md bg-surface-sunken p-3">
        <View className="flex-row items-center justify-between"><Text className="font-sans-semibold text-label text-ink">{preparationProgress ? `Preparing ${preparationProgress.preparedFiles} of ${preparationProgress.totalFiles}` : "Uploading your photos"}</Text>{uploadProgress && <Text className="font-sans text-caption text-ink-muted">{uploadProgress.finishedFiles + uploadProgress.failedFiles} of {uploadProgress.totalFiles}</Text>}</View>
        {preparationProgress && <Text className="font-sans text-caption text-ink-muted">Getting your photos ready while you start your story.</Text>}
        {uploadProgress && <><View className="h-1.5 overflow-hidden rounded-pill bg-line"><View className="h-full rounded-pill bg-action" style={{ width: `${uploadProgress.totalBytes ? Math.min(100, Math.round(uploadProgress.bytesSent / uploadProgress.totalBytes * 100)) : 100}%` }} /></View>
        <Text className="font-sans text-caption text-ink-muted">{(uploadProgress.bytesSent / 1_000_000).toFixed(1)} of {(uploadProgress.totalBytes / 1_000_000).toFixed(1)} MB transferred</Text></>}
        <View className="flex-row flex-wrap gap-2">{preparationProgress ? selectedPhotos.map(({ key, uri, index }) => <Image key={key} source={{ uri }} accessibilityLabel={`Selected photo ${index + 1}`} className="size-12 rounded-sm" />) : readingAssets.map(({ key, assetId, uri }, index) => {
          const local = uploadProgress?.assetStatuses?.find((asset) => asset.assetId === assetId)?.status;
          const server = projectSummary?.assetStatuses?.find((asset) => asset.assetId === assetId)?.status;
          const status = server === "understood" ? "understood" : server === "ingested" || server === "uploaded" ? "uploaded" : local;
          const label = status === "understood" ? "understood" : status === "uploaded" ? "uploaded" : status === "failed" ? "failed" : "uploading";
          return <Image key={key} source={{ uri }} accessibilityLabel={`Photo ${index + 1}, ${label}`} className="size-12 rounded-sm" />;
        })}</View>
      </View>}
      {(uploadFailure || (projectSummary?.upload?.failed ?? 0) + (projectSummary?.upload?.cancelled ?? 0) > 0) && <View accessibilityRole="alert" className="gap-2 rounded-md bg-critical/10 p-3"><Text className="font-sans text-caption text-critical">{uploadFailure ?? `${(projectSummary?.upload?.failed ?? 0) + (projectSummary?.upload?.cancelled ?? 0)} files could not upload.`}</Text>
        <Button label="Retry uploads" variant="secondary" disabled={Boolean(preparationProgress) || Boolean(uploadProgress && uploadProgress.finishedFiles + uploadProgress.failedFiles < uploadProgress.totalFiles)} onPress={() => { setUploadFailuresAcknowledged(false); void retryPendingMedia(projectId).then((retried) => { if (!retried) router.push("/"); }); }} />
        {Boolean(uploadProgress ? uploadProgress.finishedFiles : projectSummary && projectSummary.total > 0 && projectSummary.processed.understood > 0) && !uploadFailuresAcknowledged && <Button label="Continue with uploaded files" onPress={() => setUploadFailuresAcknowledged(true)} />}
      </View>}
      {state.items.map((item) => {
        if (item.kind === "mosae" && item.id === "moments-conflict") return <ChatProposal key={item.id} question={item.text.endsWith("?") ? item.text : `${item.text} What would you like to do?`} replies={[{ id: "keep", label: "Keep it" }, { id: "leave", label: "Leave it out" }]} onReply={(choice) => scrollAfterAction(() => actions.resolveConflict(choice as "keep" | "leave"))} />;
        if (item.kind === "mosae") return <ChatMessage key={item.id} from="mosae" text={item.text} photos={item.photos} />;
        if (item.kind === "you") return <ChatMessage key={item.id} from="you" text={item.text} />;
        if (item.kind === "typing") {
          const statuses = new Map((item.photoProgress ?? projectSummary?.assetStatuses ?? []).map((asset) => [asset.assetId, asset.status]));
          const localStatuses = new Map((uploadProgress?.assetStatuses ?? []).map((asset) => [asset.assetId, asset.status]));
          const photos = readingAssets.flatMap(({ assetId, key, uri }, index) => {
            const server = statuses.get(assetId);
            const status = server === "understood" ? "understood" : server === "ingested" || server === "uploaded" ? "uploaded" : localStatuses.get(assetId);
            const label = status === "understood" ? "understood" : status === "uploaded" ? "uploaded" : status === "failed" ? "couldn't read" : status === "uploading" ? "uploading" : "still reading";
            return status || (readingAssets.length > 0 && localMediaPending) ? [{ id: key, uri, understood: status === "understood", label: `Photo ${index + 1} of ${readingAssets.length}, ${label}` }] : [];
          });
          return <ChatTyping key={item.id} text={item.text} photos={photos} />;
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
          return <View key={item.id} className="gap-4"><ChatDirectionCard pace={item.pace as "gentle" | "lively"} lengthSec={item.lengthSec} durations={durationChoices} focus={item.focus} collageAmount={directionSelection.collageAmount} motionFeel={directionSelection.motionFeel} focusOptions={focusOptions} onChange={(change) => scrollAfterAction(() => actions.setDirection(change))} /><ChatMessage from="mosae" text={explanation} /><Button label="Sounds good" disabled={saving || !directionOptions || durationChoices.length === 0} onPress={() => scrollAfterAction(actions.shapeIt)} /></View>;
        }
        if (item.kind === "film") return <View key={item.id} className="gap-4">
          <Text accessibilityRole="header" className="font-title text-heading text-positive">Film ready</Text>
          <ChatMessage from="mosae" text="Here's your first cut. Tap to watch." />
          {item.film.videoUrl
            ? <FilmPlayer source={item.film.videoUrl} poster={{ uri: item.film.posterKey }} durationSec={item.film.durationSec} aspect="portrait" />
            : filmTimeline?.filmId === item.film.filmId && !filmPlayerFailed
              ? <View className="relative w-full overflow-hidden rounded-[23px] bg-ink" style={{ aspectRatio: 9 / 16 }}>
                  <EditorPreview timeline={filmTimeline.timeline} sources={filmTimeline.sources} poster={item.film.posterKey || undefined} onError={onFilmPlayerError} onPlayingChange={setFilmPreviewPlaying} controls="chat" />
                  {!filmPreviewPlaying && <View testID="film-preview-play-overlay" pointerEvents="none" className="absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-raised"><Text className="text-2xl text-accent">▶</Text></View>}
                </View>
              : item.film.posterKey
                ? <View className="relative w-full overflow-hidden rounded-[23px] bg-ink" style={{ aspectRatio: 9 / 16 }}>
                    <Image source={{ uri: item.film.posterKey }} accessibilityLabel="Film poster" resizeMode="cover" className="size-full" />
                    <View className="absolute inset-x-0 bottom-0 bg-black/60 p-3"><Text className="font-sans text-caption text-on-screen">{filmPlayerFailed ? "Preview unavailable" : "Preparing your film…"}</Text></View>
                  </View>
                : <View className="w-full items-center justify-center rounded-[23px] bg-ink" style={{ aspectRatio: 9 / 16 }}><Text className="font-sans text-body text-on-screen">{filmPlayerFailed ? "Preview unavailable" : "Loading your film…"}</Text></View>}
          <View className="gap-1"><Text className="font-title text-heading text-ink">{item.film.title}</Text><Text className="font-sans text-caption text-ink-muted">{plan?.chapters.length ?? 0} chapters</Text></View>
          <View className="gap-2"><Text className="font-sans-semibold text-button text-ink">How I directed it</Text>{item.film.reasons.slice(0, 3).map((reason, index) => <Text key={`${item.id}-reason-${index}`} className="font-sans text-body text-ink">• {reason}</Text>)}</View>
          <View className="flex-row gap-2"><Button label="Open in editor" variant="secondary" onPress={() => router.push({ pathname: "/editor", params: { projectId: projectId || "fixture", planId: item.film.planId, generationId: item.film.filmId, request: "", ...story.flow } } as any)} /><Button label={item.film.generationStatus === "saved" ? "Saved" : "Save film"} disabled={saving || item.film.generationStatus === "saved"} onPress={() => scrollAfterAction(actions.saveFilm)} /></View>
        </View>;
        if (item.kind === "occasion") {
          if (!projectSummary || (!projectSummary.country && !projectSummary.season && projectSummary.places.length === 0)) return null;
          const country = projectSummary?.country;
          const answer = country ? `Yes, our ${country} trip` : "Yes, that's our story";
          const storyText = country ? `${country} trip` : projectSummary?.places[0] ?? "Our story";
          // The occasion chip is only an available answer until the user has
          // typed a free-text answer; then the confirmation card owns the turn.
          if (saving || pendingInterpret) return null;
          return <Pressable key={item.id} role="button" aria-label={answer} onPress={() => scrollAfterAction(() => actions.confirmOccasion(answer, storyText))} className="max-w-[80%] self-end rounded-md bg-bubble-you px-4 py-3"><Text className="font-sans text-body text-ink">{answer}</Text></Pressable>;
        }
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
