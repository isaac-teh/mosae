import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
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
  const [tool, setTool] = useState<Tool>(null);
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [directions, setDirections] = useState<DirectionOptions | null>(null);
  const [slotAlternatives, setSlotAlternatives] = useState<{ clipId: string; values: Record<string, { shotId: string; thumbnailUrl: string; kind?: "photo" | "video" }[]> } | null>(null);
  const onTimeChange = useCallback((seconds: number) => setPlayhead(seconds), []);
  const previewHeight = Math.max(280, Math.min(720, height - 390));
  const soundtrack = editor.timeline?.audioClips.find((clip) => clip.role === "music" && clip.source.kind === "soundtrack");
  const soundtrackLabel = soundtrack?.source.kind === "soundtrack"
    ? soundtrack.source.soundtrackId.replace(/[-_]/g, " ")
    : "No soundtrack";
  useEffect(() => {
    let active = true;
    if (!params.planId) return () => { active = false; };
    void Promise.all([repository.getPlan(params.planId), repository.getDirectionOptions(params.planId)])
      .then(([nextPlan, nextDirections]) => { if (active) { setPlan(nextPlan); setDirections(nextDirections); } })
      .catch(() => { if (active) { setPlan(null); setDirections(null); } });
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
    if (!plan || !editor.timeline) return [];
    const used = shotIdsIn(editor.timeline);
    const unselected = plan.moments.filter((moment) => !moment.selected && moment.shotId && !used.has(moment.shotId));
    const leftOut: Moment[] = (plan.leftOut ?? []).filter((photo) => !used.has(photo.shotId) && !unselected.some((moment) => moment.shotId === photo.shotId)).map((photo, index) => ({
      id: `left-out-${index}`, title: "Left out photo", meta: photo.reason, tag: { emoji: "📷", label: "Left out" }, imageKey: photo.thumbnailUrl, kind: "photo", selected: false, favorite: false, shotId: photo.shotId,
    }));
    return [...unselected, ...leftOut];
  }, [plan, editor.timeline]);
  const onApply = (op: EditOp) => { editor.apply(op); setTool(null); };
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
    {editor.error ? <View className="flex-1 items-center justify-center px-6"><Text className="text-center font-sans text-body text-on-screen">{editor.error}</Text></View>
      : !editor.timeline ? <View className="flex-1 items-center justify-center"><Text className="font-sans text-body text-on-screen-muted">Opening your film…</Text></View>
      : <ScrollView className="flex-1" contentContainerClassName="px-5 pb-4" showsVerticalScrollIndicator={false}>
        <View className="w-full overflow-hidden rounded-[14px] bg-tide-tile" style={{ height: previewHeight }}>
          <EditorPreview timeline={editor.timeline} sources={editor.sources} onTimeChange={onTimeChange} />
        </View>
        {params.request ? <Text className="mt-2 rounded-md bg-tide-tile/20 px-3 py-2 font-sans text-caption text-on-screen">You asked: {params.request}</Text> : null}
        <View className="mt-4 flex-row items-center justify-between">
          <Text className="font-sans text-caption text-on-screen">{time(playhead)} / {time(editor.timeline.durationSec)}</Text>
          <View className="flex-row gap-4">
            <Pressable role="button" accessibilityLabel="Undo" disabled={!editor.canUndo} onPress={editor.undo} className="min-h-10 min-w-10 items-center justify-center"><Text className={`font-sans text-[27px] ${editor.canUndo ? "text-on-screen" : "text-on-screen-muted/45"}`}>↶</Text></Pressable>
            <Pressable role="button" accessibilityLabel="Redo" disabled={!editor.canRedo} onPress={editor.redo} className="min-h-10 min-w-10 items-center justify-center"><Text className={`font-sans text-[27px] ${editor.canRedo ? "text-on-screen" : "text-on-screen-muted/45"}`}>↷</Text></Pressable>
          </View>
        </View>
        <TimelineStrip timeline={editor.timeline} sources={editor.sources} selectedClipId={editor.selectedClipId} onSelect={chooseClip} />
        <Pressable accessibilityLabel="Open soundtrack picker" onPress={() => setTool("Soundtrack")} className="mt-3 min-h-[44px] flex-row items-center rounded-md bg-[#142a39] px-4"><Text className="font-sans text-caption text-on-screen-muted">♫ &nbsp; {soundtrackLabel}</Text></Pressable>
      </ScrollView>}
    <ToolBar onTool={(value) => openTool(value)} />
    {tool === "Swap" && selectedClip && !("kind" in selectedClip) ? <SwapSheet visible clipId={selectedClip.id} planId={plan?.planId ?? null} momentId={selectedMoment?.id ?? null} repository={repository} onApply={onApply} onSource={editor.setSource} onClose={() => setTool(null)} /> : null}
    {tool === "Trim" && selectedClip ? <TrimControl clip={selectedClip} onApply={onApply} onClose={() => setTool(null)} /> : null}
    {tool === "Move" && editor.timeline && editor.selectedClipId ? <MoveMode timeline={editor.timeline} clipId={editor.selectedClipId} onApply={onApply} onClose={() => setTool(null)} /> : null}
    {tool === "Remove" && editor.selectedClipId ? <RemoveConfirm clipId={editor.selectedClipId} onApply={onApply} onUndo={() => { editor.undo(); setTool(null); }} /> : null}
    {tool === "Add" ? <AddSheet visible moments={addMoments} selectedClipId={editor.selectedClipId} onApply={onApply} onClose={() => setTool(null)} /> : null}
    {tool === "Collage" && selectedClip && "kind" in selectedClip ? <CollagePanel clip={selectedClip} slotAlternatives={slotAlternatives?.clipId === selectedClip.clipId ? slotAlternatives.values : {}} onApply={onApply} onSource={editor.setSource} onClose={() => setTool(null)} /> : null}
    {tool === "Soundtrack" ? <SoundtrackSheet visible soundtracks={directions?.soundtracks ?? []} onApply={onApply} onClose={() => setTool(null)} /> : null}
  </View>;
}
