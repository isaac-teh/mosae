import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { createUploadRecoveryOwner, isMedia, setPendingMediaRetry, setPendingMedia, setUploadRecoveryOwner, setUploadFailure, setUploadPreparationProgress, setUploadProgress as setSharedUploadProgress, uploadMedia, type FilmListItem, type UploadPreparationProgress, type UploadProgress, type UploadRecoveryOwner } from "@mosae/core";
import { Button, FilmCard } from "@/components/ds";
import { SettingsIcon } from "@/components/icons";
import { MediaPicker, type MediaPickerHandle } from "@/components/MediaPicker";
import { useStoryFlow } from "@/lib/storyFlow";
import { startDemoTrip } from "@/lib/startDemoTrip";

export default function Home() {
  const [films, setFilms] = useState<FilmListItem[] | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [preparationProgress, setPreparationProgress] = useState<UploadPreparationProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const router = useRouter();
  const story = useStoryFlow();
  const { repository } = story;
  const pickerRef = useRef<MediaPickerHandle>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    void repository.listFilms().then((result) => { if (active) setFilms(result); }).catch(() => { if (active) setFilms([]); });
    return () => { active = false; };
  }, [repository]));

  function createFilm() { pickerRef.current?.open(); }
  async function tryDemo() {
    if (demoBusy) return;
    setDemoBusy(true); setDemoError(null);
    try { await startDemoTrip(router); }
    catch { setDemoError("Could not start the demo trip. Try again."); }
    finally { setDemoBusy(false); }
  }
  async function startWithMedia(files: File[]) {
    const media = files.filter(isMedia);
    if (media.length === 0 || uploading) return;
    setUploading(true);
    setUploadProgress(null);
    setPreparationProgress(null);
    setSharedUploadProgress(null);
    setUploadPreparationProgress(null);
    setUploadFailure(null);
    setUploadError(null);
    let routed = false;
    let ownerProjectId: string | undefined;
    let registered = false;
    let assetIdsByFile: string[] = [];
    let sessionIdsByFile: string[] = [];
    let recovery: UploadRecoveryOwner | null = null;
    const retryUpload = async () => {
      if (!ownerProjectId || !recovery) return;
      if (recovery.closeRetry) {
        try { await recovery.closeRetry(); recovery.closeRetry = null; }
        catch { setUploadFailure("The upload session could not finish. Check your connection and try again."); return; }
      }
      const retryEntries = recovery.entries.filter((entry) => entry.status === "failed");
      if (retryEntries.length === 0) { setUploadFailure(null); return; }
      const retryFiles = retryEntries.map((entry) => entry.file);
      const replacesAssetIds = retryEntries.map((entry) => entry.assetId ?? "");
      const replacesSessionIds = retryEntries.map((entry) => entry.sessionId ?? "");
      let retryFinished = 0;
      const previous = { ...recovery.aggregate };
      setUploadFailure(null);
      setUploadPreparationProgress({ totalFiles: retryFiles.length, preparedFiles: 0 });
      try {
        const result = await uploadMedia(retryFiles, {
          mode: "memory", projectId: ownerProjectId,
          replacesAssetIds, replacesSessionIds,
          onPreparationProgress: (progress) => { setPreparationProgress(progress); setUploadPreparationProgress(progress); },
          onProgress: (progress) => {
            retryFinished = progress.finishedFiles;
            recovery!.aggregate = { ...previous, uploadedFiles: previous.uploadedFiles + progress.finishedFiles, failedFiles: Math.max(0, previous.failedFiles - retryEntries.length) + progress.failedFiles, bytesSent: previous.bytesSent + progress.bytesSent, totalBytes: Math.max(previous.totalBytes, previous.bytesSent + progress.totalBytes) };
            for (const status of progress.assetStatuses ?? []) { const candidate = retryEntries.find((entry) => entry.assetId === status.assetId); if (candidate) candidate.status = status.status === "uploaded" ? "uploaded" : status.status === "failed" ? "failed" : "pending"; }
            setSharedUploadProgress({ ...progress, totalFiles: previous.totalFiles, finishedFiles: recovery!.aggregate.uploadedFiles, failedFiles: recovery!.aggregate.failedFiles, bytesSent: recovery!.aggregate.bytesSent, totalBytes: recovery!.aggregate.totalBytes });
          },
          onCloseFailure: retry => { recovery!.closeRetry = retry; },
          onFileFailed: (file) => { const candidate = retryEntries.find((entry) => entry.file === file); if (candidate) candidate.status = "failed"; },
          onEntryRegistered: ({ fileIndex, assetId, sessionId }) => {
            const candidate = retryEntries[fileIndex];
            if (candidate) { candidate.status = "pending"; candidate.assetId = assetId; candidate.sessionId = sessionId; }
            const index = media.indexOf(retryEntries[fileIndex]!.file);
            if (index >= 0) { assetIdsByFile[index] = assetId; sessionIdsByFile[index] = sessionId; }
            setPendingMedia(media, assetIdsByFile, ownerProjectId, sessionIdsByFile);
          },
          onReady: () => {
            setPendingMedia(media, assetIdsByFile, ownerProjectId, sessionIdsByFile);
            setPreparationProgress(null); setUploadPreparationProgress(null);
          },
        });
        if (result.failed) setUploadFailure(`${result.failed} files couldn't upload. Try again or continue with uploaded files.`);
      } catch { if (recovery) { recovery.aggregate.uploadedFiles = previous.uploadedFiles + retryFinished; retryEntries.filter((entry) => entry.status !== "uploaded").forEach((entry) => { entry.status = "failed"; }); recovery.aggregate.failedFiles = Math.max(0, previous.failedFiles - retryEntries.length) + retryEntries.filter((entry) => entry.status === "failed").length; } setUploadFailure("These photos couldn't upload. Check your connection and try again."); }
      finally { setPreparationProgress(null); setUploadPreparationProgress(null); }
    };
    try {
      const result = await uploadMedia(media, {
        mode: "memory",
        onCloseFailure: retry => { if (recovery) recovery.closeRetry = retry; },
        onFileFailed: (file) => { const index = media.indexOf(file); if (recovery && index >= 0) recovery.entries[index]!.status = "failed"; },
        onProgress: (progress) => {
          setUploadProgress(progress);
          if (recovery) {
            recovery.aggregate = { totalFiles: progress.totalFiles, uploadedFiles: progress.finishedFiles, failedFiles: progress.failedFiles, bytesSent: progress.bytesSent, totalBytes: progress.totalBytes };
            for (const status of progress.assetStatuses ?? []) { const candidate = recovery.entries.find((entry) => entry.assetId === status.assetId); if (candidate) candidate.status = status.status === "uploaded" ? "uploaded" : status.status === "failed" ? "failed" : "pending"; }
          }
          setSharedUploadProgress(progress);
        },
        onPreparationProgress: (progress) => { setPreparationProgress(progress); setUploadPreparationProgress(progress); },
        onProjectReady: (projectId) => {
          routed = true;
          ownerProjectId = projectId;
          recovery = createUploadRecoveryOwner(projectId, { totalFiles: media.length, uploadedFiles: 0, failedFiles: 0, bytesSent: 0, totalBytes: 0 }, media);
          recovery.initialUploadInFlight = true;
          setUploadRecoveryOwner(recovery);
          setPendingMediaRetry(projectId, retryUpload);
          setPendingMedia(media, [], projectId);
          router.push({ pathname: "/director", params: { projectId, live: "1" } } as unknown as Href);
        },
        onEntryRegistered: ({ fileIndex, assetId, sessionId }) => {
          assetIdsByFile[fileIndex] = assetId; sessionIdsByFile[fileIndex] = sessionId;
          if (recovery?.entries[fileIndex]) { recovery.entries[fileIndex]!.assetId = assetId; recovery.entries[fileIndex]!.sessionId = sessionId; }
          setPendingMedia(media, assetIdsByFile, ownerProjectId ?? null, sessionIdsByFile);
        },
        onReady: ({ projectId }) => {
          routed = true;
          registered = true;
          setPendingMedia(media, assetIdsByFile, projectId, sessionIdsByFile);
          setPreparationProgress(null); setUploadPreparationProgress(null);
        },
      });
      if (result.failed > 0) setUploadFailure(result.finished === 0
        ? "None of these photos uploaded. Check your connection and try again."
        : `${result.failed} ${result.failed === 1 ? "file" : "files"} couldn't upload. You can keep going with the photos that finished.`);
      if (result.finished === 0 && !routed) {
        setUploadError("Upload failed. Please try again.");
        return;
      }
    } catch (error) {
      console.error("upload failed", error);
      if (!routed) setUploadError("Upload failed. Please try again.");
      else { if (!registered && recovery) { const owner = recovery as UploadRecoveryOwner; owner.entries.filter((entry) => entry.status !== "uploaded").forEach((entry) => { entry.status = "failed"; }); owner.aggregate.failedFiles = owner.entries.filter((entry) => entry.status === "failed").length; } setPreparationProgress(null); setUploadPreparationProgress(null); setUploadFailure("These photos couldn't be prepared or uploaded. Check your connection and try again."); }
    } finally {
      if (recovery) (recovery as UploadRecoveryOwner).initialUploadInFlight = false;
      setUploadPreparationProgress(null);
      setUploading(false);
    }
  }

  function openFilm(item: FilmListItem) {
    if (item.status === "saved" && item.filmId) {
      const query = new URLSearchParams({ repository: story.flow.repository, projectId: item.projectId, filmId: item.filmId });
      router.push(`/save-film?${query.toString()}` as Href);
      return;
    }
    if (item.status === "rendering" && item.filmId && item.planId) {
      const query = new URLSearchParams({ repository: story.flow.repository, projectId: item.projectId, planId: item.planId, generationId: item.filmId });
      router.push(`/editor?${query.toString()}` as Href);
      return;
    }
    const query = new URLSearchParams({ repository: story.flow.repository, projectId: item.projectId });
    router.push(`/director?${query.toString()}` as Href);
  }

  const statusLabel = (status: FilmListItem["status"]) => status === "saved" ? "Ready to watch" : status === "film-ready" ? "Film ready" : status === "rendering" ? "Rendering" : "In progress";

  const hasFilms = films !== null && films.length > 0;
  const mosaicColors = [
    "deep-tide", "tide-tile", "surface-sunken", "tide-tile",
    "surface-sunken", "persimmon", "tide-tile", "deep-tide",
    "tide-tile", "deep-tide", "surface-sunken", "tide-tile",
  ];
  const tileClasses: Record<string, string> = {
    "deep-tide": "bg-deep-tide",
    "tide-tile": "bg-tide-tile",
    "surface-sunken": "bg-surface-sunken",
    persimmon: "bg-persimmon",
  };

  return (
    <View className="flex-1 bg-surface">
      <MediaPicker ref={pickerRef} onFiles={startWithMedia} />
      <ScrollView className="flex-1" contentContainerClassName={`px-6 pt-4 ${hasFilms ? "pb-32" : "pb-8"}`}>
        <View className="flex-row items-center justify-between">
          <Text accessibilityLabel="Mosaé" className="font-title text-[27px] text-ink">mosaé</Text>
          <Pressable role="button" accessibilityLabel="Settings" aria-label="Settings" className="min-h-11 min-w-11 items-center justify-center"><SettingsIcon /></Pressable>
        </View>
        {hasFilms ? (
          <View className="mt-8">
            <View className="mb-4 flex-row items-center justify-between">
              <Text role="heading" aria-level={1} className="font-title text-title text-ink">Your films</Text>
              <Text className="font-sans text-caption text-ink-muted">{films.length} films</Text>
            </View>
            <View data-film-grid="true" className="flex-row flex-wrap justify-between gap-y-3">
              {films.map((film) => <View key={film.projectId + "/" + (film.filmId ?? film.planId ?? "project")} className="w-[48%]">
                <FilmCard title={film.title} meta={film.month} status={statusLabel(film.status)} duration={film.duration} posterSource={film.posterUrl ? { uri: film.posterUrl } : undefined} badge={film.demo ? "Demo" : film.justSaved ? "Just saved" : undefined} onPress={() => openFilm(film)} />
              </View>)}
            </View>
          </View>
        ) : (
          <>
            <View accessibilityLabel="Mosaé tile mosaic" data-testid="home-mosaic" className="mt-[112px] w-[248px] flex-row flex-wrap gap-2">
              {mosaicColors.map((color, index) => <View key={index} data-mosaic-tile={color} className={`h-14 w-14 rounded-md ${tileClasses[color]}`} />)}
            </View>
            <View className="mt-6">
              <Text role="heading" aria-level={1} className="font-title text-title text-ink">Many moments.{"\n"}One story.</Text>
              <Text className="mt-3 font-sans text-body leading-6 text-ink-muted">Bring in the photos and clips from a trip or celebration. You say what mattered. Mosaé shapes it into a film you can change at every step.</Text>
              <View className="mt-5"><Button label="＋  Create a new film" onPress={createFilm} /></View>
              {uploading ? <Text accessibilityRole="progressbar" className="mt-2 text-center font-sans text-caption text-ink-muted">{preparationProgress ? `Preparing ${preparationProgress.preparedFiles} of ${preparationProgress.totalFiles}` : uploadProgress ? `Uploading ${uploadProgress.finishedFiles + uploadProgress.failedFiles} of ${uploadProgress.totalFiles} · ${(uploadProgress.bytesSent / 1_000_000).toFixed(1)} of ${(uploadProgress.totalBytes / 1_000_000).toFixed(1)} MB` : "Uploading…"}</Text> : null}
              {uploadError ? <Text className="mt-2 text-center font-sans text-caption text-critical">{uploadError}</Text> : null}
              <Pressable role="button" disabled={demoBusy} onPress={() => void tryDemo()} className="mt-3 min-h-11 items-center justify-center"><Text className="font-sans-medium text-label text-action">{demoBusy ? "Preparing demo trip…" : "Try with a demo trip"}</Text></Pressable>
              {demoError ? <Text className="font-sans text-caption text-critical">{demoError}</Text> : null}
            </View>
            <View className="mt-[60px] border-t border-line pt-5">
              <Text role="heading" aria-level={2} className="mb-3 font-title text-heading text-ink">Your films</Text>
              {films === null ? <View accessibilityRole="progressbar" aria-label="Loading your films" className="flex-row flex-wrap justify-between gap-y-3">
                {[0, 1].map((item) => <View key={item} className="w-[48%] animate-pulse">
                  <View className="aspect-video rounded-md bg-surface-sunken" />
                  <View className="mt-3 h-4 w-4/5 rounded bg-surface-sunken" />
                  <View className="mt-2 h-3 w-2/5 rounded bg-surface-sunken" />
                  <View className="mt-3 h-6 w-1/2 rounded-pill bg-surface-sunken" />
                </View>)}
              </View> : (
                <View className="flex-row items-center gap-4 rounded-md bg-surface-sunken p-3">
                  <View data-testid="empty-films-icon" accessibilityLabel="Four tiles" className="w-[26px] flex-row flex-wrap gap-0.5">
                    {["tide-tile", "tide-tile", "tide-tile", "deep-tide"].map((color, index) => <View key={index} className={`size-3 rounded-[2px] ${tileClasses[color]}`} />)}
                  </View>
                  <Text className="flex-1 font-sans text-caption leading-[18px] text-ink-muted">No films yet. Your first one will live here, and it stays editable.</Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
      {hasFilms ? <View className="absolute inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-6 pb-8 pt-4"><Button label="＋  Create a new film" onPress={createFilm} /><Pressable role="button" disabled={demoBusy} onPress={() => void tryDemo()} className="min-h-11 items-center justify-center"><Text className="font-sans-medium text-label text-action">{demoBusy ? "Preparing demo trip…" : "Try with a demo trip"}</Text></Pressable></View> : null}
    </View>
  );
}
