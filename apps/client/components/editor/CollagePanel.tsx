import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { reassignCollageSlots, type Moment } from "@mosae/core";
import { COLLAGE_GRID_VARIANTS, COLLAGE_LAYOUTS, COLLAGE_MOTIONS, ALLOWED_COMBOS, collageGridRects, type CollageGridVariant, type EditOp, type Timeline } from "@mosae/contracts";

const SIMPLE_LAYOUTS = COLLAGE_GRID_VARIANTS.filter(({ id }) => id.startsWith("simple-"));
const DESIGNED_LAYOUT_IDS = ["botanical-scrapbook", "nine-photo-grid", "travel-mosaic", "travel-story", "photo-table", "torn-paper", "polaroid-garland", "postcard-stack", "route-map"] as const;
const DESIGN_LAYOUTS = COLLAGE_LAYOUTS.filter(({ id }) => DESIGNED_LAYOUT_IDS.includes(id as typeof DESIGNED_LAYOUT_IDS[number]) && ALLOWED_COMBOS.some((combo) => combo.layoutId === id));
export function collageOptionsForPhotoCount(count: number, aspect?: Timeline["aspect"]) {
  return {
    simple: SIMPLE_LAYOUTS.filter(({ id }) => COLLAGE_LAYOUTS.find((layout) => layout.id === id)?.preferredSlots === count),
    designs: DESIGN_LAYOUTS.filter(({ minSlots, maxSlots, aspect: supportedAspects }) => minSlots <= count && count <= maxSlots && (!aspect || (supportedAspects as readonly string[]).includes(aspect))),
  };
}
export function nearestCollageOption(layoutId: string, count: number): string {
  const legacyDesigns: Record<string, string> = { "design-polaroid": "polaroid-garland", "design-magazine": "travel-story", "design-film-strip": "postcard-stack" };
  if (legacyDesigns[layoutId]) {
    if (count < 3) return count === 1 ? "simple-full" : "simple-stacked";
    if (count > 5 && layoutId !== "design-magazine") return "botanical-scrapbook";
    return legacyDesigns[layoutId]!;
  }
  if (layoutId.startsWith("simple-")) return layoutId;
  if (DESIGN_LAYOUTS.some(({ id }) => id === layoutId) && COLLAGE_LAYOUTS.some(({ id, minSlots, maxSlots }) => id === layoutId && minSlots <= count && count <= maxSlots)) return layoutId;
  if (["single-photo"].includes(layoutId) && count === 1) return "simple-full";
  if (layoutId === "two-photo-diptych" && count === 2) return "simple-stacked";
  if (layoutId === "grid-wide-top" && count === 3) return "simple-three-top";
  if (layoutId === "grid-wide-bottom" && count === 3) return "simple-three-bottom";
  if (layoutId === "grid-stacked-rows" && count === 3) return "simple-three-stacked";
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
  const gridVariant = COLLAGE_GRID_VARIANTS.find((variant) => variant.id === layoutId)?.id;
  if (gridVariant) return collageGridRects(gridVariant, count);
  if (layoutId === "travel-story" && count === 5) return [{ x: 0, y: 0, w: 65, h: 32 }, { x: 67, y: 0, w: 33, h: 66 }, { x: 0, y: 34, w: 32, h: 66 }, { x: 34, y: 34, w: 32, h: 32 }, { x: 34, y: 68, w: 66, h: 32 }];
  if (layoutId === "travel-mosaic" && count === 8) return [{ x: 0, y: 0, w: 24, h: 32 }, { x: 25.5, y: 0, w: 24, h: 32 }, { x: 51, y: 0, w: 49, h: 32 }, { x: 0, y: 33.5, w: 49.5, h: 32 }, { x: 82, y: 33.5, w: 18, h: 32 }, { x: 0, y: 67, w: 24, h: 33 }, { x: 25.5, y: 67, w: 24, h: 33 }, { x: 51, y: 67, w: 49, h: 33 }];
  if (layoutId === "botanical-scrapbook" && count >= 3) return count <= 4
    ? [{ x: 10, y: 10, w: 39, h: 43 }, { x: 47, y: 10, w: 41, h: 39 }, { x: 10, y: 55, w: 38.5, h: 34 }, { x: 50, y: 47.5, w: 38, h: 40 }].slice(0, count)
    : Array.from({ length: count }, (_, index) => ({ x: 10 + index % 2 * 40, y: 9 + Math.floor(index / 2) * 25, w: 39, h: 25 }));
  const designedPositions: Record<string, number[][]> = {
    "photo-table": [[33,25,43],[67,25,42],[34,51,41],[68,51,40],[34,77,41],[68,77,40]],
    "torn-paper": [[34,28,49],[69,43,48],[34,68,50],[68,79,44],[52,51,42]],
    "polaroid-garland": [[32,28,52],[68,35,52],[32,64,53],[68,69,52],[50,51,51]],
    "postcard-stack": [[48,20,68],[39,40,64],[62,51,62],[49,67,61],[50,57,58]],
    "route-map": [[28,28,47],[72,43,47],[33,66,46],[72,78,42],[52,52,41]],
  };
  if (designedPositions[layoutId]) return designedPositions[layoutId]!.slice(0, count).map(([cx, cy, width]) => ({ x: cx! - width! / 2, y: cy! - width! * .77 * .56 / 2, w: width!, h: width! * .77 * .56 }));
  if (layoutId === "travel-mosaic" && count >= 3) {
    const total = count + 1, columns = total === 9 ? 3 : Math.min(3, Math.ceil(Math.sqrt(total))), rows = Math.ceil(total / columns), gap = 2;
    const titleOrder = Math.floor(total / 2), rowH = (100 - gap * (rows - 1)) / rows;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    for (let row = 0, next = 0; row < rows; row++) {
      const rowCount = Math.min(columns, total - row * columns), cellW = (100 - gap * (rowCount - 1)) / rowCount;
      for (let col = 0; col < rowCount; col++, next++) if (next !== titleOrder) rects.push({ x: col * (cellW + gap), y: row * (rowH + gap), w: cellW, h: rowH });
    }
    return rects;
  }
  if (layoutId === "nine-photo-grid") {
    const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns), margin = 5.1, gap = 2.3, cellH = (100 - margin * 2 - gap * (rows - 1)) / rows;
    return Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / columns), rowCount = Math.min(columns, count - row * columns), cellW = (100 - margin * 2 - gap * (rowCount - 1)) / rowCount;
      return { x: margin + index % columns * (cellW + gap), y: margin + row * (cellH + gap), w: cellW, h: cellH };
    });
  }
  const columns = Math.min(3, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const gap = 3;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const rowCount = Math.min(columns, count - row * columns);
    return { x: col * (100 + gap) / rowCount, y: row * (100 + gap) / rows, w: (100 - gap * (rowCount - 1)) / rowCount, h: (100 - gap * (rows - 1)) / rows };
  });
}

