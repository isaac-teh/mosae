import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, Share, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { EditOp, Timeline } from "@mosae/contracts";
import { useStoryFlow } from "@/lib/storyFlow";
import { useEditor } from "@/lib/useEditor";
import type { StoryPlan, DirectionOptions, Moment } from "@mosae/core";
import { EditorPreview } from "@/components/editor/EditorPreview";
import { TimelineStrip } from "@/components/editor/TimelineStrip";
import { ToolBar } from "@/components/editor/ToolBar";
import { SaveState } from "@/components/editor/SaveState";
import { SwapSheet } from "@/components/editor/SwapSheet";
import { TrimControl } from "@/components/editor/TrimControl";
import { MoveMode } from "@/components/editor/MoveMode";
import { AddSheet } from "@/components/editor/AddSheet";
import { CollagePanel } from "@/components/editor/CollagePanel";
import { SoundtrackSheet } from "@/components/editor/SoundtrackSheet";
import { RemoveConfirm } from "@/components/editor/RemoveConfirm";
import { EditorMenu } from "@/components/editor/EditorMenu";
import { AskSheet } from "@/components/editor/AskSheet";
import { RedoIcon, UndoIcon } from "@/components/icons";

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
type Tool = "Swap" | "Trim" | "Move" | "Remove" | "Add" | "Ask" | "Collage" | "Soundtrack" | null;
const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const clipShotId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.spec.slots[0]?.shotId : clip.source.shotId;
const shotIdsIn = (timeline: Timeline) => new Set(timeline.videoClips.flatMap((clip) => "kind" in clip ? clip.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : []) : [clip.source.shotId]));

