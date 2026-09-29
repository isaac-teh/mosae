import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { COLLAGE_EFFECTS, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, ALLOWED_COMBOS, type EditOp, type Timeline } from "@mosae/contracts";

type Collage = Extract<Timeline["videoClips"][number], { kind: "collage" }>;
type SlotAlternative = { shotId: string; thumbnailUrl: string; kind?: "photo" | "video" };
export function CollagePanel({ clip, slotAlternatives = {}, onApply, onSource, onClose }: { clip: Collage; slotAlternatives?: Record<string, SlotAlternative[]>; onApply: (op: EditOp) => void; onSource: (shotId: string, path: string) => void; onClose: () => void }) {
  const [slotError, setSlotError] = useState(false);
  const layoutOptions = COLLAGE_LAYOUTS.filter((layout) => ALLOWED_COMBOS.some((combo) => combo.layoutId === layout.id && combo.motionId === clip.spec.motionId));
  const motionOptions = COLLAGE_MOTIONS.filter((motion) => ALLOWED_COMBOS.some((combo) => combo.layoutId === clip.spec.layoutId && combo.motionId === motion.id));
  const send = (op: EditOp) => onApply(op);
  return <View className="absolute inset-0 z-20 justify-end bg-black/55"><ScrollView className="max-h-[88%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
    <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Collage style</Text><Pressable accessibilityLabel="Close collage" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Layout</Text><View className="mb-4 flex-row flex-wrap gap-2">{layoutOptions.map((layout) => <Pressable key={layout.id} role="button" accessibilityLabel={`Layout ${layout.label}`} onPress={() => send({ op: "setCollageLayout", clipId: clip.clipId, layoutId: layout.id })} className="rounded-full bg-[#203542] px-3 py-2"><Text className="font-sans text-caption text-on-screen">{layout.label}</Text></Pressable>)}</View>
    <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Motion</Text><View className="mb-4 flex-row flex-wrap gap-2">{motionOptions.map((motion) => <Pressable key={motion.id} role="button" accessibilityLabel={`Motion ${motion.label}`} onPress={() => send({ op: "setCollageMotion", clipId: clip.clipId, motionId: motion.id })} className="rounded-full bg-[#203542] px-3 py-2"><Text className="font-sans text-caption text-on-screen">{motion.label}</Text></Pressable>)}</View>
    <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Effect</Text><View className="mb-4 flex-row flex-wrap gap-2"><Pressable role="button" accessibilityLabel="Effect None" onPress={() => send({ op: "setCollageEffect", clipId: clip.clipId, effectId: null })} className="rounded-full bg-[#203542] px-3 py-2"><Text className="font-sans text-caption text-on-screen">None</Text></Pressable>{COLLAGE_EFFECTS.map((effect) => <Pressable key={effect.id} role="button" accessibilityLabel={`Effect ${effect.label}`} onPress={() => send({ op: "setCollageEffect", clipId: clip.clipId, effectId: effect.id })} className="rounded-full bg-[#203542] px-3 py-2"><Text className="font-sans text-caption text-on-screen">{effect.label}</Text></Pressable>)}</View>
    <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Replace photo</Text>{slotError ? <Text className="mb-2 font-sans text-caption text-critical">A collage can hold one video.</Text> : null}{clip.spec.slots.map((slot) => {
      const candidates = slotAlternatives[slot.slotId] ?? [];
      const hasVideo = clip.spec.slots.some((other) => other.slotId !== slot.slotId && other.kind === "video");
      return <View key={slot.slotId} className="mb-2 min-h-12 flex-row items-center justify-between gap-2 rounded-lg bg-[#1a2c38] px-3 py-2"><Text className="font-sans text-caption text-on-screen">Slot {slot.slotId}</Text><View className="flex-row flex-wrap justify-end gap-2">{candidates.map((alternative) => <Pressable key={alternative.shotId} role="button" accessibilityLabel={`Replace ${slot.slotId} with ${alternative.shotId}`} onPress={() => {
        if (alternative.kind === "video" && hasVideo) { setSlotError(true); return; }
        setSlotError(false);
        onSource(alternative.shotId, alternative.thumbnailUrl);
        if (alternative.kind === "video") { send({ op: "replaceCollageSlot", clipId: clip.clipId, slotId: slot.slotId, shotId: alternative.shotId, kind: "video" }); return; }
        send({ op: "replaceCollageSlot", clipId: clip.clipId, slotId: slot.slotId, shotId: alternative.shotId, kind: "photo" });
      }} className="rounded-full bg-[#294655] px-3 py-2"><Text className="font-sans text-caption text-on-screen">Use another photo</Text></Pressable>)}</View></View>;
    })}
    <Pressable role="button" accessibilityLabel="Split into single photos" onPress={() => send({ op: "splitCollage", clipId: clip.clipId })} className="mb-3 min-h-12 items-center justify-center rounded-full border border-on-screen-muted"><Text className="font-sans-semibold text-button text-on-screen">Split into single photos</Text></Pressable>
  </ScrollView></View>;
}
