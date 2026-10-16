import { COLLAGE_GRID_VARIANTS } from "./collage.js";

export type CollageGridVariant = typeof COLLAGE_GRID_VARIANTS[number]["id"];
export type CollageAspect = "9:16" | "16:9";
export type CollageGridRect = { x: number; y: number; w: number; h: number };
const r = (x: number, y: number, w: number, h: number): CollageGridRect => ({ x, y, w, h });

const COUNT_LAYOUTS: Record<CollageAspect, readonly CollageGridVariant[]> = {
  "9:16": ["simple-full", "simple-stacked", "simple-three-stacked", "simple-grid-2x2", "simple-five-top", "simple-grid-2x3"],
  "16:9": ["simple-full", "simple-offset", "simple-three-top", "simple-grid-2x2", "simple-five-middle", "simple-grid-2x3"],
};

/** The safe, count-matched default layout for a frame orientation. */
export function collageLayoutForCount(count: number, aspect: CollageAspect): CollageGridVariant {
  if (!Number.isInteger(count) || count < 1 || count > 6) throw new RangeError("default collage layout supports 1–6 photos");
  return COUNT_LAYOUTS[aspect][count - 1]!;
}

const threePhoto: Partial<Record<CollageGridVariant, CollageGridRect[]>> = {
  "grid-wide-top": [r(0, 0, 100, 49), r(0, 51, 49, 49), r(51, 51, 49, 49)],
  "grid-wide-bottom": [r(0, 0, 49, 49), r(51, 0, 49, 49), r(0, 51, 100, 49)],
  "grid-stacked-rows": [r(0, 0, 100, 32), r(0, 34, 100, 32), r(0, 68, 100, 32)],
  "grid-tall-left": [r(0, 0, 49, 100), r(51, 0, 49, 49), r(51, 51, 49, 49)],
  "grid-tall-right": [r(0, 0, 49, 49), r(0, 51, 49, 49), r(51, 0, 49, 100)],
  "grid-three-columns": [r(0, 0, 32, 100), r(34, 0, 32, 100), r(68, 0, 32, 100)],
};

const twoPhoto: Partial<Record<CollageGridVariant, CollageGridRect[]>> = {
  "grid-wide-top": [r(0, 0, 100, 60), r(0, 62, 100, 38)],
  "grid-wide-bottom": [r(0, 0, 100, 38), r(0, 40, 100, 60)],
  "grid-stacked-rows": [r(0, 0, 100, 49), r(0, 51, 100, 49)],
  "grid-tall-left": [r(0, 0, 60, 100), r(62, 0, 38, 100)],
  "grid-tall-right": [r(0, 0, 38, 100), r(40, 0, 60, 100)],
  "grid-three-columns": [r(0, 0, 49, 100), r(51, 0, 49, 100)],
};

const fourPhoto: Partial<Record<CollageGridVariant, CollageGridRect[]>> = {
  "grid-wide-top": [r(0, 0, 100, 49), r(0, 51, 32, 49), r(34, 51, 32, 49), r(68, 51, 32, 49)],
  "grid-wide-bottom": [r(0, 0, 32, 49), r(34, 0, 32, 49), r(68, 0, 32, 49), r(0, 51, 100, 49)],
  "grid-stacked-rows": [r(0, 0, 100, 23.5), r(0, 25.5, 100, 23.5), r(0, 51, 100, 23.5), r(0, 76.5, 100, 23.5)],
  "grid-tall-left": [r(0, 0, 49, 100), r(51, 0, 49, 32), r(51, 34, 49, 32), r(51, 68, 49, 32)],
  "grid-tall-right": [r(0, 0, 49, 32), r(0, 34, 49, 32), r(0, 68, 49, 32), r(51, 0, 49, 100)],
  "grid-three-columns": [r(0, 0, 49, 49), r(51, 0, 49, 49), r(0, 51, 49, 49), r(51, 51, 49, 49)],
};

