import { Image, Pressable, Text, View } from "react-native";
import type { Timeline } from "@mosae/contracts";

export function EditorPreview({ timeline, sources, selectedClipId, onSelectClip }: { timeline: Timeline; sources: Record<string, string>; onTimeChange?: (seconds: number) => void; seekRequest?: { seconds: number } | null; playheadSec?: number; pauseRequest?: number; togglePlayRequest?: number; onPlayingChange?: (playing: boolean) => void; poster?: string; onError?: (error: Error) => void; selectedClipId?: string | null; onSelectClip?: (clipId: string) => void; onCommitPhotoCrop?: (clipId: string, crop: { x: number; y: number; scale: number; rotationDeg?: number }) => void; selectedCollageCellId?: string | null; onSelectCollageCell?: (clipId: string, slotId: string) => void; onCommitCollageCrop?: (clipId: string, slotId: string, crop: { x: number; y: number; scale: number; rotationDeg?: number }) => void }) {
  const first = timeline.videoClips[0];
  const shotId = first && ("kind" in first ? first.spec.slots[0]?.shotId : first.source.shotId);
  const uri = shotId ? sources[shotId] : undefined;
  const activeClipId = first ? ("kind" in first ? first.clipId : first.id) : null;
  const selected = activeClipId !== null && activeClipId === selectedClipId;
  return <Pressable accessibilityRole="button" accessibilityLabel={selected ? "Selected photo clip preview" : "Select photo clip preview"} onPress={() => activeClipId && onSelectClip?.(activeClipId)} className={`size-full overflow-hidden rounded-[14px] border-[3px] bg-tide-tile ${selected ? "border-[#f38a5b]" : "border-transparent"}`}>
    {uri && <Image source={{ uri }} resizeMode="cover" className="size-full opacity-60" />}
    <View className="absolute inset-0 items-center justify-center bg-black/35 px-6"><Text className="text-center font-sans text-body text-on-screen">Editing is available on the web for now.</Text></View>
  </Pressable>;
}
