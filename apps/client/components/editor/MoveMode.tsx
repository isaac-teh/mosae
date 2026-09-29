import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { EditOp, Timeline } from "@mosae/contracts";

const idOf = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
export function MoveMode({ timeline, clipId, onApply, onClose }: { timeline: Timeline; clipId: string; onApply: (op: EditOp) => void; onClose: () => void }) {
  const [dragging, setDragging] = useState(false);
  const startIndex = timeline.videoClips.findIndex((clip) => idOf(clip) === clipId);
  const pointerDown = useRef(false);
  const suppressClick = useRef(false);
  return <View className="absolute inset-0 z-20 justify-end bg-black/55">
    <View className="rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
      <View className="mb-3 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Move clip</Text><Pressable accessibilityLabel="Close move" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
      <Text className="mb-3 font-sans text-caption text-on-screen-muted">Drag a position to ripple the timeline.</Text>
      <View className="flex-row gap-2">{timeline.videoClips.map((clip, index) => {
        const id = idOf(clip);
        return <Pressable key={id} role="button" accessibilityLabel={id === clipId ? `Move clip ${id}` : `Drop clip at position ${index + 1}`} onPointerDown={() => { if (id === clipId) { pointerDown.current = true; setDragging(true); } }} onPointerUp={() => { if (pointerDown.current && id !== clipId) { pointerDown.current = false; suppressClick.current = true; setDragging(false); onApply({ op: "move", clipId, toIndex: index }); onClose(); } }} onPress={() => { if (suppressClick.current) { suppressClick.current = false; return; } if (id !== clipId) { onApply({ op: "move", clipId, toIndex: index }); onClose(); } }} className={`h-16 flex-1 items-center justify-center rounded-lg ${id === clipId ? "bg-accent" : "bg-[#203542]"}`}><Text className="font-sans text-caption text-on-screen">{index + 1}</Text></Pressable>;
      })}</View>
      {dragging ? <Text className="mt-3 font-sans text-caption text-on-screen">Choose a destination</Text> : null}
      <Text className="mt-3 font-sans text-[11px] text-on-screen-muted">Current position {startIndex + 1}</Text>
    </View>
  </View>;
}