function thumbnailTitleRect(layoutId: string, count: number): { x: number; y: number; w: number; h: number } | null {
  if (layoutId === "travel-mosaic" && count === 8) return { x: 51, y: 33.5, w: 29.5, h: 32 };
  if (layoutId !== "travel-mosaic" || count < 3) return null;
  const total = count + 1, columns = total === 9 ? 3 : Math.min(3, Math.ceil(Math.sqrt(total))), rows = Math.ceil(total / columns), gap = 2;
  const index = Math.floor(total / 2), row = Math.floor(index / columns), col = index % columns;
  const rowCount = Math.min(columns, total - row * columns), cellW = (100 - gap * (rowCount - 1)) / rowCount, cellH = (100 - gap * (rows - 1)) / rows;
  return { x: col * (cellW + gap), y: row * (cellH + gap), w: cellW, h: cellH };
}

export function CollagePanel({ clip, section, aspect = "9:16", timeline, moments = [], onApply, onClose }: {
  clip: Collage;
  section: "Layout" | "Motion";
  aspect?: Timeline["aspect"];
  timeline?: Timeline;
  moments?: Moment[];
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
  const options = collageOptionsForPhotoCount(count, aspect);
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
    const usedShots = new Set(clip.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : []));
    const chapterAt = (time: number) => timeline?.chapters.reduce((chapter, item, index) => item.startSec <= time ? index : chapter, 0) ?? 0;
    const currentChapter = chapterAt(clip.startSec);
    const candidateShots = new Set<string>();
    const candidates = moments.filter((moment) => {
      if (moment.kind !== "photo" || !moment.shotId || usedShots.has(moment.shotId) || candidateShots.has(moment.shotId)) return false;
      candidateShots.add(moment.shotId);
      return true;
    }).map((moment) => {
      const occurrences = timeline?.videoClips.flatMap((item) => {
        const time = item.startSec + item.durationSec / 2;
        const shotIds = "kind" in item ? item.spec.slots.flatMap((slot) => slot.shotId ? [slot.shotId] : []) : [item.source.shotId];
        return shotIds.includes(moment.shotId!) ? [{ sameChapter: chapterAt(time) === currentChapter, distance: Math.abs(time - clip.startSec) }] : [];
      }) ?? [];
      const nearest = occurrences.sort((a, b) => Number(b.sameChapter) - Number(a.sameChapter) || a.distance - b.distance)[0];
      return { moment, sameChapter: nearest?.sameChapter ?? false, distance: nearest?.distance ?? Number.POSITIVE_INFINITY };
    }).sort((a, b) => Number(b.sameChapter) - Number(a.sameChapter) || a.distance - b.distance);
    for (let index = slots.length; index < nextCount; index++) {
      let candidate = candidates.shift()?.moment;
      while (candidate?.shotId && usedShots.has(candidate.shotId)) candidate = candidates.shift()?.moment;
      let id = candidate ? `photo:${candidate.shotId}` : `empty:${clip.clipId}:${index + 1}`;
      while (usedIds.has(id)) id = `${id}-next`;
      usedIds.add(id);
      if (candidate?.shotId) {
        usedShots.add(candidate.shotId);
        slots.push({ slotId: id, shotId: candidate.shotId, kind: "photo", ...(candidate.width ? { width: candidate.width } : {}), ...(candidate.height ? { height: candidate.height } : {}) });
      } else slots.push({ slotId: id, kind: "photo", empty: true });
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
          {([ ["Simple", options.simple], ["With designs", options.designs] ] as const).filter(([title, layouts]) => title === "Simple" || layouts.length > 0).map(([sectionTitle, layouts]) => <View key={sectionTitle} className="mb-3">
            <Text className="mb-2 font-sans text-[11px] tracking-[1px] text-[#a9b7c2]">{sectionTitle}</Text>
            <View className="flex-row flex-wrap gap-2">{layouts.map((entry) => {
              const layout = COLLAGE_LAYOUTS.find((candidate) => candidate.id === entry.id)!;
              const simpleRects = thumbnailRects(entry.id, count);
              const titleRect = thumbnailTitleRect(entry.id, count);
              const current = nearestCollageOption(layoutId, count);
              const designed = !entry.id.startsWith("simple-");
              const paper = entry.id === "polaroid-garland" || entry.id === "postcard-stack";
              return <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`Layout ${entry.label}`} aria-pressed={current === entry.id} onPress={() => chooseLayout(entry.id as typeof COLLAGE_LAYOUTS[number]["id"])} className={`h-[118px] w-[31%] rounded-[14px] bg-[#050a0e] p-2 ${current === entry.id ? "border-2 border-white" : "border-2 border-transparent"}`}>
                <View className={`relative flex-1 overflow-hidden rounded-md ${entry.id === "route-map" ? "bg-[#d6d8c7]" : entry.id === "botanical-scrapbook" ? "bg-[#e7c9a8]" : entry.id === "photo-table" ? "bg-[#795638]" : entry.id === "torn-paper" || entry.id === "postcard-stack" ? "bg-[#eee3cc]" : entry.id === "polaroid-garland" ? "bg-[#b7c7bf]" : "bg-[#20252a]"}`}>
                  {simpleRects.map(({ x, y, w, h }, i) => <View key={i} className={`absolute rounded-[3px] ${paper ? "border-[2px] border-b-[5px] border-[#f6f2e6] bg-[#71879a]" : entry.id === "torn-paper" ? "border-2 border-[#efe5d0] bg-[#9d765b]" : entry.id === "botanical-scrapbook" ? "border border-[#d1c79c] bg-[#778967]" : "border border-white bg-[#71879a]"}`} style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, transform: paper ? `rotate(${i % 2 ? 4 : -4}deg)` : undefined }} />)}
                  {titleRect ? <View className="absolute items-center justify-center bg-[#201d20]" style={{ left: `${titleRect.x}%`, top: `${titleRect.y}%`, width: `${titleRect.w}%`, height: `${titleRect.h}%` }}><View className="h-[2px] w-2/3 bg-[#d8cbb9]" /></View> : null}
                  {entry.id === "route-map" ? <View className="absolute left-[14%] top-[48%] h-[35%] w-[52%] border-b-2 border-dashed border-[#a34e36]" /> : null}
                  {entry.id === "postcard-stack" ? <View className="absolute right-[5%] top-[5%] h-[15%] w-[18%] border border-[#b88852]" /> : null}
                  {designed && entry.id === "photo-table" ? <View className="absolute inset-0 border-[5px] border-[#8e7959]" /> : null}
                  {entry.id === "botanical-scrapbook" ? <><View className="absolute left-[7%] top-[55%] h-[16%] w-[5%] rotate-[-16deg] rounded-full bg-[#bda269]"/><View className="absolute left-[37%] top-[24%] h-[27%] w-[2%] rotate-[-11deg] bg-[#84935f]"/><View className="absolute left-[41%] top-[9%] h-[4%] w-[14%] rotate-[-8deg] bg-[#c8ab74]"/><View className="absolute left-[49%] top-[81%] h-[9%] w-[43%] rotate-[2deg] bg-[#b18a61]"/></> : null}
                  {entry.id === "polaroid-garland" ? <View className="absolute left-0 top-[24%] h-[4%] w-full border-t border-dashed border-[#f3e7cf]" /> : null}
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
