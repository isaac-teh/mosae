import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { reassignCollageSlots } from "@mosae/core";
import { COLLAGE_GRID_VARIANTS, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, ALLOWED_COMBOS, collageDesignRects, collageGridRects, type CollageGridVariant, type EditOp, type Timeline } from "@mosae/contracts";

const SIMPLE_LAYOUTS = COLLAGE_GRID_VARIANTS.filter(({ id }) => id.startsWith("simple-"));
const DESIGN_LAYOUTS = COLLAGE_LAYOUTS.filter(({ id }) => id.startsWith("design-"));
export function collageOptionsForPhotoCount(count: number) {
  return { simple: SIMPLE_LAYOUTS.filter(({ id }) => COLLAGE_LAYOUTS.find((layout) => layout.id === id)?.preferredSlots === count), designs: DESIGN_LAYOUTS };
}
export function nearestCollageOption(layoutId: string, count: number): string {
  if (layoutId.startsWith("simple-") || layoutId.startsWith("design-")) return layoutId;
  if (["polaroid-garland", "postcard-stack", "photo-table", "torn-paper", "route-map", "botanical-scrapbook"].includes(layoutId)) return "design-polaroid";
  if (["travel-story", "travel-mosaic"].includes(layoutId)) return "design-magazine";
  if (["single-photo"].includes(layoutId) && count === 1) return "simple-full";
  if (layoutId === "two-photo-diptych" && count === 2) return "simple-stacked";
  if (layoutId === "grid-wide-top" && count === 3) return "simple-three-top";
  if (layoutId === "grid-wide-bottom" && count === 3) return "simple-three-bottom";
  if (layoutId === "grid-stacked-rows" && count === 3) return "simple-three-stacked";
  if (layoutId === "nine-photo-grid") return count === 1 ? "simple-full" : count === 2 ? "simple-stacked" : count === 3 ? "simple-three-stacked" : count === 4 ? "simple-grid-2x2" : count === 5 ? "simple-five-top" : "simple-grid-2x3";
  return count === 1 ? "simple-full" : count === 2 ? "simple-stacked" : count === 3 ? "simple-three-stacked" : count === 4 ? "simple-grid-2x2" : count === 5 ? "simple-five-top" : "simple-grid-2x3";
}

type Collage = Extract<Timeline["videoClips"][number], { kind: "collage" }>;
type CollageOp = EditOp | EditOp[];
export type CollageSheetState = "collapsed" | "expanded";

export function transitionCollageSheet(state: CollageSheetState, dragDeltaY?: number): CollageSheetState {
  if (dragDeltaY === undefined) return state === "collapsed" ? "expanded" : "collapsed";
  if (Math.abs(dragDeltaY) < 40) return state;
  return dragDeltaY < 0 ? "expanded" : "collapsed";
}

