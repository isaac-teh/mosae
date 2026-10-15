import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Share, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { Asset } from "expo-asset";
import { COLLAGE_LAYOUTS, applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import { askEditSummary, changedClipIds, createReplacementGuard, duplicateClip, fitEditedCollageSlots, trimRange, uploadReplacement, videoTrimBounds, type ContextToolbarAction, type UploadProgress } from "@mosae/core";
import { useStoryFlow } from "@/lib/storyFlow";
import { useEditor } from "@/lib/useEditor";
import type { StoryPlan, DirectionOptions, Moment } from "@mosae/core";
import { EditorPreview } from "@/components/editor/EditorPreview";
import { TimelineStrip } from "@/components/editor/TimelineStrip";
import { RatioIcon, ToolBar } from "@/components/editor/ToolBar";
import { SaveState } from "@/components/editor/SaveState";
import { AddSheet } from "@/components/editor/AddSheet";
import { CollagePanel } from "@/components/editor/CollagePanel";
import { SoundtrackSheet } from "@/components/editor/SoundtrackSheet";
import { AudioVolumeSheet } from "@/components/editor/AudioVolumeSheet";
import { RatioSheet } from "@/components/editor/RatioSheet";
import { RemoveConfirm } from "@/components/editor/RemoveConfirm";
import { EditorMenu } from "@/components/editor/EditorMenu";
import { AskSheet } from "@/components/editor/AskSheet";
import { aiEditPlaybackStart } from "@/lib/aiEditPlayback";
import { SwapSheet } from "@/components/editor/SwapSheet";
import { CollageCellSheet } from "@/components/editor/CollageCellSheet";
import { RedoIcon, UndoIcon } from "@/components/icons";
import { downloadFilm, prepareFilmDownload, type PreparedFilmDownload } from "@/lib/downloadFilm";
import { getInFilmShotIds } from "@/lib/inFilm";

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
type Tool = "Remove" | "Add" | "Ask" | "CollageLayout" | "CollageMotion" | "CollageCellAdd" | "CollageCellReplace" | "Replace" | "Soundtrack" | "Volume" | "Format" | null;
const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const idOf = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;

function trimEdit(current: Timeline["videoClips"][number], original: Timeline["videoClips"][number], edge: "start" | "end", deltaSec: number, maxDurationSec: number): EditOp {
  const clipId = idOf(current);
  if ("kind" in current) {
    const duration = current.durationSec;
    const range = trimRange({ startSec: 0, endSec: duration, edge, requestedSec: edge === "start" ? deltaSec : duration + deltaSec,
      minSec: edge === "start" ? duration - maxDurationSec : 0, maxSec: edge === "start" ? duration : maxDurationSec });
    return { op: "setCollageDuration", clipId, sec: range.endSec - range.startSec };
  }
  if (current.source.kind === "video" && "source" in original && original.source.kind === "video") {
    const bounds = videoTrimBounds(current.source);
    const range = trimRange({ startSec: current.source.sourceInSec, endSec: current.source.sourceOutSec, edge,
      requestedSec: (edge === "start" ? current.source.sourceInSec : current.source.sourceOutSec) + deltaSec,
      minSec: bounds.minSec, maxSec: bounds.maxSec });
    return { op: "trim", clipId, inSec: range.startSec, outSec: range.endSec };
  }
  const duration = current.durationSec;
  const range = trimRange({ startSec: 0, endSec: duration, edge, requestedSec: edge === "start" ? deltaSec : duration + deltaSec,
    minSec: edge === "start" ? duration - 6 : 0, maxSec: edge === "start" ? duration : 6 });
  return { op: "setPhotoDuration", clipId, sec: range.endSec - range.startSec };
}

export default function EditorScreen() {
  const params = useLocalSearchParams<{ projectId?: string; generationId?: string; planId?: string; request?: string }>();
  const story = useStoryFlow();
  const { repository } = story;
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const editor = useEditor(params.projectId || "fixture", params.generationId || "demo-film", repository);
  const selectEditorClip = editor.select;
  const [playhead, setPlayhead] = useState(0);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number } | null>(null);
  const [pauseRequest, setPauseRequest] = useState(0);
  const [togglePlayRequest, setTogglePlayRequest] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [askHighlightIds, setAskHighlightIds] = useState<string[]>([]);
  const [askToast, setAskToast] = useState<string | null>(null);
  const [askToastNonce, setAskToastNonce] = useState(0);
  const [askToastSnapshotKey, setAskToastSnapshotKey] = useState<string | null>(null);
  const [askClipFocus, setAskClipFocus] = useState<{ clipId: string; nonce: number } | null>(null);
  const askChangedIdsRef = useRef<string[]>([]);
  const askAfterRef = useRef<Timeline | null>(null);
  const [selectedCollageCellId, setSelectedCollageCellId] = useState<string | null>(null);
  const [selectedAudioClipId, setSelectedAudioClipId] = useState<string | null>(null);
  const [preparingDownload, setPreparingDownload] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [replacementUploadProgress, setReplacementUploadProgress] = useState<UploadProgress | null>(null);
  const [replacementUploadError, setReplacementUploadError] = useState<string | null>(null);
  const [replacementUploading, setReplacementUploading] = useState(false);
  const replacementUploadNonce = useRef(createReplacementGuard());
  const [preparedDownload, setPreparedDownload] = useState<PreparedFilmDownload | null>(null);
  const [prefetchingDownload, setPrefetchingDownload] = useState(false);
  const [tool, setTool] = useState<Tool>(params.request ? "Ask" : null);
  const [askSeed, setAskSeed] = useState(typeof params.request === "string" ? params.request : "");
  useEffect(() => { if (tool !== "Ask") setAskSeed(""); }, [tool]);
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [directions, setDirections] = useState<DirectionOptions | null>(null);
  const [personTagsByShot, setPersonTagsByShot] = useState<Record<string, string[]>>({});
  const onTimeChange = useCallback((seconds: number) => setPlayhead(seconds), []);
  const seekTo = useCallback((seconds: number) => {
    const target = Math.max(0, Math.min(editor.timeline?.durationSec ?? 0, seconds));
    setPlayhead(target);
    setSeekRequest({ seconds: target });
  }, [editor.timeline?.durationSec]);
  const previewAspect = editor.timeline?.aspect === "16:9" ? 16 / 9 : 9 / 16;
  const previewHeight = Math.min(Math.max(280, Math.min(720, height - 440)), (width - 40) / previewAspect);
  const previewWidth = previewHeight * previewAspect;
  useEffect(() => {
    if (!editor.savedFilm) return;
    router.navigate({
      pathname: "/save-film",
      params: { filmId: params.generationId || "demo-film", directorChat: "true", ...story.flow },
    } as never);
  }, [editor.savedFilm, params.generationId, router, story.flow]);
  const soundtrack = editor.timeline?.audioClips.find((clip) => clip.role === "music" && clip.source.kind === "soundtrack");
  const soundtrackId = soundtrack?.source.kind === "soundtrack" ? soundtrack.source.soundtrackId : null;
  const soundtrackName = soundtrackId
    ? directions?.soundtracks.find((track) => track.id === soundtrackId)?.name ?? "Soundtrack"
    : null;
  useEffect(() => {
    let active = true;
    if (!params.planId) return () => { active = false; };
    void repository.getPlan(params.planId)
      .then((nextPlan) => { if (active) setPlan(nextPlan); })
      .catch(() => { if (active) setPlan(null); });
    void repository.getDirectionOptions(params.planId)
      .then((nextDirections) => { if (active) setDirections(nextDirections); })
      .catch(() => { if (active) setDirections(null); });
    return () => { active = false; };
  }, [params.planId, repository]);
  useEffect(() => {
    let active = true;
    setPersonTagsByShot({});
    if (!params.projectId || typeof repository.getPeople !== "function") return () => { active = false; };
    void repository.getPeople(params.projectId).then(people => {
      if (!active) return;
      const tags: Record<string, string[]> = {};
      for (const person of people ?? []) {
        const label = person.name?.trim() || person.role?.trim() || "Person";
        for (const shotId of new Set([...(person.shotIds ?? []), ...person.sampleShotIds])) {
          tags[shotId] = [...(tags[shotId] ?? []), label];
        }
      }
      setPersonTagsByShot(tags);
    }).catch(() => { if (active) setPersonTagsByShot({}); });
    return () => { active = false; };
  }, [params.projectId, repository]);
  const selectedClip = editor.timeline?.videoClips.find((clip) => clipId(clip) === editor.selectedClipId) ?? null;
  const collageMoments = useMemo(() => {
    const listed = [...(plan?.moments ?? []), ...editor.unusedMedia.map((media) => ({
      id: `unused-${media.shotId}`, title: `${media.kind === "video" ? "Video clip" : "Photo"} · ${media.eventLabel}`, meta: media.date,
      tag: { emoji: media.kind === "video" ? "🎬" : "📷", label: media.kind === "video" ? "Video" : "Photo" },
      imageKey: media.thumbnailUrl, kind: media.kind, selected: false, favorite: false, shotId: media.shotId,
      ...(media.sourceInSec !== undefined ? { sourceInSec: media.sourceInSec } : {}),
      ...(media.sourceOutSec !== undefined ? { sourceOutSec: media.sourceOutSec } : {}),
      ...(media.sourceDurationSec !== undefined ? { sourceDurationSec: media.sourceDurationSec } : {}),
      ...(media.width !== undefined ? { width: media.width } : {}),
      ...(media.height !== undefined ? { height: media.height } : {}),
    } as Moment))];
    return [...new Map(listed.filter((moment) => moment.shotId).map((moment) => [moment.shotId!, moment])).values()];
  }, [plan, editor.unusedMedia]);
  const inFilmShotIds = useMemo(() => getInFilmShotIds(editor.timeline), [editor.timeline]);
  const applyPreparedOps = (op: EditOp | EditOp[]) => {
    const batch = Array.isArray(op) ? op : [op];
    const fitted = editor.timeline ? fitEditedCollageSlots(editor.timeline, batch) : batch;
    return fitted.length === 1 && !Array.isArray(op) ? editor.apply(fitted[0]!) : editor.applyMany(fitted);
  };
  const applyAiOps = (ops: EditOp[]) => {
    const before = editor.timeline;
    const result = before ? applyEdits(before, ops) : null;
    const applied = applyPreparedOps(ops);
    if (applied && before && result?.ok) { askChangedIdsRef.current = changedClipIds(before, result.timeline); askAfterRef.current = result.timeline; }
    return applied;
  };
  const onAskApplied = (ops: EditOp[], _reply: string, requestText: string) => {
    const ids = askChangedIdsRef.current;
    askChangedIdsRef.current = [];
    setAskHighlightIds(ids);
    const finalTimeline = askAfterRef.current ?? editor.timeline ?? undefined;
    askAfterRef.current = null;
    setAskToast(askEditSummary(ops, finalTimeline?.durationSec, soundtrackName ?? undefined, requestText, finalTimeline));
    setAskToastSnapshotKey(editor.getSnapshotKey());
    setAskToastNonce((n) => n + 1);
    if (ids.length) {
      const start = Math.min(...(editor.timeline?.videoClips.filter((clip) => ids.includes(idOf(clip))).map((clip) => clip.startSec) ?? []));
      if (Number.isFinite(start)) {
        const firstChanged = editor.timeline?.videoClips.filter((clip) => ids.includes(idOf(clip))).sort((a, b) => a.startSec - b.startSec)[0];
        if (firstChanged) setAskClipFocus({ clipId: idOf(firstChanged), nonce: askToastNonce + 1 });
        setPauseRequest((request) => request + 1); seekTo(start); setTogglePlayRequest((request) => request + 1);
      }
      else playAiAt(ops);
    } else {
      // Film-wide edits (format, music, volume) should keep the viewer's current position.
      setPauseRequest((request) => request + 1);
      setTogglePlayRequest((request) => request + 1);
    }
  };
  useEffect(() => {
    if (!askHighlightIds.length) return;
    const timer = setTimeout(() => setAskHighlightIds([]), 4000);
    return () => clearTimeout(timer);
  }, [askHighlightIds]);
  useEffect(() => {
    if (!askToast) return;
    const timer = setTimeout(() => setAskToast(null), 5000);
    return () => clearTimeout(timer);
  }, [askToast, askToastNonce]);
  const onApply = (op: EditOp | EditOp[]) => {
    const applied = applyPreparedOps(op);
    if (applied) { replacementUploadNonce.current.invalidate(); setTool(null); }
    return applied;
  };
  const onApplyCollage = (op: EditOp | EditOp[]) => {
    const applied = applyPreparedOps(op);
    if (applied && selectedClip && "kind" in selectedClip) {
      setPauseRequest((request) => request + 1);
      seekTo(selectedClip.startSec + Math.min(1.5, selectedClip.durationSec / 2));
    }
    return applied;
  };
  const playAiAt = (ops: EditOp[]) => {
    setPauseRequest((request) => request + 1);
    seekTo(editor.timeline && editor.firstCut ? aiEditPlaybackStart(ops, editor.timeline, editor.firstCut) : 0);
    setTogglePlayRequest((request) => request + 1);
  };
  const downloadSource = editor.downloadUrl === "film" ? Asset.fromModule(require("../assets/demo/film.mp4")).uri : editor.downloadUrl;
  useEffect(() => {
    let active = true;
    setPreparedDownload(null);
    if (downloadSource) {
      setPrefetchingDownload(true);
      void prepareFilmDownload(downloadSource, plan?.title ?? "Your film")
        .then((value) => { if (active) setPreparedDownload(value); })
        .catch(() => { /* Retried when the user taps Download. */ })
        .finally(() => { if (active) setPrefetchingDownload(false); });
    }
    return () => { active = false; };
  }, [downloadSource, plan?.title]);
  const chooseClip = useCallback((id: string) => {
    replacementUploadNonce.current.invalidate();
    selectEditorClip(id);
    setSelectedAudioClipId(null);
    setSelectedCollageCellId(null);
    setTool(null);
    const clip = editor.timeline?.videoClips.find((candidate) => clipId(candidate) === id);
    if (clip && "kind" in clip) {
      setPauseRequest((request) => request + 1);
      seekTo(clip.startSec + Math.min(0.65, clip.durationSec * 0.2));
    }
  }, [editor.timeline, selectEditorClip, seekTo]);
  const onTimelineSelect = useCallback((id: string, startSec: number) => {
    chooseClip(id);
    seekTo(startSec);
  }, [chooseClip, seekTo]);
  const openSoundtrackPicker = useCallback(() => { replacementUploadNonce.current.invalidate(); setPauseRequest((request) => request + 1); setTool("Soundtrack"); }, []);
  const onSelectAudio = useCallback((id: string) => {
    replacementUploadNonce.current.invalidate();
    editor.select(null);
    setSelectedCollageCellId(null);
    setSelectedAudioClipId(id);
    setTool(null);
  }, [editor.select]);
  const onAddTimelineClip = useCallback(() => {
    replacementUploadNonce.current.invalidate();
    setSelectedAudioClipId(null);
    setSelectedCollageCellId(null);
    setTool("Add");
  }, [editor.select]);
  const selectedShotId = selectedClip && "source" in selectedClip ? selectedClip.source.shotId : null;
  const selectedMoment = selectedShotId ? plan?.moments.find((moment) => moment.shotId === selectedShotId) : null;
  useEffect(() => {
    replacementUploadNonce.current.invalidate();
    setReplacementUploading(false);
    setReplacementUploadProgress(null);
  }, [editor.selectedClipId, selectedCollageCellId, tool]);
  const uploadDeviceReplacement = async (file: File, targetClipId: string, targetSlotId?: string) => {
    const target = editor.timeline?.videoClips.find((candidate) => clipId(candidate) === targetClipId);
    if (!target) return;
    if (targetSlotId && (!("kind" in target) || !target.spec.slots.some((slot) => slot.slotId === targetSlotId))) return;
    if (!targetSlotId && (!("source" in target) || target.source.kind !== "photo")) return;
    const nonce = replacementUploadNonce.current.begin();
    setReplacementUploadError(null);
    setReplacementUploadProgress(null);
    setReplacementUploading(true);
    try {
      const media = await uploadReplacement(file, {
        projectId: params.projectId || "fixture",
        generationId: params.generationId || "demo-film",
        repository,
        onProgress: setReplacementUploadProgress,
      });
      if (!replacementUploadNonce.current.isCurrent(nonce)) return;
      if (media.kind !== "photo") throw new Error("replacement_kind_mismatch");
      editor.setSource(media.shotId, media.previewUrl);
      const op: EditOp = targetSlotId
        ? { op: "replaceCollageSlot", clipId: targetClipId, slotId: targetSlotId, shotId: media.shotId, kind: "photo", ...(media.width !== undefined ? { width: media.width } : {}), ...(media.height !== undefined ? { height: media.height } : {}) }
        : { op: "swapShot", clipId: targetClipId, shotId: media.shotId };
      if (!onApply(op)) setReplacementUploadError("The uploaded photo could not be applied.");
    } catch (error) {
      if (!replacementUploadNonce.current.isCurrent(nonce)) return;
      setReplacementUploadError(error instanceof Error && error.message === "replacement_media_not_ready"
        ? "The photo uploaded but is still processing. Try again shortly."
        : "Could not upload this photo. Check your connection and try again.");
    } finally {
      if (replacementUploadNonce.current.isCurrent(nonce)) setReplacementUploading(false);
    }
  };
  const uploadDeviceAdditions = async (files: File[]): Promise<Moment[]> => {
    const nonce = replacementUploadNonce.current.begin();
    setReplacementUploadError(null);
    setReplacementUploadProgress({ totalFiles: files.length, finishedFiles: 0, failedFiles: 0, bytesSent: 0, totalBytes: files.reduce((sum, file) => sum + file.size, 0) });
    setReplacementUploading(true);
    try {
      const added: Moment[] = [];
      for (const [index, file] of files.entries()) {
        const media = await uploadReplacement(file, {
          projectId: params.projectId || "fixture",
          generationId: params.generationId || "demo-film",
          repository,
          onProgress: (progress) => setReplacementUploadProgress({ ...progress, finishedFiles: index + progress.finishedFiles, failedFiles: index + progress.failedFiles, totalFiles: files.length }),
        });
        if (!replacementUploadNonce.current.isCurrent(nonce)) throw new Error("Upload cancelled");
        editor.setSource(media.shotId, media.previewUrl);
        added.push({
          id: `device-${media.shotId}`, title: `${media.kind === "video" ? "Video clip" : "Photo"} · ${media.eventLabel}`, meta: media.date,
          tag: { emoji: media.kind === "video" ? "🎬" : "📷", label: media.kind === "video" ? "Video" : "Photo" },
          imageKey: media.thumbnailUrl, kind: media.kind, selected: false, favorite: false, shotId: media.shotId,
          ...(media.sourceInSec !== undefined ? { sourceInSec: media.sourceInSec } : {}),
          ...(media.sourceOutSec !== undefined ? { sourceOutSec: media.sourceOutSec } : {}),
          ...(media.sourceDurationSec !== undefined ? { sourceDurationSec: media.sourceDurationSec } : {}),
        });
        setReplacementUploadProgress((progress) => progress ? { ...progress, finishedFiles: index + 1, totalFiles: files.length } : progress);
      }
      return added;
    } catch (error) {
      if (replacementUploadNonce.current.isCurrent(nonce)) setReplacementUploadError(error instanceof Error && error.message === "replacement_media_not_ready"
        ? "The upload is still processing. Try again shortly."
        : "Could not upload your media. Check your connection and try again.");
      throw error;
    } finally {
      if (replacementUploadNonce.current.isCurrent(nonce)) setReplacementUploading(false);
    }
  };
  const closePicker = () => { replacementUploadNonce.current.invalidate(); setReplacementUploading(false); setReplacementUploadProgress(null); setTool(null); };
  const toolbarSelection = selectedAudioClipId ? "audio" : selectedCollageCellId ? "collageCell" : !selectedClip ? "none" : "kind" in selectedClip ? "collage" : "slot";
  const selectedCellSlotId = selectedClip && "kind" in selectedClip && selectedCollageCellId ? selectedCollageCellId.slice(selectedClip.clipId.length + 1) : null;
  const selectedLayout = selectedClip && "kind" in selectedClip ? COLLAGE_LAYOUTS.find((layout) => layout.id === selectedClip.spec.layoutId)! : null;
  const disabledToolbarActions = selectedClip && "kind" in selectedClip && selectedLayout
    ? { ...(toolbarSelection === "collage" && !selectedClip.spec.slots.some((slot) => slot.empty) && selectedClip.spec.slots.length >= selectedLayout.maxSlots ? { AddCell: `This layout holds up to ${selectedLayout.maxSlots} photos` } : {}) }
    : {};
  const onSelectCollageCell = useCallback((collageClipId: string, slotId: string) => {
    editor.select(collageClipId);
    setSelectedAudioClipId(null);
    replacementUploadNonce.current.invalidate();
    setSelectedCollageCellId(`${collageClipId}:${slotId}`);
    setPauseRequest((request) => request + 1);
  }, [editor.select]);
  const onCommitCollageCrop = useCallback((collageClipId: string, slotId: string, crop: { x: number; y: number; scale: number; rotationDeg?: number }) => {
    editor.apply({ op: "setCollageCrop", clipId: collageClipId, slotId, crop });
  }, [editor.apply]);
  const onCommitPhotoCrop = useCallback((photoClipId: string, crop: { x: number; y: number; scale: number; rotationDeg?: number }) => {
    editor.apply({ op: "setPhotoCrop", clipId: photoClipId, crop });
  }, [editor.apply]);
  const openTool = (action: ContextToolbarAction) => {
    if (action === "Deselect" || action === "Back") { if (action === "Deselect") editor.select(null); setSelectedAudioClipId(null); setSelectedCollageCellId(null); setTool(null); return; }
    if (action === "Delete" || action === "Remove") {
      if (toolbarSelection === "collageCell" && selectedClip && "kind" in selectedClip && selectedCollageCellId) {
        const slotId = selectedCollageCellId.slice(selectedClip.clipId.length + 1);
        const slots = selectedClip.spec.slots.map((slot) => slot.slotId === slotId ? { slotId, empty: true as const } : slot);
        editor.apply({ op: "setCollageSpec", clipId: selectedClip.clipId, spec: { ...selectedClip.spec, slots } });
        return;
      }
      if (toolbarSelection === "audio") return;
      if (editor.timeline && editor.timeline.videoClips.length > 1) setTool("Remove"); return;
    }
    if (action === "Duplicate") { if (selectedClip) editor.apply(duplicateClip(clipId(selectedClip))); setTool(null); return; }
    if (action === "Replace") { if (toolbarSelection === "audio") openSoundtrackPicker(); else if (toolbarSelection === "collage" && selectedClip && "kind" in selectedClip) { const slot = selectedClip.spec.slots.find((candidate) => !candidate.empty); if (slot) { setSelectedCollageCellId(`${selectedClip.clipId}:${slot.slotId}`); setTool("CollageCellReplace"); } } else if (toolbarSelection === "collageCell" && selectedClip && "kind" in selectedClip && selectedCellSlotId && selectedClip.spec.slots.find((slot) => slot.slotId === selectedCellSlotId)?.empty) setTool("CollageCellReplace"); else setTool("Replace"); return; }
    if (action === "Volume") { setTool("Volume"); return; }
    if (action === "Layout") { setTool("CollageLayout"); return; }
    if (action === "Motion") { setTool("CollageMotion"); return; }
    if (action === "AddCell") { if (toolbarSelection === "collage" && selectedClip && "kind" in selectedClip) { const slot = selectedClip.spec.slots.find((candidate) => candidate.empty); if (slot) { setSelectedCollageCellId(`${selectedClip.clipId}:${slot.slotId}`); setTool("CollageCellAdd"); } } else setTool("CollageCellAdd"); return; }
    if (action === "ReplaceCell") { setTool("CollageCellReplace"); return; }
    if (action === "Music") { setTool("Soundtrack"); return; }
    setTool(action);
  };
  const downloadRenderedFilm = async () => {
    if (!editor.downloadUrl || preparingDownload) return;
    setDownloadError(null);
    try { await downloadFilm(downloadSource!, plan?.title ?? "Your film", setPreparingDownload, preparedDownload); }
    catch { setDownloadError("Could not prepare the film download. Try again."); }
  };

  return <View className="flex-1 bg-screen">
    <View className="h-[60px] flex-row items-center justify-between px-5">
      <Pressable role="button" accessibilityLabel="Back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} className="min-h-11 min-w-11 justify-center"><Text className="font-sans text-[26px] text-on-screen">×</Text></Pressable>
      <Text className="font-sans-semibold text-[18px] text-on-screen">Edit film</Text>
      <View className="flex-row items-center gap-2"><EditorMenu onReset={(ops) => editor.reset(ops)} /><Pressable role="button" accessibilityLabel="Save" onPress={() => void editor.render()} className="min-h-11 min-w-11 items-end justify-center"><Text className="font-sans-medium text-[16px] text-on-screen">Save</Text></Pressable></View>
    </View>
    <View className="min-h-[29px] justify-center px-5"><SaveState save={editor.save} renderProgress={editor.renderProgress} renderEtaMinutes={editor.renderEtaMinutes} onReload={() => void editor.reloadAfterConflict()} /></View>
    {editor.editError ? <Text accessibilityRole="alert" className="px-5 pb-2 font-sans text-caption text-on-screen">{editor.editError}</Text> : null}
    {editor.save.state === "ready" && editor.downloadUrl ? <View className="px-5 pb-2"><View className="flex-row gap-2"><Pressable role="button" accessibilityLabel="Download rendered film" disabled={preparingDownload || prefetchingDownload} onPress={() => void downloadRenderedFilm()} className="min-h-10 justify-center rounded-full bg-[#294655] px-4"><Text className="font-sans-medium text-caption text-on-screen">{preparingDownload || prefetchingDownload ? "Preparing download…" : "Download"}</Text></Pressable><Pressable role="button" accessibilityLabel="Share rendered film" onPress={() => void Share.share({ message: editor.downloadUrl! })} className="min-h-10 justify-center rounded-full border border-on-screen-muted px-4"><Text className="font-sans-medium text-caption text-on-screen">Share</Text></Pressable></View>{preparingDownload ? <Text accessibilityRole="progressbar" className="pt-1 font-sans text-caption text-on-screen-muted">Preparing your MP4…</Text> : null}{downloadError ? <Text accessibilityRole="alert" className="pt-1 font-sans text-caption text-critical">{downloadError}</Text> : null}</View> : null}
    {editor.error ? <View className="flex-1 items-center justify-center px-6"><Text className="text-center font-sans text-body text-on-screen">{editor.error}</Text></View>
      : !editor.timeline ? <View className="flex-1 items-center justify-center"><Text className="font-sans text-body text-on-screen-muted">Opening your film…</Text></View>
      : <ScrollView className="flex-1" contentContainerClassName="px-5 pb-4" showsVerticalScrollIndicator={false}>
        <View className="self-center overflow-hidden rounded-[14px] bg-tide-tile" style={{ width: previewWidth, height: previewHeight }}>
          <EditorPreview timeline={editor.timeline} sources={editor.sources} onTimeChange={onTimeChange} seekRequest={seekRequest} playheadSec={playhead} pauseRequest={pauseRequest} togglePlayRequest={togglePlayRequest} onPlayingChange={setPlaying} selectedClipId={editor.selectedClipId} onSelectClip={chooseClip} onCommitPhotoCrop={onCommitPhotoCrop} selectedCollageCellId={selectedCollageCellId} onSelectCollageCell={onSelectCollageCell} onCommitCollageCrop={onCommitCollageCrop} />
        </View>
        <View className="mt-4 flex-row items-center justify-between">
          <View className="flex-row items-center gap-3"><Pressable role="button" accessibilityLabel={playing ? "Pause film" : "Play film"} onPress={() => setTogglePlayRequest((request) => request + 1)} className="min-h-11 min-w-11 items-center justify-center rounded-full bg-black/35"><Text className="font-sans text-[18px] text-on-screen">{playing ? "Ⅱ" : "▶"}</Text></Pressable><Text className="font-sans text-caption text-on-screen">{time(playhead)} / {time(editor.timeline.durationSec)}</Text></View>
          <View className="flex-row items-start gap-0">
            <Pressable role="button" accessibilityLabel="Ask AI" onPress={() => openTool("Ask")} className="h-[40px] w-[40px] items-center justify-start"><View className="h-5 w-5 items-center justify-center"><Svg width={18} height={18} viewBox="0 0 24 24" accessibilityElementsHidden><Path d="m12 2 1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8L12 2Zm7 13 .8 3.2L23 19l-3.2.8L19 23l-.8-3.2L15 19l3.2-.8L19 15Z" fill="white" /></Svg></View><Text className="mt-0.5 font-sans text-[9px] leading-[11px] text-on-screen-muted">Ask AI</Text></Pressable>
            <Pressable role="button" accessibilityLabel="Ratio" onPress={() => openTool("Format")} className="h-[40px] w-[40px] items-center justify-start"><View className="h-5 w-5 items-center justify-center"><RatioIcon size={18} /></View><Text className="mt-0.5 font-sans text-[9px] leading-[11px] text-on-screen-muted">Ratio</Text></Pressable>
            <Pressable role="button" accessibilityLabel="Undo" disabled={!editor.canUndo} onPress={editor.undo} className="h-[40px] w-[40px] items-center justify-start"><View className="h-5 w-5 items-center justify-center"><UndoIcon size={18} disabled={!editor.canUndo} /></View><Text className={`mt-0.5 font-sans text-[9px] leading-[11px] text-on-screen-muted ${editor.canUndo ? "" : "opacity-50"}`}>Undo</Text></Pressable>
            <Pressable role="button" accessibilityLabel="Redo" disabled={!editor.canRedo} onPress={editor.redo} className="h-[40px] w-[40px] items-center justify-start"><View className="h-5 w-5 items-center justify-center"><RedoIcon size={18} disabled={!editor.canRedo} /></View><Text className={`mt-0.5 font-sans text-[9px] leading-[11px] text-on-screen-muted ${editor.canRedo ? "" : "opacity-50"}`}>Redo</Text></Pressable>
          </View>
        </View>
        <TimelineStrip timeline={editor.timeline} sources={editor.sources} thumbnails={editor.thumbnails} selectedClipId={editor.selectedClipId} selectedAudioClipId={selectedAudioClipId} highlightedClipIds={askHighlightIds} focusClipRequest={askClipFocus} playheadSec={playhead} isPlaying={playing} soundtrackName={soundtrackName ? `${soundtrackName} · paced to the film` : null}
          onSelect={onTimelineSelect} onScrub={seekTo} onScrubStart={() => setPauseRequest((request) => request + 1)}
          onSelectAudio={onSelectAudio} onAddClip={onAddTimelineClip}
          onTrim={(id, edge, delta) => {
            const clip = editor.timeline?.videoClips.find((candidate) => idOf(candidate) === id);
            const original = editor.firstCut?.videoClips.find((candidate) => idOf(candidate) === id);
            if (clip && original && editor.firstCut) editor.apply(trimEdit(clip, original, edge, delta, editor.firstCut.durationSec));
          }} onReorder={(id, toIndex) => editor.apply({ op: "move", clipId: id, toIndex })} onDeselect={() => { editor.select(null); setSelectedAudioClipId(null); setSelectedCollageCellId(null); }} onSoundtrack={openSoundtrackPicker} />
      </ScrollView>}
    <ToolBar selection={toolbarSelection} onTool={openTool} disabledActions={disabledToolbarActions} statusMessage={askToast} statusUndoDisabled={editor.getSnapshotKey() !== askToastSnapshotKey} onStatusUndo={() => { if (editor.getSnapshotKey() !== askToastSnapshotKey) return; editor.undo(); setAskToast(null); setAskHighlightIds([]); }} emptyCollageCell={Boolean(selectedClip && "kind" in selectedClip && selectedCellSlotId && selectedClip.spec.slots.find((slot) => slot.slotId === selectedCellSlotId)?.empty)} hasEmptyCollageSlot={Boolean(selectedClip && "kind" in selectedClip && selectedClip.spec.slots.some((slot) => slot.empty))} />
    {tool === "Remove" && editor.selectedClipId ? <RemoveConfirm clipId={editor.selectedClipId} onApply={onApply} onUndo={() => { editor.undo(); setTool(null); }} /> : null}
    {tool === "Add" ? <AddSheet visible moments={collageMoments} inFilmShotIds={inFilmShotIds} selectedClipId={editor.selectedClipId} playheadSec={playhead} timeline={editor.timeline ?? undefined} uploading={replacementUploading} uploadProgress={replacementUploadProgress} uploadError={replacementUploadError} onUploadFiles={story.flow.repository === "api" && Boolean(params.projectId) ? uploadDeviceAdditions : undefined} onApply={onApply} onClose={() => setTool(null)} /> : null}
    {(tool === "CollageLayout" || tool === "CollageMotion") && selectedClip && "kind" in selectedClip ? <CollagePanel clip={selectedClip} aspect={editor.timeline?.aspect} timeline={editor.timeline ?? undefined} moments={collageMoments} section={tool === "CollageLayout" ? "Layout" : "Motion"} onApply={onApplyCollage} onClose={closePicker} /> : null}
    {(tool === "CollageCellAdd" || (tool === "CollageCellReplace" && selectedCellSlotId)) && selectedClip && "kind" in selectedClip ? <CollageCellSheet mode={tool === "CollageCellAdd" ? "add" : "replace"} clip={selectedClip} slotId={selectedCellSlotId ?? undefined} moments={collageMoments} inFilmShotIds={inFilmShotIds} sources={editor.sources} uploading={replacementUploading} uploadProgress={replacementUploadProgress} uploadError={replacementUploadError} onUploadFile={story.flow.repository === "api" && Boolean(params.projectId) ? uploadDeviceReplacement : undefined} onSource={editor.setSource} onApply={onApply} onClose={closePicker} /> : null}
    {tool === "Replace" && selectedClip && !("kind" in selectedClip) ? <SwapSheet visible clipId={clipId(selectedClip)} kind={selectedClip.source.kind} clipDurationSec={selectedClip.durationSec} moments={collageMoments} sources={editor.sources} personTagsByShot={personTagsByShot} planId={plan?.planId ?? null} momentId={selectedMoment?.id ?? null} repository={repository} uploading={replacementUploading} uploadProgress={replacementUploadProgress} uploadError={replacementUploadError} onUploadFile={story.flow.repository === "api" && Boolean(params.projectId) && selectedClip.source.kind === "photo" ? (file) => uploadDeviceReplacement(file, clipId(selectedClip)) : undefined} onApply={onApply} onSource={editor.setSource} onThumbnail={editor.setThumbnail} onDimensions={editor.setDimensions} onClose={closePicker} /> : null}
    {tool === "Format" && editor.timeline ? <RatioSheet visible aspect={editor.timeline.aspect} onApply={onApply} onClose={() => setTool(null)} /> : null}{tool === "Ask" && editor.timeline ? <AskSheet visible projectId={params.projectId || "fixture"} generationId={params.generationId || "demo-film"} repository={repository} scope={selectedClip && selectedCellSlotId ? { kind: "slot", clipId: clipId(selectedClip), slotId: selectedCellSlotId } : selectedClip ? { kind: "clip", clipId: clipId(selectedClip) } : { kind: "film" }} people={[...new Set(Object.values(personTagsByShot).flat())]} aspect={editor.timeline.aspect} initialRequest={askSeed} savePending={editor.savePendingNow} getSnapshotKey={editor.getSnapshotKey} getSavedRevision={editor.getSavedRevision} applyMany={applyAiOps} undo={editor.undo} onPlayAt={playAiAt} onApplied={onAskApplied} onReplace={() => { if (selectedClip && "kind" in selectedClip && !selectedCellSlotId) { const slot = selectedClip.spec.slots.find((candidate) => !candidate.empty); if (slot) setSelectedCollageCellId(`${selectedClip.clipId}:${slot.slotId}`); } setTool(selectedClip && "kind" in selectedClip ? "CollageCellReplace" : "Replace"); }} onClose={() => setTool(null)} /> : null}
    {tool === "Soundtrack" ? <SoundtrackSheet visible soundtracks={directions?.soundtracks ?? []} currentSoundtrackId={soundtrackId} previewSourceForTrack={(track) => editor.sources[track.id] ?? null} onApply={onApply} onClose={() => setTool(null)} /> : null}
    {tool === "Volume" && soundtrack && selectedAudioClipId ? <AudioVolumeSheet visible audioClipId={selectedAudioClipId} gainDb={soundtrack.gainDb} onApply={onApply} onClose={() => setTool(null)} /> : null}
  </View>;
}
