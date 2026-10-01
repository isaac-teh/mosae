import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { COLLAGE_EFFECTS, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, ALLOWED_COMBOS, type EditOp, type Timeline } from "@mosae/contracts";
import { FocusChip } from "../ds/FocusChip";

type Collage = Extract<Timeline["videoClips"][number], { kind: "collage" }>;
type SlotAlternative = { shotId: string; thumbnailUrl: string; kind?: "photo" | "video" };
type CollageOp = EditOp | EditOp[];

export function CollagePanel({ clip, sources = {}, slotAlternatives = {}, onApply, onSource, onClose }: { clip: Collage; sources?: Record<string, string>; slotAlternatives?: Record<string, SlotAlternative[]>; onApply: (op: CollageOp) => void; onSource: (shotId: string, path: string) => void; onClose: () => void }) {
  const [slotError, setSlotError] = useState(false);
  const [replacingSlot, setReplacingSlot] = useState<string | null>(null);
  const [selection, setSelection] = useState({ clipId: clip.clipId, baseLayoutId: clip.spec.layoutId, baseMotionId: clip.spec.motionId, layoutId: clip.spec.layoutId, motionId: clip.spec.motionId });
  const isCurrentSelection = selection.clipId === clip.clipId && selection.baseLayoutId === clip.spec.layoutId && selection.baseMotionId === clip.spec.motionId;
  const layoutId = isCurrentSelection ? selection.layoutId : clip.spec.layoutId;
  const motionId = isCurrentSelection ? selection.motionId : clip.spec.motionId;

  const layoutOptions = COLLAGE_LAYOUTS.filter((layout) => clip.spec.slots.length >= layout.minSlots && clip.spec.slots.length <= layout.maxSlots && ALLOWED_COMBOS.some((combo) => combo.layoutId === layout.id));
  const motionOptions = COLLAGE_MOTIONS.filter((motion) => ALLOWED_COMBOS.some((combo) => combo.layoutId === layoutId && combo.motionId === motion.id));
  const chooseLayout = (nextLayoutId: typeof COLLAGE_LAYOUTS[number]["id"]) => {
    const allowedMotions = ALLOWED_COMBOS.filter((combo) => combo.layoutId === nextLayoutId).map((combo) => combo.motionId);
    const nextMotionId = allowedMotions.includes(motionId) ? motionId : allowedMotions[0];
    setSelection({ clipId: clip.clipId, baseLayoutId: clip.spec.layoutId, baseMotionId: clip.spec.motionId, layoutId: nextLayoutId, motionId: nextMotionId });
    const ops: EditOp[] = [{ op: "setCollageLayout", clipId: clip.clipId, layoutId: nextLayoutId }];
    if (nextMotionId !== clip.spec.motionId) ops.push({ op: "setCollageMotion", clipId: clip.clipId, motionId: nextMotionId });
    onApply(ops);
  };
  const send = (op: EditOp) => onApply(op);

  return <View className="absolute inset-0 z-20 justify-end bg-black/55"><ScrollView className="max-h-[88%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
    <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Collage style</Text><Pressable accessibilityLabel="Close collage" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Layout</Text><View className="mb-4 flex-row flex-wrap gap-2">{layoutOptions.map((layout) => <FocusChip key={layout.id} label={layout.label} accessibilityLabel={`Layout ${layout.label}`} selected={layoutId === layout.id} onPress={() => chooseLayout(layout.id)} />)}</View>
    <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Motion</Text><View className="mb-4 flex-row flex-wrap gap-2">{motionOptions.map((motion) => <FocusChip key={motion.id} label={motion.label} accessibilityLabel={`Motion ${motion.label}`} selected={motionId === motion.id} onPress={() => { setSelection({ clipId: clip.clipId, baseLayoutId: clip.spec.layoutId, baseMotionId: clip.spec.motionId, layoutId, motionId: motion.id }); send({ op: "setCollageMotion", clipId: clip.clipId, motionId: motion.id }); }} />)}</View>
    <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Effect</Text><View className="mb-4 flex-row flex-wrap gap-2"><FocusChip label="None" accessibilityLabel="Effect None" selected={clip.spec.effectId === null} onPress={() => send({ op: "setCollageEffect", clipId: clip.clipId, effectId: null })} />{COLLAGE_EFFECTS.map((effect) => <FocusChip key={effect.id} label={effect.label} accessibilityLabel={`Effect ${effect.label}`} selected={clip.spec.effectId === effect.id} onPress={() => send({ op: "setCollageEffect", clipId: clip.clipId, effectId: effect.id })} />)}</View>
    <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Replace photo</Text>{slotError ? <Text className="mb-2 font-sans text-caption text-critical">A collage can hold one video.</Text> : null}{clip.spec.slots.map((slot, index) => {
      const photoLabel = `Photo ${index + 1}`;
      const candidates = slotAlternatives[slot.slotId] ?? [];
      const hasVideo = clip.spec.slots.some((other) => other.slotId !== slot.slotId && other.kind === "video");
      return <View key={slot.slotId} className="mb-2 rounded-lg bg-[#1a2c38] px-3 py-2"><View className="min-h-12 flex-row items-center justify-between gap-3">
        {sources[slot.shotId ?? ""] ? <Image source={{ uri: sources[slot.shotId!] }} accessibilityLabel={`${photoLabel} thumbnail`} className="h-12 w-12 rounded-lg" resizeMode="cover" /> : <View accessibilityLabel={`${photoLabel} thumbnail`} className="h-12 w-12 rounded-lg bg-[#294655]" />}
        <Text className="flex-1 font-sans text-caption text-on-screen">{photoLabel}</Text>
        <Pressable role="button" accessibilityLabel={`Replace ${photoLabel}`} onPress={() => setReplacingSlot((current) => current === slot.slotId ? null : slot.slotId)} className="min-h-11 justify-center rounded-full bg-[#294655] px-4"><Text className="font-sans-semibold text-caption text-on-screen">Replace</Text></Pressable>
      </View>{replacingSlot === slot.slotId ? <View className="mt-2 flex-row flex-wrap gap-2">{candidates.map((alternative, alternativeIndex) => <Pressable key={alternative.shotId} role="button" accessibilityLabel={`Replace ${photoLabel} with option ${alternativeIndex + 1}`} onPress={() => {
        if (alternative.kind === "video" && hasVideo) { setSlotError(true); return; }
        setSlotError(false);
        onSource(alternative.shotId, alternative.thumbnailUrl);
        send({ op: "replaceCollageSlot", clipId: clip.clipId, slotId: slot.slotId, shotId: alternative.shotId, kind: alternative.kind === "video" ? "video" : "photo" });
        setReplacingSlot(null);
      }} className="rounded-full bg-[#294655] px-3 py-2"><Text className="font-sans text-caption text-on-screen">Photo option {alternativeIndex + 1}</Text></Pressable>)}</View> : null}</View>;
    })}
    <Pressable role="button" accessibilityLabel="Split into single photos" onPress={() => send({ op: "splitCollage", clipId: clip.clipId })} className="mb-3 min-h-12 items-center justify-center rounded-full border border-on-screen-muted"><Text className="font-sans-semibold text-button text-on-screen">Split into single photos</Text></Pressable>
  </ScrollView></View>;
}
