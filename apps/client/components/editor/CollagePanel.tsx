import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { COLLAGE_LAYOUTS, COLLAGE_MOTIONS, ALLOWED_COMBOS, type EditOp, type Timeline } from "@mosae/contracts";
import { FocusChip } from "../ds/FocusChip";

type Collage = Extract<Timeline["videoClips"][number], { kind: "collage" }>;
type CollageOp = EditOp | EditOp[];

export function CollagePanel({ clip, section, onApply, onClose }: { clip: Collage; section: "Layout" | "Motion"; onApply: (op: CollageOp) => void; onClose: () => void }) {
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
    <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Collage {section.toLowerCase()}</Text><Pressable accessibilityLabel="Close collage" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    {section === "Layout" ? <><Text className="mb-2 font-sans-semibold text-caption text-on-screen">Layout</Text><View className="mb-4 flex-row flex-wrap gap-2">{layoutOptions.map((layout) => <FocusChip key={layout.id} label={layout.label} accessibilityLabel={`Layout ${layout.label}`} selected={layoutId === layout.id} onPress={() => chooseLayout(layout.id)} />)}</View></> : null}
    {section === "Motion" ? <><Text className="mb-2 font-sans-semibold text-caption text-on-screen">Motion</Text><View className="mb-4 flex-row flex-wrap gap-2">{motionOptions.map((motion) => <FocusChip key={motion.id} label={motion.label} accessibilityLabel={`Motion ${motion.label}`} selected={motionId === motion.id} onPress={() => { setSelection({ clipId: clip.clipId, baseLayoutId: clip.spec.layoutId, baseMotionId: clip.spec.motionId, layoutId, motionId: motion.id }); send({ op: "setCollageMotion", clipId: clip.clipId, motionId: motion.id }); }} />)}</View></> : null}
  </ScrollView></View>;
}
