import { useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { COLLAGE_GRID_VARIANTS, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, ALLOWED_COMBOS, collageGridRects, type CollageGridVariant, type EditOp, type Timeline } from "@mosae/contracts";

import { demoImage } from "@/lib/demoAssets";

const LIBRARY_IDS = new Set(["photo-table", "torn-paper", "polaroid-garland", "postcard-stack", "route-map", "botanical-scrapbook", "nine-photo-grid", "travel-mosaic", "travel-story"]);

type Collage = Extract<Timeline["videoClips"][number], { kind: "collage" }>;
type CollageOp = EditOp | EditOp[];
function thumbnailRects(layoutId: string, count: number): { x: number; y: number; w: number; h: number }[] {
  const gridVariant = COLLAGE_GRID_VARIANTS.find((variant) => variant.id === layoutId)?.id;
  if (gridVariant) return collageGridRects(gridVariant, count);
  const asymmetrical: Record<string, { x: number; y: number; w: number; h: number }[]> = {
    "single-photo": [{ x: 0, y: 0, w: 100, h: 100 }],
    "two-photo-diptych": [{ x: 0, y: 0, w: 49, h: 100 }, { x: 51, y: 0, w: 49, h: 100 }],
    "travel-story": [{ x: 0, y: 0, w: 64, h: 48 }, { x: 66, y: 0, w: 34, h: 100 }, { x: 0, y: 51, w: 31, h: 49 }, { x: 33, y: 51, w: 31, h: 23 }, { x: 33, y: 77, w: 31, h: 23 }],
    "travel-mosaic": [{ x: 0, y: 0, w: 32, h: 32 }, { x: 34, y: 0, w: 66, h: 32 }, { x: 0, y: 34, w: 49, h: 32 }, { x: 51, y: 34, w: 49, h: 32 }, { x: 0, y: 68, w: 32, h: 32 }, { x: 34, y: 68, w: 66, h: 32 }],
    "botanical-scrapbook": [{ x: 0, y: 0, w: 62, h: 52 }, { x: 64, y: 0, w: 36, h: 32 }, { x: 64, y: 34, w: 36, h: 66 }, { x: 0, y: 54, w: 62, h: 46 }],
  };
  if (layoutId === "travel-story" && count === 5) return asymmetrical[layoutId]!;
  if (layoutId === "travel-mosaic" && count >= 3) return asymmetrical[layoutId]!.slice(0, count);
  if (layoutId === "botanical-scrapbook" && count >= 3) return [...asymmetrical[layoutId]!.slice(0, Math.min(count, 4)), ...Array.from({ length: Math.max(0, count - 4) }, (_, i) => ({ x: 66, y: (i * 24) % 100, w: 34, h: 22 }))];
  const columns = layoutId === "nine-photo-grid" ? 3 : Math.min(3, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const gap = 3;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const rowCount = Math.min(columns, count - row * columns);
    return { x: col * (100 + gap) / rowCount, y: row * (100 + gap) / rows, w: (100 - gap * (rowCount - 1)) / rowCount, h: (100 - gap * (rows - 1)) / rows };
  });
}

