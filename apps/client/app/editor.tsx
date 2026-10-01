import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Share, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Asset } from "expo-asset";
import type { EditOp, Timeline } from "@mosae/contracts";
import { trimRange } from "@mosae/core";
import { useStoryFlow } from "@/lib/storyFlow";
import { useEditor } from "@/lib/useEditor";
import type { StoryPlan, DirectionOptions, Moment } from "@mosae/core";
import { EditorPreview } from "@/components/editor/EditorPreview";
import { TimelineStrip } from "@/components/editor/TimelineStrip";
import { ToolBar } from "@/components/editor/ToolBar";
import { SaveState } from "@/components/editor/SaveState";
import { AddSheet } from "@/components/editor/AddSheet";
import { CollagePanel } from "@/components/editor/CollagePanel";
import { SoundtrackSheet } from "@/components/editor/SoundtrackSheet";
import { RemoveConfirm } from "@/components/editor/RemoveConfirm";
import { EditorMenu } from "@/components/editor/EditorMenu";
import { AskSheet } from "@/components/editor/AskSheet";
import { RedoIcon, UndoIcon } from "@/components/icons";
import { downloadFilm, prepareFilmDownload, type PreparedFilmDownload } from "@/lib/downloadFilm";

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
type Tool = "Remove" | "Add" | "Ask" | "Collage" | "Soundtrack" | null;
const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const shotIdsIn = (timeline: Timeline) => new Set(timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : []) : [clip.source.shotId]));
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
    const range = trimRange({ startSec: current.source.sourceInSec, endSec: current.source.sourceOutSec, edge,
      requestedSec: (edge === "start" ? current.source.sourceInSec : current.source.sourceOutSec) + deltaSec,
      minSec: original.source.sourceInSec, maxSec: original.source.sourceOutSec });
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
  const { height } = useWindowDimensions();
  const editor = useEditor(params.projectId || "fixture", params.generationId || "demo-film", repository);
  const timelineForSelection = editor.timeline;
  const selectEditorClip = editor.select;
  const [playhead, setPlayhead] = useState(0);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number } | null>(null);
  const [pauseRequest, setPauseRequest] = useState(0);
  const [togglePlayRequest, setTogglePlayRequest] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [preparingDownload, setPreparingDownload] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [preparedDownload, setPreparedDownload] = useState<PreparedFilmDownload | null>(null);
  const [prefetchingDownload, setPrefetchingDownload] = useState(false);
  const [tool, setTool] = useState<Tool>(params.request ? "Ask" : null);
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [directions, setDirections] = useState<DirectionOptions | null>(null);
  const [slotAlternatives, setSlotAlternatives] = useState<{ clipId: string; values: Record<string, { shotId: string; thumbnailUrl: string; kind?: "photo" | "video" }[]> } | null>(null);
  const onTimeChange = useCallback((seconds: number) => setPlayhead(seconds), []);
  const seekTo = useCallback((seconds: number) => {
    const target = Math.max(0, Math.min(editor.timeline?.durationSec ?? 0, seconds));
    setPlayhead(target);
    setSeekRequest({ seconds: target });
  }, [editor.timeline?.durationSec]);
  const previewHeight = Math.max(280, Math.min(720, height - 440));
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
  const selectedClip = editor.timeline?.videoClips.find((clip) => clipId(clip) === editor.selectedClipId) ?? null;
  useEffect(() => {
    let active = true;
    if (tool !== "Collage" || !selectedClip || !("kind" in selectedClip) || !plan) return () => { active = false; };
    void Promise.all(selectedClip.spec.slots.map(async (slot) => {
      const moment = plan.moments.find((candidate) => candidate.shotId === slot.shotId);
      if (!moment) return [slot.slotId, []] as const;
      const shots = await repository.getAlternatives(plan.planId, moment.id);
      return [slot.slotId, shots] as const;
    })).then((entries) => { if (active) setSlotAlternatives({ clipId: selectedClip.clipId, values: Object.fromEntries(entries) }); })
      .catch(() => { if (active) setSlotAlternatives({ clipId: selectedClip.clipId, values: {} }); });
    return () => { active = false; };
  }, [tool, selectedClip, plan, repository]);
  const addMoments = useMemo(() => {
    if (!editor.timeline) return [];
    const used = shotIdsIn(editor.timeline);
    const projectMedia: Moment[] = editor.unusedMedia.filter((media) => !used.has(media.shotId)).map((media) => ({
      id: `unused-${media.shotId}`, title: `${media.kind === "video" ? "Video clip" : "Photo"} · ${media.eventLabel}`, meta: media.date,
      tag: { emoji: media.kind === "video" ? "🎬" : "📷", label: media.kind === "video" ? "Video" : "Photo" },
      imageKey: media.thumbnailUrl, kind: media.kind, selected: false, favorite: false, shotId: media.shotId,
      ...(media.sourceInSec !== undefined ? { sourceInSec: media.sourceInSec } : {}),
      ...(media.sourceOutSec !== undefined ? { sourceOutSec: media.sourceOutSec } : {}),
    }));
    const usedOrListed = new Set([...used, ...projectMedia.map((moment) => moment.shotId!)]);
    const unselected = (plan?.moments ?? []).filter((moment) => !moment.selected && moment.shotId && !usedOrListed.has(moment.shotId));
    const leftOut: Moment[] = (plan?.leftOut ?? []).filter((photo) => !usedOrListed.has(photo.shotId) && !unselected.some((moment) => moment.shotId === photo.shotId)).map((photo, index) => ({
      id: `left-out-${index}`, title: "Left out photo", meta: photo.reason, tag: { emoji: "📷", label: "Left out" }, imageKey: photo.thumbnailUrl, kind: "photo", selected: false, favorite: false, shotId: photo.shotId,
    }));
    return [...projectMedia, ...unselected, ...leftOut];
  }, [plan, editor.timeline, editor.unusedMedia]);
  const onApply = (op: EditOp) => {
    const applied = editor.apply(op);
    if (applied) setTool(null);
    return applied;
  };
  const onApplyCollage = (op: EditOp | EditOp[]) => {
    return Array.isArray(op) ? editor.applyMany(op) : editor.apply(op);
  };
  const onApplyAsk = (ops: EditOp[]) => { if (editor.applyMany(ops)) setTool(null); };
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
    selectEditorClip(id);
    const clip = timelineForSelection?.videoClips.find((item) => clipId(item) === id);
    setTool(clip && "kind" in clip ? "Collage" : null);
  }, [selectEditorClip, timelineForSelection]);
  const onTimelineSelect = useCallback((id: string, startSec: number) => { chooseClip(id); seekTo(startSec); }, [chooseClip, seekTo]);
  const openSoundtrackPicker = useCallback(() => setTool("Soundtrack"), []);
  const openTool = (next: Exclude<Tool, "Collage" | "Soundtrack" | null>) => {
    if (next === "Remove" && editor.timeline?.videoClips.length === 1) return;
    setTool(next);
  };
  const downloadRenderedFilm = async () => {
    if (!editor.downloadUrl || preparingDownload) return;
    setDownloadError(null);
    try { await downloadFilm(downloadSource!, plan?.title ?? "Your film", setPreparingDownload, preparedDownload); }
    catch { setDownloadError("Could not prepare the film download. Try again."); }
  };

  return <View className="flex-1 bg-screen">
    <View className="h-[60px] flex-row items-center justify-between px-5">
      <Pressable role="button" accessibilityLabel="Back" onPress={() => router.back()} className="min-h-11 min-w-11 justify-center"><Text className="font-sans text-[28px] text-on-screen">‹</Text></Pressable>
      <Text className="font-sans-semibold text-[18px] text-on-screen">Edit film</Text>
      <View className="flex-row items-center gap-2"><EditorMenu onReset={(ops) => editor.reset(ops)} /><Pressable role="button" accessibilityLabel="Save" onPress={() => void editor.render()} className="min-h-11 min-w-11 items-end justify-center"><Text className="font-sans-medium text-[16px] text-on-screen">Save</Text></Pressable></View>
    </View>
    <View className="min-h-[29px] justify-center px-5"><SaveState save={editor.save} renderProgress={editor.renderProgress} renderEtaMinutes={editor.renderEtaMinutes} onReload={() => void editor.reloadAfterConflict()} /></View>
    {editor.editError ? <Text accessibilityRole="alert" className="px-5 pb-2 font-sans text-caption text-on-screen">{editor.editError}</Text> : null}
    {editor.save.state === "ready" && editor.downloadUrl ? <View className="px-5 pb-2"><View className="flex-row gap-2"><Pressable role="button" accessibilityLabel="Download rendered film" disabled={preparingDownload || prefetchingDownload} onPress={() => void downloadRenderedFilm()} className="min-h-10 justify-center rounded-full bg-[#294655] px-4"><Text className="font-sans-medium text-caption text-on-screen">{preparingDownload || prefetchingDownload ? "Preparing download…" : "Download"}</Text></Pressable><Pressable role="button" accessibilityLabel="Share rendered film" onPress={() => void Share.share({ message: editor.downloadUrl! })} className="min-h-10 justify-center rounded-full border border-on-screen-muted px-4"><Text className="font-sans-medium text-caption text-on-screen">Share</Text></Pressable></View>{preparingDownload ? <Text accessibilityRole="progressbar" className="pt-1 font-sans text-caption text-on-screen-muted">Preparing your MP4…</Text> : null}{downloadError ? <Text accessibilityRole="alert" className="pt-1 font-sans text-caption text-critical">{downloadError}</Text> : null}</View> : null}
    {editor.error ? <View className="flex-1 items-center justify-center px-6"><Text className="text-center font-sans text-body text-on-screen">{editor.error}</Text></View>
      : !editor.timeline ? <View className="flex-1 items-center justify-center"><Text className="font-sans text-body text-on-screen-muted">Opening your film…</Text></View>
      : <ScrollView className="flex-1" contentContainerClassName="px-5 pb-4" showsVerticalScrollIndicator={false}>
        <View className="w-full overflow-hidden rounded-[14px] bg-tide-tile" style={{ height: previewHeight }}>
          <EditorPreview timeline={editor.timeline} sources={editor.sources} onTimeChange={onTimeChange} seekRequest={seekRequest} playheadSec={playhead} pauseRequest={pauseRequest} togglePlayRequest={togglePlayRequest} onPlayingChange={setPlaying} />
        </View>
        <View className="mt-4 flex-row items-center justify-between">
          <View className="flex-row items-center gap-3"><Pressable role="button" accessibilityLabel={playing ? "Pause film" : "Play film"} onPress={() => setTogglePlayRequest((request) => request + 1)} className="min-h-11 min-w-11 items-center justify-center rounded-full bg-black/35"><Text className="font-sans text-[18px] text-on-screen">{playing ? "Ⅱ" : "▶"}</Text></Pressable><Text className="font-sans text-caption text-on-screen">{time(playhead)} / {time(editor.timeline.durationSec)}</Text></View>
          <View className="flex-row gap-4">
            <Pressable role="button" accessibilityLabel="Undo" disabled={!editor.canUndo} onPress={editor.undo} className="min-h-11 min-w-11 items-center justify-center"><UndoIcon disabled={!editor.canUndo} /></Pressable>
            <Pressable role="button" accessibilityLabel="Redo" disabled={!editor.canRedo} onPress={editor.redo} className="min-h-11 min-w-11 items-center justify-center"><RedoIcon disabled={!editor.canRedo} /></Pressable>
          </View>
        </View>
        <TimelineStrip timeline={editor.timeline} sources={editor.sources} selectedClipId={editor.selectedClipId} playheadSec={playhead} soundtrackName={soundtrackName ? `${soundtrackName} · paced to the film` : null}
          onSelect={onTimelineSelect} onScrub={seekTo} onScrubStart={() => setPauseRequest((request) => request + 1)}
          onTrim={(id, edge, delta) => {
            const clip = editor.timeline?.videoClips.find((candidate) => idOf(candidate) === id);
            const original = editor.firstCut?.videoClips.find((candidate) => idOf(candidate) === id);
            if (clip && original && editor.firstCut) editor.apply(trimEdit(clip, original, edge, delta, editor.firstCut.durationSec));
          }} onDeselect={() => editor.select(null)} onSoundtrack={openSoundtrackPicker} />
      </ScrollView>}
    <ToolBar onTool={(value) => openTool(value)} />
    {tool === "Remove" && editor.selectedClipId ? <RemoveConfirm clipId={editor.selectedClipId} onApply={onApply} onUndo={() => { editor.undo(); setTool(null); }} /> : null}
    {tool === "Add" ? <AddSheet visible moments={addMoments} selectedClipId={editor.selectedClipId} onApply={onApply} onClose={() => setTool(null)} /> : null}
    {tool === "Collage" && selectedClip && "kind" in selectedClip ? <CollagePanel clip={selectedClip} sources={editor.sources} slotAlternatives={slotAlternatives?.clipId === selectedClip.clipId ? slotAlternatives.values : {}} onApply={onApplyCollage} onSource={editor.setSource} onClose={() => setTool(null)} /> : null}
    {tool === "Ask" && editor.timeline ? <AskSheet visible projectId={params.projectId || "fixture"} generationId={params.generationId || "demo-film"} revision={editor.savedRevision} timeline={editor.timeline} sources={editor.sources} repository={repository} initialRequest={typeof params.request === "string" ? params.request : ""} onApply={onApplyAsk} onClose={() => setTool(null)} /> : null}
    {tool === "Soundtrack" ? <SoundtrackSheet visible soundtracks={directions?.soundtracks ?? []} onApply={onApply} onClose={() => setTool(null)} /> : null}
  </View>;
}