function splitLargest(rects: CollageGridRect[], variant: CollageGridVariant): CollageGridRect[] {
  const index = rects.reduce((best, item, i) => item.w * item.h > rects[best]!.w * rects[best]!.h ? i : best, 0);
  const target = rects[index]!;
  const gap = 2;
  const horizontal = variant === "grid-wide-top" || variant === "grid-wide-bottom" || variant === "grid-stacked-rows"
    ? target.w >= target.h
    : variant === "grid-tall-left" || variant === "grid-tall-right" ? target.h >= target.w : target.w >= target.h;
  const first = { ...target };
  const second = { ...target };
  if (horizontal) {
    first.w = (target.w - gap) / 2;
    second.x += first.w + gap;
    second.w = first.w;
  } else {
    first.h = (target.h - gap) / 2;
    second.y += first.h + gap;
    second.h = first.h;
  }
  return rects.flatMap((item, i) => i === index ? [first, second] : [item]);
}

/** Normalized, non-overlapping photo rectangles shared by the drawer and renderer. */
export function collageGridRects(variant: CollageGridVariant, count: number, aspect?: CollageAspect): CollageGridRect[] {
  if (!Number.isInteger(count) || count < 1 || count > 9) throw new RangeError("grid photo count must be 1–9");
  if (aspect === "16:9") {
    if (variant === "simple-stacked" && count === 2) return [r(0, 0, 49, 100), r(51, 0, 49, 100)];
    if (variant === "simple-offset" && count === 2) return [r(0, 0, 49, 100), r(51, 0, 49, 100)];
    if (variant === "simple-three-stacked" && count === 3) return [r(0, 0, 60, 100), r(62, 0, 38, 49), r(62, 51, 38, 49)];
    if (variant === "simple-five-middle" && count === 5) return [r(0, 0, 49, 48), r(51, 0, 49, 48), r(0, 50, 32, 50), r(34, 50, 32, 50), r(68, 50, 32, 50)];
    if (variant === "simple-grid-2x3" && count === 6) return [r(0, 0, 32, 49), r(34, 0, 32, 49), r(68, 0, 32, 49), r(0, 51, 32, 49), r(34, 51, 32, 49), r(68, 51, 32, 49)];
  }
  const simple: Record<string, CollageGridRect[]> = {
    "simple-full": [r(0, 0, 100, 100)], "simple-centered": [r(12, 24, 76, 52)],
    "simple-stacked": [r(0, 0, 100, 49), r(0, 51, 100, 49)],
    "simple-offset": [r(0, 0, 48, 48), r(52, 52, 48, 48)],
    "simple-three-stacked": [r(0, 0, 100, 32), r(0, 34, 100, 32), r(0, 68, 100, 32)],
    "simple-three-top": [r(0, 0, 100, 56), r(0, 58, 49, 42), r(51, 58, 49, 42)],
    "simple-three-bottom": [r(0, 0, 49, 42), r(51, 0, 49, 42), r(0, 44, 100, 56)],
    "simple-grid-2x2": [r(0, 0, 49, 49), r(51, 0, 49, 49), r(0, 51, 49, 49), r(51, 51, 49, 49)],
    "simple-five-top": [r(0, 0, 100, 44), r(0, 46, 49, 26), r(51, 46, 49, 26), r(0, 74, 49, 26), r(51, 74, 49, 26)],
    "simple-five-middle": [r(0, 0, 49, 25), r(51, 0, 49, 25), r(0, 27, 100, 46), r(0, 75, 49, 25), r(51, 75, 49, 25)],
    "simple-five-bottom": [r(0, 0, 49, 25), r(51, 0, 49, 25), r(0, 27, 49, 25), r(51, 27, 49, 25), r(0, 54, 100, 46)],
    "simple-grid-2x3": [r(0, 0, 49, 32), r(51, 0, 49, 32), r(0, 34, 49, 32), r(51, 34, 49, 32), r(0, 68, 49, 32), r(51, 68, 49, 32)],
  };
  if (simple[variant]) return simple[variant]!.slice(0, count).map((item) => ({ ...item }));
  if (count === 1) return [r(0, 0, 100, 100)];
  if (count === 2) return twoPhoto[variant]!.map((item) => ({ ...item }));
  if (count === 3) return threePhoto[variant]!.map((item) => ({ ...item }));
  const rects = fourPhoto[variant]!.map((item) => ({ ...item }));
  while (rects.length < count) splitLargest(rects, variant).forEach((item, i) => { rects[i] = item; });
  return rects;
}