export function CollagePanel({ clip, section, aspect = "9:16", onApply, onClose }: {
  clip: Collage;
  section: "Layout" | "Motion";
  aspect?: Timeline["aspect"];
  onApply: (op: CollageOp) => void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState({ clipId: clip.clipId, baseLayoutId: clip.spec.layoutId, baseMotionId: clip.spec.motionId, layoutId: clip.spec.layoutId, motionId: clip.spec.motionId });
  const [category, setCategory] = useState<"Layouts" | "Styles">("Layouts");
  const touchY = useRef<number | null>(null);
  const isCurrentSelection = selection.clipId === clip.clipId && selection.baseLayoutId === clip.spec.layoutId && selection.baseMotionId === clip.spec.motionId;
  const layoutId = isCurrentSelection ? selection.layoutId : clip.spec.layoutId;
  const motionId = isCurrentSelection ? selection.motionId : clip.spec.motionId;
  const count = clip.spec.slots.length;
  const minCount = Math.min(...COLLAGE_LAYOUTS.map((layout) => layout.minSlots));
  const maxCount = Math.max(...COLLAGE_LAYOUTS.map((layout) => layout.maxSlots));
  const layoutOptions = COLLAGE_LAYOUTS.filter((layout) => count >= layout.minSlots && count <= layout.maxSlots && (layout.aspect as readonly string[]).includes(aspect) && ALLOWED_COMBOS.some((combo) => combo.layoutId === layout.id)).sort((a, b) => {
    const aIndex = COLLAGE_GRID_VARIANTS.findIndex((variant) => variant.id === a.id);
    const bIndex = COLLAGE_GRID_VARIANTS.findIndex((variant) => variant.id === b.id);
    return (aIndex < 0 ? COLLAGE_GRID_VARIANTS.length : aIndex) - (bIndex < 0 ? COLLAGE_GRID_VARIANTS.length : bIndex);
  });
  const visibleLayouts = category === "Styles"
    ? COLLAGE_LAYOUTS.filter((layout) => LIBRARY_IDS.has(layout.id) && (layout.aspect as readonly string[]).includes(aspect))
    : layoutOptions.filter((layout) => !LIBRARY_IDS.has(layout.id));
  const motionOptions = COLLAGE_MOTIONS.filter((motion) => ALLOWED_COMBOS.some((combo) => combo.layoutId === layoutId && combo.motionId === motion.id));
  const chooseLayout = (nextLayoutId: typeof COLLAGE_LAYOUTS[number]["id"]) => {
    const allowedMotions = ALLOWED_COMBOS.filter((combo) => combo.layoutId === nextLayoutId).map((combo) => combo.motionId);
    const nextMotionId = allowedMotions.includes(motionId) ? motionId : allowedMotions[0];
    setSelection({ clipId: clip.clipId, baseLayoutId: clip.spec.layoutId, baseMotionId: clip.spec.motionId, layoutId: nextLayoutId, motionId: nextMotionId });
    onApply({ op: "setCollageSpec", clipId: clip.clipId, spec: { ...clip.spec, layoutId: nextLayoutId, motionId: nextMotionId } });
  };
  const setPhotoCount = (nextCount: number) => {
    if (nextCount < minCount || nextCount > maxCount || nextCount === count) return;
    const compatible = COLLAGE_LAYOUTS.filter((layout) => nextCount >= layout.minSlots && nextCount <= layout.maxSlots && (layout.aspect as readonly string[]).includes(aspect) && ALLOWED_COMBOS.some((combo) => combo.layoutId === layout.id));
    if (!compatible.length) return;
    const layout = compatible.find((candidate) => candidate.id === clip.spec.layoutId) ?? compatible.find((candidate) => COLLAGE_GRID_VARIANTS.some((variant) => variant.id === candidate.id)) ?? compatible[0]!;
    const allowedMotions = ALLOWED_COMBOS.filter((combo) => combo.layoutId === layout.id).map((combo) => combo.motionId);
    const motionId = allowedMotions.includes(clip.spec.motionId) ? clip.spec.motionId : allowedMotions[0]!;
    const slots = clip.spec.slots.slice(0, nextCount);
    const usedIds = new Set(slots.map((slot) => slot.slotId));
    for (let index = slots.length; index < nextCount; index++) {
      let id = `empty:${clip.clipId}:${index + 1}`;
      while (usedIds.has(id)) id = `${id}-next`;
      usedIds.add(id);
      slots.push({ slotId: id, kind: "photo", empty: true });
    }
    onApply({ op: "setCollageSpec", clipId: clip.clipId, spec: { ...clip.spec, layoutId: layout.id, motionId, slots } });
  };
  const handleTouchStart = (event: any) => { touchY.current = event.nativeEvent?.pageY ?? event.touches?.[0]?.clientY ?? null; };
  const handleTouchEnd = (event: any) => {
    const y = event.nativeEvent?.pageY ?? event.changedTouches?.[0]?.clientY;
    if (touchY.current !== null && typeof y === "number" && y - touchY.current > 55) onClose();
    touchY.current = null;
  };

  return <View className="absolute inset-0 z-20 justify-end bg-black/10">
    <View className="max-h-[50%] rounded-t-[24px] bg-[#111d26] px-4 pb-5 pt-2">
      <View accessibilityRole="adjustable" accessibilityLabel="Drag down to close layout drawer" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} className="mb-2 h-5 items-center justify-center">
        <View className="h-1 w-9 rounded-full bg-[#526574]" />
      </View>
      <View className="mb-2 flex-row items-center justify-between border-b border-[#293a45] pb-3">
        <Text className="font-sans-semibold text-[16px] tracking-[2px] text-on-screen">{section}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close collage" onPress={onClose} className="size-9 items-center justify-center">
          <Text className="font-sans-semibold text-[24px] text-on-screen">✓</Text>
        </Pressable>
      </View>
      {section === "Layout" ? <>
        <View className="mb-3 h-9 flex-row items-center justify-between border-b border-[#293a45] pb-2">
          <Text className="font-sans text-caption text-[#a9b7c2]">Number of photos</Text>
          <View className="flex-row items-center gap-3">
            <Pressable accessibilityRole="button" accessibilityLabel="Decrease number of photos" disabled={count <= minCount} onPress={() => setPhotoCount(count - 1)} className="size-9 items-center justify-center rounded-full bg-[#202a32] disabled:opacity-40"><Text className="text-[20px] text-on-screen">−</Text></Pressable>
            <Text accessibilityLabel={`${count} photos`} className="min-w-[16px] text-center font-sans-semibold text-button text-on-screen">{count}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Increase number of photos" disabled={count >= maxCount} onPress={() => setPhotoCount(count + 1)} className="size-9 items-center justify-center rounded-full bg-[#202a32] disabled:opacity-40"><Text className="text-[20px] text-on-screen">+</Text></Pressable>
          </View>
        </View>
        <View className="mb-3 flex-row gap-3">
          {(["Layouts", "Styles"] as const).map((tab) => <Pressable key={tab} accessibilityRole="button" accessibilityLabel={`Collage ${tab}`} aria-pressed={category === tab} onPress={() => setCategory(tab)} className={`min-h-9 flex-1 items-center justify-center rounded-lg ${category === tab ? "bg-[#29443f]" : "bg-[#202a32]"}`}><Text className="font-sans-semibold text-caption text-on-screen">{tab}</Text></Pressable>)}
        </View>
        {category === "Styles" && LIBRARY_IDS.has(layoutId) ? <View className="mb-3"><Text className="mb-1 font-sans text-[11px] text-on-screen-muted">Animation</Text><ScrollView horizontal contentContainerClassName="gap-2">{motionOptions.map((motion) => <Pressable key={motion.id} accessibilityRole="button" accessibilityLabel={`Motion ${motion.label}`} aria-pressed={motionId === motion.id} onPress={() => onApply({ op: "setCollageMotion", clipId: clip.clipId, motionId: motion.id })} className={`min-h-8 rounded-full border px-3 justify-center ${motionId === motion.id ? "border-white bg-[#263744]" : "border-[#526574]"}`}><Text className="font-sans text-[11px] text-on-screen">{motion.label}</Text></Pressable>)}</ScrollView></View> : null}
        {category === "Styles" && !layoutOptions.some((layout) => LIBRARY_IDS.has(layout.id)) ? <Text className="py-4 font-sans text-caption text-on-screen-muted">These styles need at least 3 photos. Tap + above to add a photo slot.</Text> : null}
        <ScrollView className="min-h-0" contentContainerClassName="flex-row flex-wrap gap-2 pb-1">
          {visibleLayouts.map((layout) => <Pressable key={layout.id} accessibilityRole="button" accessibilityLabel={`Layout ${layout.label}`} aria-pressed={layoutId === layout.id} disabled={count < layout.minSlots || count > layout.maxSlots} accessibilityHint={count < layout.minSlots || count > layout.maxSlots ? `Requires ${layout.minSlots} to ${layout.maxSlots} photos. Adjust number of photos above.` : undefined} onPress={() => chooseLayout(layout.id)} className={`h-[118px] w-[31%] rounded-[14px] bg-[#050a0e] p-2 ${layoutId === layout.id ? "border-2 border-white" : "border-2 border-transparent"}`}>
            <View className="relative flex-1 overflow-hidden rounded-md bg-[#101920]">
              {LIBRARY_IDS.has(layout.id) ? <Image accessibilityLabel={`${layout.label} style preview`} source={demoImage(`collage-${layout.id}${aspect === "16:9" && ["botanical-scrapbook", "nine-photo-grid", "travel-mosaic", "travel-story"].includes(layout.id) ? "-wide" : ""}`)} resizeMode="cover" className="h-full w-full" /> : thumbnailRects(layout.id, count).map(({ x, y, w, h }, i) => <View key={i} className="absolute rounded-[3px] bg-[#71879a]" style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }} />)}
            </View>
            <Text numberOfLines={1} className="mt-1 text-center font-sans text-[9px] text-[#c4cfd6]">{layout.label}</Text>
            {category === "Styles" ? <Text className="text-center font-sans text-[9px] text-on-screen-muted">{layout.minSlots}–{layout.maxSlots} photos{count < layout.minSlots || count > layout.maxSlots ? " · add or remove slots" : ""}</Text> : null}
          </Pressable>)}
        </ScrollView>
      </> : <>
        <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Motion</Text>
        <View className="flex-row flex-wrap gap-2">{motionOptions.map((motion) => <Pressable key={motion.id} accessibilityRole="button" accessibilityLabel={`Motion ${motion.label}`} aria-pressed={motionId === motion.id} onPress={() => { setSelection({ clipId: clip.clipId, baseLayoutId: clip.spec.layoutId, baseMotionId: clip.spec.motionId, layoutId, motionId: motion.id }); onApply({ op: "setCollageMotion", clipId: clip.clipId, motionId: motion.id }); }} className={`rounded-full border px-3 py-2 ${motionId === motion.id ? "border-white bg-[#263744]" : "border-[#526574]"}`}><Text className="font-sans text-caption text-on-screen">{motion.label}</Text></Pressable>)}</View>
      </>}
    </View>
  </View>;
}