export default function EditorScreen() {
  const params = useLocalSearchParams<{ projectId?: string; generationId?: string; planId?: string; request?: string }>();
  const { repository } = useStoryFlow();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const editor = useEditor(params.projectId || "fixture", params.generationId || "demo-film", repository);
  const [playhead, setPlayhead] = useState(0);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number } | null>(null);
  const [tool, setTool] = useState<Tool>(params.request ? "Ask" : null);
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [directions, setDirections] = useState<DirectionOptions | null>(null);
  const [slotAlternatives, setSlotAlternatives] = useState<{ clipId: string; values: Record<string, { shotId: string; thumbnailUrl: string; kind?: "photo" | "video" }[]> } | null>(null);
  const onTimeChange = useCallback((seconds: number) => setPlayhead(seconds), []);
  const seekTo = (seconds: number) => {
    const target = Math.max(0, Math.min(editor.timeline?.durationSec ?? 0, seconds));
    setPlayhead(target);
    setSeekRequest({ seconds: target });
  };
  const previewHeight = Math.max(280, Math.min(720, height - 390));
  const soundtrack = editor.timeline?.audioClips.find((clip) => clip.role === "music" && clip.source.kind === "soundtrack");
  const soundtrackId = soundtrack?.source.kind === "soundtrack" ? soundtrack.source.soundtrackId : null;
  const soundtrackName = soundtrackId
    ? directions?.soundtracks.find((track) => track.id === soundtrackId)?.name ?? "Soundtrack"
    : null;
  const soundtrackLabel = soundtrackName ? `${soundtrackName} · paced to the film` : "No soundtrack";
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
  const selectedShotId = selectedClip ? clipShotId(selectedClip) : undefined;
  const selectedMoment = plan?.moments.find((moment) => moment.shotId === selectedShotId) ?? null;
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
  const chooseClip = (id: string) => {
    editor.select(id);
    const clip = editor.timeline?.videoClips.find((item) => clipId(item) === id);
    setTool(clip && "kind" in clip ? "Collage" : null);
  };
  const openTool = (next: Exclude<Tool, "Collage" | "Soundtrack" | null>) => {
    if (next === "Remove" && editor.timeline?.videoClips.length === 1) return;
    if ((next === "Swap" || next === "Trim") && selectedClip && "kind" in selectedClip) { setTool("Collage"); return; }
    setTool(next);
  };

  return <View className="flex-1 bg-screen">
    <View className="h-[60px] flex-row items-center justify-between px-5">
      <Pressable role="button" accessibilityLabel="Back" onPress={() => router.back()} className="min-h-11 min-w-11 justify-center"><Text className="font-sans text-[28px] text-on-screen">‹</Text></Pressable>
      <Text className="font-sans-semibold text-[18px] text-on-screen">Edit film</Text>
      <View className="flex-row items-center gap-2"><EditorMenu onReset={(ops) => editor.reset(ops)} /><Pressable role="button" accessibilityLabel="Save" onPress={() => void editor.render()} className="min-h-11 min-w-11 items-end justify-center"><Text className="font-sans-medium text-[16px] text-on-screen">Save</Text></Pressable></View>
    </View>
    <View className="min-h-[29px] justify-center px-5"><SaveState save={editor.save} onReload={() => void editor.reloadAfterConflict()} /></View>
    {editor.editError ? <Text accessibilityRole="alert" className="px-5 pb-2 font-sans text-caption text-on-screen">{editor.editError}</Text> : null}
    {editor.save.state === "ready" && editor.downloadUrl ? <View className="flex-row gap-2 px-5 pb-2"><Pressable role="button" accessibilityLabel="Download rendered film" onPress={() => void Linking.openURL(editor.downloadUrl!)} className="min-h-10 justify-center rounded-full bg-[#294655] px-4"><Text className="font-sans-medium text-caption text-on-screen">Download</Text></Pressable><Pressable role="button" accessibilityLabel="Share rendered film" onPress={() => void Share.share({ message: editor.downloadUrl! })} className="min-h-10 justify-center rounded-full border border-on-screen-muted px-4"><Text className="font-sans-medium text-caption text-on-screen">Share</Text></Pressable></View> : null}
    {editor.error ? <View className="flex-1 items-center justify-center px-6"><Text className="text-center font-sans text-body text-on-screen">{editor.error}</Text></View>
      : !editor.timeline ? <View className="flex-1 items-center justify-center"><Text className="font-sans text-body text-on-screen-muted">Opening your film…</Text></View>
      : <ScrollView className="flex-1" contentContainerClassName="px-5 pb-4" showsVerticalScrollIndicator={false}>
        <View className="w-full overflow-hidden rounded-[14px] bg-tide-tile" style={{ height: previewHeight }}>
          <EditorPreview timeline={editor.timeline} sources={editor.sources} onTimeChange={onTimeChange} seekRequest={seekRequest} />
        </View>
        <View className="mt-4 flex-row items-center justify-between">
          <Text className="font-sans text-caption text-on-screen">{time(playhead)} / {time(editor.timeline.durationSec)}</Text>
          <View className="flex-row gap-4">
            <Pressable role="button" accessibilityLabel="Undo" disabled={!editor.canUndo} onPress={editor.undo} className="min-h-11 min-w-11 items-center justify-center"><UndoIcon disabled={!editor.canUndo} /></Pressable>
            <Pressable role="button" accessibilityLabel="Redo" disabled={!editor.canRedo} onPress={editor.redo} className="min-h-11 min-w-11 items-center justify-center"><RedoIcon disabled={!editor.canRedo} /></Pressable>
          </View>
        </View>
        <TimelineStrip timeline={editor.timeline} sources={editor.sources} selectedClipId={editor.selectedClipId} playheadSec={playhead}
          onSelect={(id, startSec) => { chooseClip(id); seekTo(startSec); }} onScrub={seekTo} />
        <Pressable accessibilityLabel="Open soundtrack picker" onPress={() => setTool("Soundtrack")} className="mt-3 min-h-[44px] flex-row items-center rounded-md bg-[#142a39] px-4"><Text className="font-sans text-caption text-on-screen-muted">♫ &nbsp; {soundtrackLabel}</Text></Pressable>
      </ScrollView>}
    <ToolBar onTool={(value) => openTool(value)} />
    {tool === "Swap" && selectedClip && !("kind" in selectedClip) ? <SwapSheet visible clipId={selectedClip.id} planId={plan?.planId ?? null} momentId={selectedMoment?.id ?? null} repository={repository} onApply={onApply} onSource={editor.setSource} onClose={() => setTool(null)} /> : null}
    {tool === "Trim" && selectedClip ? <TrimControl clip={selectedClip} onApply={editor.apply} onClose={() => setTool(null)} /> : null}
    {tool === "Move" && editor.timeline && editor.selectedClipId ? <MoveMode timeline={editor.timeline} clipId={editor.selectedClipId} onApply={onApply} onClose={() => setTool(null)} /> : null}
    {tool === "Remove" && editor.selectedClipId ? <RemoveConfirm clipId={editor.selectedClipId} onApply={onApply} onUndo={() => { editor.undo(); setTool(null); }} /> : null}
    {tool === "Add" ? <AddSheet visible moments={addMoments} selectedClipId={editor.selectedClipId} onApply={onApply} onClose={() => setTool(null)} /> : null}
    {tool === "Collage" && selectedClip && "kind" in selectedClip ? <CollagePanel clip={selectedClip} sources={editor.sources} slotAlternatives={slotAlternatives?.clipId === selectedClip.clipId ? slotAlternatives.values : {}} onApply={onApplyCollage} onSource={editor.setSource} onClose={() => setTool(null)} /> : null}
    {tool === "Ask" && editor.timeline ? <AskSheet visible projectId={params.projectId || "fixture"} generationId={params.generationId || "demo-film"} revision={editor.savedRevision} timeline={editor.timeline} sources={editor.sources} repository={repository} initialRequest={typeof params.request === "string" ? params.request : ""} onApply={onApplyAsk} onClose={() => setTool(null)} /> : null}
    {tool === "Soundtrack" ? <SoundtrackSheet visible soundtracks={directions?.soundtracks ?? []} onApply={onApply} onClose={() => setTool(null)} /> : null}
  </View>;
}