/** Slot aspect ratios in rendered pixels (width / height), including the film frame shape. */
export function collageSlotAspects(layoutId: string, variant: string, slotCount: number, frameAspect: number): number[] {
  if (!(frameAspect > 0) || !Number.isInteger(slotCount) || slotCount < 1) return [];
  if ((COLLAGE_GRID_VARIANTS as readonly { id: string }[]).some((item) => item.id === variant)) {
    return collageGridRects(variant as CollageGridVariant, slotCount, frameAspect > 1 ? "16:9" : "9:16").map((rect) => frameAspect * rect.w / rect.h);
  }
  const wide = frameAspect > 1;
  let cells: Array<{ w: number; h: number }>;
  if (layoutId === "travel-story" && slotCount === 5) cells = wide
    ? [{w:49,h:32},{w:49.5,h:65.5},{w:24,h:66.5},{w:23.5,h:32},{w:74.5,h:33}]
    : [{w:65.5,h:32},{w:33,h:65.5},{w:32,h:66.5},{w:32,h:32},{w:66.5,h:33}];
  else if (layoutId === "travel-mosaic" && slotCount === 8) cells = [{w:24,h:32},{w:24,h:32},{w:49,h:32},{w:49.5,h:32},{w:18,h:32},{w:24,h:33},{w:24,h:33},{w:49,h:33}];
  else if (layoutId === "botanical-scrapbook") cells = slotCount <= 4 ? [{w:39,h:43},{w:41,h:39},{w:38.5,h:34},{w:38,h:40}].slice(0, slotCount) : Array.from({length:slotCount},()=>({w:39,h:25}));
  else if (["photo-table","torn-paper","polaroid-garland","postcard-stack","route-map"].includes(layoutId)) return Array.from({length:slotCount},()=>frameAspect/(0.77*(wide?0.73:0.56)));
  else {
    const total = slotCount + Number(layoutId === "travel-mosaic");
    const columns = total === 9 ? 3 : wide ? Math.min(4, Math.ceil(total / 2)) : Math.min(3, Math.ceil(Math.sqrt(total)));
    const rows = Math.ceil(total / columns);
    const titleOrder = layoutId === "travel-mosaic" ? Math.floor(total / 2) : -1;
    return Array.from({length:slotCount},(_,i)=> {
      const order = titleOrder >= 0 && i >= titleOrder ? i + 1 : i;
      const row = Math.floor(order / columns), rowCount = Math.min(columns,total-row*columns);
      return frameAspect*((100-2*(rowCount-1))/rowCount)/((100-2*(rows-1))/rows);
    });
  }
  return cells.map(cell=>frameAspect*cell.w/cell.h);
}

/** Minimum total log-aspect mismatch; source order breaks equal-cost ties. */
export function assignCollageSlots(sourceAspects: number[], slotAspects: number[]): number[] {
  const n=Math.min(sourceAspects.length,slotAspects.length);
  const memo=new Map<string,{cost:number; slots:number[]}>();
  const solve=(sourceIndex:number,mask:number):{cost:number;slots:number[]}=>{
    if(sourceIndex>=n)return {cost:0,slots:[]};
    const key=`${sourceIndex}:${mask}`,cached=memo.get(key);if(cached)return cached;
    let best={cost:Infinity,slots:[] as number[]};
    for(let slotIndex=0;slotIndex<n;slotIndex++)if(!(mask&(1<<slotIndex))){
      const next=solve(sourceIndex+1,mask|(1<<slotIndex));
      const cost=Math.abs(Math.log(sourceAspects[sourceIndex]!/slotAspects[slotIndex]!))+next.cost;
      if(cost<best.cost-1e-12)best={cost,slots:[slotIndex,...next.slots]};
    }
    memo.set(key,best);return best;
  };
  const result=solve(0,0).slots;
  return [...result,...Array.from({length:sourceAspects.length-n},(_,index)=>n+index)];
}