function thumbnailRects(layoutId: string, count: number): { x: number; y: number; w: number; h: number }[] {
  if (layoutId.startsWith("design-")) return collageDesignRects(layoutId, count);
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
  const [sheetState, setSheetState] = useState<CollageSheetState>("collapsed");
  const touchY = useRef<number | null>(null);
  const suppressHandleClick = useRef(false);
  const isCurrentSelection = selection.clipId === clip.clipId && selection.baseLayoutId === clip.spec.layoutId && selection.baseMotionId === clip.spec.motionId;
  const layoutId = isCurrentSelection ? selection.layoutId : clip.spec.layoutId;
  const motionId = isCurrentSelection ? selection.motionId : clip.spec.motionId;
  const count = clip.spec.slots.length;
  const minCount = 1;
  const maxCount = 6;
  const options = collageOptionsForPhotoCount(count);
  const motionOptions = COLLAGE_MOTIONS.filter((motion) => ALLOWED_COMBOS.some((combo) => combo.layoutId === layoutId && combo.motionId === motion.id));
  const slotsForLayout = (layout: string, slots: Collage["spec"]["slots"]) => {
    const frameAspect = Number(aspect.split(":")[0]) / Number(aspect.split(":")[1]);
    return reassignCollageSlots(slots, layout, frameAspect).map((slot) => {
      if (slot.manualCrop) return slot;
      const { crop: _automaticCrop, ...withoutAutomaticCrop } = slot;
      return withoutAutomaticCrop;
    });
  };
  const chooseLayout = (nextLayoutId: typeof COLLAGE_LAYOUTS[number]["id"]) => {
    const allowedMotions = ALLOWED_COMBOS.filter((combo) => combo.layoutId === nextLayoutId).map((combo) => combo.motionId);
    const nextMotionId = allowedMotions.includes(motionId) ? motionId : allowedMotions[0];
    setSelection({ clipId: clip.clipId, baseLayoutId: clip.spec.layoutId, baseMotionId: clip.spec.motionId, layoutId: nextLayoutId, motionId: nextMotionId });
    const slots = slotsForLayout(nextLayoutId, clip.spec.slots);
    onApply({ op: "setCollageSpec", clipId: clip.clipId, spec: { ...clip.spec, layoutId: nextLayoutId, motionId: nextMotionId, slots } });
  };
  const setPhotoCount = (nextCount: number) => {
    if (nextCount < minCount || nextCount > maxCount || nextCount === count) return;
    const layoutId = nextCount === 1 ? "simple-full" : nextCount === 2 ? "simple-stacked" : nextCount === 3 ? "simple-three-stacked" : nextCount === 4 ? "simple-grid-2x2" : nextCount === 5 ? "simple-five-top" : "simple-grid-2x3";
    const layout = COLLAGE_LAYOUTS.find((candidate) => candidate.id === layoutId)!;
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
    onApply({ op: "setCollageSpec", clipId: clip.clipId, spec: { ...clip.spec, layoutId: layout.id, motionId, slots: slotsForLayout(layout.id, slots) } });
  };
  const handleTouchStart = (event: any) => {
    suppressHandleClick.current = false;
    touchY.current = event.nativeEvent?.pageY ?? event.touches?.[0]?.clientY ?? null;
  };
  const handleTouchEnd = (event: any) => {
    const y = event.nativeEvent?.pageY ?? event.changedTouches?.[0]?.clientY;
    if (touchY.current !== null && typeof y === "number") {
      const deltaY = y - touchY.current;
      if (section === "Layout" && Math.abs(deltaY) >= 40) {
        suppressHandleClick.current = true;
        setTimeout(() => { suppressHandleClick.current = false; }, 0);
        setSheetState((state) => transitionCollageSheet(state, deltaY));
      } else if (section === "Motion" && deltaY > 55) {
        onClose();
      }
    }
    touchY.current = null;
  };
  const toggleFromHandle = () => {
    if (suppressHandleClick.current) { suppressHandleClick.current = false; return; }
    setSheetState((state) => transitionCollageSheet(state));
  };

  return <View className="absolute inset-0 z-20 justify-end bg-black/10">
    <View className={`${section === "Layout" ? `flex flex-col ${sheetState === "expanded" ? "h-[90dvh] max-h-[calc(90dvh-env(safe-area-inset-top))]" : "h-[50dvh]"}` : "max-h-[50%]"} rounded-t-[24px] bg-[#111d26] px-4 pb-5 pt-2`}>
      <Pressable accessibilityRole="button" accessibilityLabel={section === "Layout" ? "Toggle layout drawer" : "Drag down to close layout drawer"} onPress={section === "Layout" ? toggleFromHandle : undefined} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} className={`${section === "Layout" ? "[touch-action:none]" : ""} mb-2 h-5 ${section === "Layout" ? "shrink-0" : ""} items-center justify-center`}>
        <View className="h-1 w-9 rounded-full bg-[#526574]" />
      </Pressable>
      <View onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} className={`${section === "Layout" ? "[touch-action:none] shrink-0" : ""} mb-2 flex-row items-center justify-between border-b border-[#293a45] pb-3`}>
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
        <ScrollView className="min-h-0 flex-1" contentContainerClassName="pb-2">
          {([ ["Simple", options.simple], ["With designs", options.designs] ] as const).map(([sectionTitle, layouts]) => <View key={sectionTitle} className="mb-3">
            <Text className="mb-2 font-sans text-[11px] tracking-[1px] text-[#a9b7c2]">{sectionTitle}</Text>
            <View className="flex-row flex-wrap gap-2">{layouts.map((entry) => {
              const layout = COLLAGE_LAYOUTS.find((candidate) => candidate.id === entry.id)!;
              const current = nearestCollageOption(layoutId, count);
              const simpleRects = thumbnailRects(entry.id, count);
              return <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`Layout ${entry.label}`} aria-pressed={current === entry.id} onPress={() => chooseLayout(entry.id as typeof COLLAGE_LAYOUTS[number]["id"])} className={`h-[118px] w-[31%] rounded-[14px] bg-[#050a0e] p-2 ${current === entry.id ? "border-2 border-white" : "border-2 border-transparent"}`}>
                <View className={`relative flex-1 overflow-hidden rounded-md ${entry.id === "design-polaroid" ? "bg-[#20384b]" : entry.id === "design-film-strip" ? "bg-[#1f252a]" : "bg-[#20252a]"}`}>
                  {simpleRects.map(({ x, y, w, h }, i) => <View key={i} className={`absolute rounded-[3px] ${entry.id === "design-polaroid" ? "border-[3px] border-b-[9px] border-[#f6f5ef] bg-[#71879a]" : entry.id === "design-film-strip" ? "bg-[#71879a]" : "border border-white bg-[#71879a]"}`} style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, transform: entry.id === "design-polaroid" ? `rotate(${(i % 2 ? 8 : -8)}deg)` : undefined }} />)}
                  {entry.id === "design-magazine" ? <View className="absolute left-[12%] top-[8%] h-[4%] w-[60%] bg-[#cbd3d8]" /> : null}
                  {entry.id === "design-film-strip" ? <><View className="absolute inset-y-0 left-[5%] w-[5%] border-l-2 border-dashed border-[#526574]"/><View className="absolute inset-y-0 right-[5%] w-[5%] border-r-2 border-dashed border-[#526574]"/></> : null}
                </View>
                <Text numberOfLines={1} className="mt-1 text-center font-sans text-[9px] text-[#c4cfd6]">{layout.label}</Text>
              </Pressable>;
            })}</View>
          </View>)}
        </ScrollView>
      </> : <>
        <Text className="mb-2 font-sans-semibold text-caption text-on-screen">Motion</Text>
        <View className="flex-row flex-wrap gap-2">{motionOptions.map((motion) => <Pressable key={motion.id} accessibilityRole="button" accessibilityLabel={`Motion ${motion.label}`} aria-pressed={motionId === motion.id} onPress={() => { setSelection({ clipId: clip.clipId, baseLayoutId: clip.spec.layoutId, baseMotionId: clip.spec.motionId, layoutId, motionId: motion.id }); onApply({ op: "setCollageMotion", clipId: clip.clipId, motionId: motion.id }); }} className={`rounded-full border px-3 py-2 ${motionId === motion.id ? "border-white bg-[#263744]" : "border-[#526574]"}`}><Text className="font-sans text-caption text-on-screen">{motion.label}</Text></Pressable>)}</View>
      </>}
    </View>
  </View>;
}
