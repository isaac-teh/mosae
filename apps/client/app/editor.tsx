import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStoryFlow } from "@/lib/storyFlow";
import { useEditor } from "@/lib/useEditor";
import { EditorPreview } from "@/components/editor/EditorPreview";
import { TimelineStrip } from "@/components/editor/TimelineStrip";
import { ToolBar } from "@/components/editor/ToolBar";
import { SaveState } from "@/components/editor/SaveState";

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function EditorScreen() {
  const params = useLocalSearchParams<{ projectId?: string; generationId?: string; request?: string }>();
  const { repository } = useStoryFlow();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const editor = useEditor(params.projectId || "fixture", params.generationId || "demo-film", repository);
  const [playhead, setPlayhead] = useState(0);
  const onTimeChange = useCallback((seconds: number) => setPlayhead(seconds), []);
  const previewHeight = Math.max(280, Math.min(720, height - 390));
  const soundtrack = editor.timeline?.audioClips.find((clip) => clip.role === "music" && clip.source.kind === "soundtrack");
  const soundtrackLabel = soundtrack?.source.kind === "soundtrack"
    ? soundtrack.source.soundtrackId.replace(/[-_]/g, " ")
    : "No soundtrack";

  return <View className="flex-1 bg-screen">
    <View className="h-[60px] flex-row items-center justify-between px-5">
      <Pressable role="button" accessibilityLabel="Back" onPress={() => router.back()} className="min-h-11 min-w-11 justify-center"><Text className="font-sans text-[28px] text-on-screen">‹</Text></Pressable>
      <Text className="font-sans-semibold text-[18px] text-on-screen">Edit film</Text>
      <Pressable role="button" accessibilityLabel="Save" onPress={() => void editor.render()} className="min-h-11 min-w-11 items-end justify-center"><Text className="font-sans-medium text-[16px] text-on-screen">Save</Text></Pressable>
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
        <TimelineStrip timeline={editor.timeline} sources={editor.sources} selectedClipId={editor.selectedClipId} onSelect={editor.select} />
        <View className="mt-3 min-h-[44px] flex-row items-center rounded-md bg-[#142a39] px-4"><Text className="font-sans text-caption text-on-screen-muted">♫ &nbsp; {soundtrackLabel}</Text></View>
      </ScrollView>}
    <ToolBar />
  </View>;
}
