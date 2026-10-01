import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { Timeline } from "@mosae/contracts";
import { reorderSlots } from "@mosae/core";
import { DEFAULT_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND, MIN_PIXELS_PER_SECOND, timeToX, timelineContentWidth, xToTime } from "./timelineScale";

const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const shotId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.spec.slots[0]?.shotId : clip.source.shotId;
const secondsLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

type TimelineRowsProps = {
  timeline: Timeline;
  sources: Record<string, string>;
  selectedClipId: string | null;
  soundtrackName: string | null;
  pixelsPerSecond: number;
  leadingPadding: number;
  contentWidth: number;
  onSelect: (clipId: string, startSec: number) => void;
  onTrimPointerDown: (clip: Timeline["videoClips"][number], edge: "start" | "end", event: any) => void;
  onTrimPointerMove: (event: any) => void;
  onTrimPointerUp: (event: any, commit: boolean) => void;
  trimDraft: { clipId: string; edge: "start" | "end"; deltaSec: number } | null;
  onDeselect: () => void;
  onSlotPointerDown: (clip: Timeline["videoClips"][number], index: number, event: any) => void;
  onSlotPointerMove: (event: any) => void;
  onSlotPointerUp: (event: any, commit: boolean) => void;
  reorderPreview: { clipId: string; toIndex: number; pointerContentX: number } | null;
  onSoundtrack: () => void;
};

const TimelineRows = memo(function TimelineRows({ timeline, sources, selectedClipId, soundtrackName, pixelsPerSecond, leadingPadding, contentWidth, onSelect, onTrimPointerDown, onTrimPointerMove, onTrimPointerUp, trimDraft, onDeselect, onSlotPointerDown, onSlotPointerMove, onSlotPointerUp, reorderPreview, onSoundtrack }: TimelineRowsProps) {
  const music = timeline.audioClips.find((clip) => clip.role === "music" && clip.source.kind === "soundtrack");
  const musicDuration = music ? music.source.sourceOutSec - music.source.sourceInSec : 0;
  const tickSeconds = Array.from({ length: Math.floor(timeline.durationSec) + 1 }, (_, second) => second);
  return <View style={{ width: contentWidth }}>
    <View accessibilityLabel="Timeline ruler" className="relative h-[27px]">
      {tickSeconds.map((second) => <React.Fragment key={second}>
        <View accessibilityLabel={`Timeline ruler tick ${second} seconds`} style={{ position: "absolute", left: timeToX(second, pixelsPerSecond, leadingPadding), top: 0, height: second % 2 === 0 ? 10 : 5, width: 1, backgroundColor: second % 2 === 0 ? "#82909A" : "#52616B" }} />
        {second % 2 === 0 ? <Text accessibilityLabel={`Timeline ruler label ${secondsLabel(second)}`} numberOfLines={1} style={{ position: "absolute", left: timeToX(second, pixelsPerSecond, leadingPadding) + 3, top: 8, width: 40 }} className="font-sans text-[10px] text-on-screen-muted">{secondsLabel(second)}</Text> : null}
      </React.Fragment>)}
    </View>
    <View className="relative mt-1 h-[21px]">
      {timeline.chapters.map((chapter, index) => {
        const endSec = chapter.durationSec !== undefined ? chapter.startSec + chapter.durationSec : timeline.chapters[index + 1]?.startSec ?? timeline.durationSec;
        const width = Math.max(0, (endSec - chapter.startSec) * pixelsPerSecond);
        return width > 0 ? <View key={`${chapter.title}-${index}`} accessibilityLabel={`Chapter ${chapter.title}`} style={{ position: "absolute", left: timeToX(chapter.startSec, pixelsPerSecond, leadingPadding), width, height: 21 }}>
          <Text numberOfLines={1} ellipsizeMode="tail" className="font-sans text-caption text-on-screen-muted">{chapter.title}</Text>
        </View> : null;
      })}
    </View>
    <View className="relative mt-1 h-[62px]">
      {selectedClipId ? <Pressable role="button" accessibilityLabel="Deselect selected clip" onPress={onDeselect} style={{ position: "absolute", zIndex: 0, left: 0, right: 0, top: 0, height: 58 }} /> : null}
      {(() => {
        const fromIndex = reorderPreview ? timeline.videoClips.findIndex((clip) => clipId(clip) === reorderPreview.clipId) : -1;
        const displayClips = reorderPreview && fromIndex >= 0 ? reorderSlots(timeline.videoClips, fromIndex, reorderPreview.toIndex) : timeline.videoClips;
        let cursor = 0;
        return displayClips.map((clip, index) => {
        const id = clipId(clip);
        const selected = selectedClipId === id;
        const lifted = reorderPreview?.clipId === id;
        const uri = sources[shotId(clip) ?? ""];
        const delta = trimDraft?.clipId === id ? trimDraft.deltaSec : 0;
        const duration = Math.max(0.5, clip.durationSec + (trimDraft?.clipId === id ? (trimDraft.edge === "start" ? -delta : delta) : 0));
        const start = cursor + (trimDraft?.clipId === id && trimDraft.edge === "start" ? delta : 0);
        cursor = start + duration;
        const makeHandle = (edge: "start" | "end") => <Pressable key={edge} role="button" accessibilityLabel={`Trim ${edge} of clip ${id}`} aria-pressed={selected}
          onPointerDown={(event: any) => onTrimPointerDown(clip, edge, event)} onPointerMove={onTrimPointerMove} onPointerUp={(event: any) => onTrimPointerUp(event, true)} onPointerCancel={(event: any) => onTrimPointerUp(event, false)} data-trim-handle="true"
          style={{ position: "absolute", zIndex: 20, left: edge === "start" ? -6 : undefined, right: edge === "end" ? -6 : undefined, top: 8, height: 42, width: 12, borderRadius: 6, backgroundColor: "#F5C842", borderWidth: 1, borderColor: "#2B2B20", touchAction: "none" }} />;
        const width = Math.max(1, duration * pixelsPerSecond);
        return <View key={id} className="transition-all duration-200" style={{ position: "absolute", zIndex: lifted ? 30 : selected ? 10 : 1, left: lifted && reorderPreview ? reorderPreview.pointerContentX - width / 2 : timeToX(start, pixelsPerSecond, leadingPadding), width, top: 0, height: 58, borderWidth: 2, borderRadius: 7, overflow: "visible", borderColor: selected ? "#F5C842" : "transparent", backgroundColor: index % 2 ? "#294655" : "#E8E2D5", transform: lifted ? [{ scale: 1.04 }] : undefined, boxShadow: lifted ? "0px 8px 22px rgba(0,0,0,0.35)" : undefined, elevation: lifted ? 8 : 0 }}>
          <Pressable role="button" accessibilityLabel={`Select clip ${id}`} aria-pressed={selected} data-timeline-slot="true"
            onPointerDown={(event: any) => onSlotPointerDown(clip, timeline.videoClips.findIndex((item) => clipId(item) === id), event)} onPointerMove={onSlotPointerMove} onPointerUp={(event: any) => onSlotPointerUp(event, true)} onPointerCancel={(event: any) => onSlotPointerUp(event, false)}
            onTouchStart={(event: any) => onSlotPointerDown(clip, timeline.videoClips.findIndex((item) => clipId(item) === id), { ...event.nativeEvent, currentTarget: event.currentTarget, pointerId: 0 })}
            onPress={(event: any) => { event?.stopPropagation?.(); onSelect(id, clip.startSec); }}
            style={{ width: Math.max(1, duration * pixelsPerSecond), height: "100%", overflow: "hidden", borderRadius: 5, backgroundColor: "transparent" }}>
            {uri ? <Image source={{ uri }} resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : null}
            {"kind" in clip ? <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 items-center bg-screen/75"><Text className="font-sans text-[9px] text-on-screen">Collage</Text></View> : null}
          </Pressable>
          {selected ? <>{makeHandle("start")}{makeHandle("end")}</> : null}
        </View>;
      });
      })()}
    </View>
    <View className="relative mt-1 h-[36px]">
      {music ? <Pressable role="button" accessibilityLabel={`Music track ${soundtrackName ?? "Soundtrack"}`} onPress={onSoundtrack}
        style={{ position: "absolute", left: timeToX(music.startSec, pixelsPerSecond, leadingPadding), width: Math.max(1, musicDuration * pixelsPerSecond), height: 32, top: 0 }} className="justify-center overflow-hidden rounded-sm bg-[#2B856C] px-2">
        <Text numberOfLines={1} ellipsizeMode="tail" className="font-sans-medium text-[11px] text-white">♫ {soundtrackName ?? "Soundtrack"}</Text>
      </Pressable> : <Pressable role="button" accessibilityLabel="Open soundtrack picker" onPress={onSoundtrack} style={{ position: "absolute", left: leadingPadding, width: Math.max(1, timeline.durationSec * pixelsPerSecond), height: 32, top: 0 }} className="justify-center rounded-sm bg-[#1C5548] px-2">
        <Text numberOfLines={1} className="font-sans text-[11px] text-white">+ Add soundtrack</Text>
      </Pressable>}
    </View>
  </View>;
});

type TouchPoint = { pageX?: number; clientX?: number; locationX?: number };
type PinchState = { distance: number; scale: number; timeAtCenter: number; centerX: number } | null;
type TouchDragState = { lastX: number } | null;
type TrimDragState = { clipId: string; edge: "start" | "end"; startX: number; edgeTime: number; pixelsPerSecond: number } | null;
type PendingSlotPress = { clipId: string; fromIndex: number; startX: number; startY: number; pointerId: number; target: any } | null;
type ActiveSlotReorder = { clipId: string; fromIndex: number; toIndex: number; pointerId: number } | null;

export function TimelineStrip({ timeline, sources, selectedClipId, playheadSec, soundtrackName = null, onSelect, onScrub, onScrubStart = () => {}, onTrim = () => {}, onReorder = () => {}, onDeselect = () => {}, onSoundtrack = () => {} }: {
  timeline: Timeline;
  sources: Record<string, string>;
  selectedClipId: string | null;
  playheadSec: number;
  soundtrackName?: string | null;
  onSelect: (clipId: string, startSec: number) => void;
  onScrub: (seconds: number) => void;
  onScrubStart?: () => void;
  onTrim?: (clipId: string, edge: "start" | "end", deltaSec: number) => void;
  onReorder?: (clipId: string, toIndex: number) => void;
  onDeselect?: () => void;
  onSoundtrack?: () => void;
}) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollView = useRef<React.ElementRef<typeof ScrollView>>(null);
  const viewportRef = useRef<any>(null);
  const scrollLeft = useRef(0);
  const isUserScrolling = useRef(false);
  const programmaticOffset = useRef<number | null>(null);
  const interactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseDrag = useRef<{ x: number; scrollLeft: number } | null>(null);
  const touchDrag = useRef<TouchDragState>(null);
  const trimDrag = useRef<TrimDragState>(null);
  const [trimDraft, setTrimDraft] = useState<{ clipId: string; edge: "start" | "end"; deltaSec: number } | null>(null);
  const pendingSlotPress = useRef<PendingSlotPress>(null);
  const activeSlotReorder = useRef<ActiveSlotReorder>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edgeScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const edgeScrollDirection = useRef<-1 | 1 | null>(null);
  const lastReorderPointerX = useRef(0);
  const suppressNextPress = useRef(false);
  const [reorderPreview, setReorderPreview] = useState<{ clipId: string; toIndex: number; pointerContentX: number } | null>(null);
  const pinch = useRef<PinchState>(null);
  const leadingPadding = viewportWidth / 2;
  const contentWidth = timelineContentWidth(timeline.durationSec, viewportWidth, pixelsPerSecond);

  const updateViewport = useCallback((event: LayoutChangeEvent) => setViewportWidth(event.nativeEvent.layout.width), []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (activeSlotReorder.current) { scrollLeft.current = event.nativeEvent.contentOffset.x; return; }
    const offset = event.nativeEvent.contentOffset.x;
    scrollLeft.current = offset;
    const expected = programmaticOffset.current;
    if (!isUserScrolling.current && expected !== null && Math.abs(expected - offset) < 2) {
      programmaticOffset.current = null;
      return;
    }
    if (isUserScrolling.current) onScrub(Math.max(0, Math.min(timeline.durationSec, xToTime(offset + viewportWidth / 2, pixelsPerSecond, leadingPadding))));
  }, [leadingPadding, onScrub, pixelsPerSecond, timeline.durationSec, viewportWidth]);
  const beginInteraction = useCallback(() => {
    if (interactionTimer.current) clearTimeout(interactionTimer.current);
    interactionTimer.current = null;
    if (!isUserScrolling.current) onScrubStart();
    isUserScrolling.current = true;
    programmaticOffset.current = null;
  }, [onScrubStart]);
  const endInteractionSoon = useCallback(() => {
    if (interactionTimer.current) clearTimeout(interactionTimer.current);
    interactionTimer.current = setTimeout(() => {
      isUserScrolling.current = false;
      interactionTimer.current = null;
    }, 120);
  }, []);
  const scrubBy = useCallback((delta: number) => {
    const next = Math.max(0, Math.min(contentWidth - viewportWidth, scrollLeft.current + delta));
    scrollLeft.current = next;
    scrollView.current?.scrollTo({ x: next, animated: false });
    onScrub(Math.max(0, Math.min(timeline.durationSec, xToTime(next + viewportWidth / 2, pixelsPerSecond, leadingPadding))));
  }, [contentWidth, leadingPadding, onScrub, pixelsPerSecond, timeline.durationSec, viewportWidth]);
  const syncScrollToTime = useCallback((seconds: number, animated = false) => {
    if (!viewportWidth) return;
    const x = Math.max(0, Math.min(contentWidth - viewportWidth, timeToX(seconds, pixelsPerSecond, leadingPadding) - viewportWidth / 2));
    if (Math.abs(x - scrollLeft.current) < 0.5) return;
    programmaticOffset.current = x;
    scrollLeft.current = x;
    scrollView.current?.scrollTo({ x, animated });
  }, [contentWidth, leadingPadding, pixelsPerSecond, viewportWidth]);

  // Player frames move the content under the fixed playhead. This imperative sync never calls onScrub.
  useEffect(() => { syncScrollToTime(playheadSec); }, [playheadSec, syncScrollToTime]);

  const zoom = useCallback((delta: number) => {
    const nextScale = Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, pixelsPerSecond + delta));
    if (nextScale === pixelsPerSecond) return;
    isUserScrolling.current = false;
    setPixelsPerSecond(nextScale);
    requestAnimationFrame(() => syncScrollToTime(playheadSec));
  }, [pixelsPerSecond, playheadSec, syncScrollToTime]);

  const beginTrim = useCallback((clip: Timeline["videoClips"][number], edge: "start" | "end", event: any) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    const id = clipId(clip);
    const edgeTime = clip.startSec + (edge === "end" ? clip.durationSec : 0);
    trimDrag.current = { clipId: id, edge, startX: event.clientX, edgeTime, pixelsPerSecond };
    setTrimDraft({ clipId: id, edge, deltaSec: 0 });
    onScrubStart();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }, [onScrubStart, pixelsPerSecond]);

  const moveTrim = useCallback((event: any) => {
    const drag = trimDrag.current;
    if (!drag) return;
    const deltaSec = (event.clientX - drag.startX) / drag.pixelsPerSecond;
    setTrimDraft({ clipId: drag.clipId, edge: drag.edge, deltaSec });
    onScrub(Math.max(0, Math.min(timeline.durationSec, drag.edgeTime + deltaSec)));
  }, [onScrub, timeline.durationSec]);

  const finishTrim = useCallback((event: any, commit: boolean) => {
    const drag = trimDrag.current;
    if (!drag) return;
    if (commit) {
      const deltaSec = (event.clientX - drag.startX) / drag.pixelsPerSecond;
      if (Math.abs(deltaSec) >= 0.02) onTrim(drag.clipId, drag.edge, deltaSec);
    }
    trimDrag.current = null;
    setTrimDraft(null);
  }, [onTrim]);

  const stopEdgeScroll = useCallback(() => {
    if (edgeScrollTimer.current) clearInterval(edgeScrollTimer.current);
    edgeScrollTimer.current = null;
    edgeScrollDirection.current = null;
  }, []);
  const targetIndexAt = useCallback((clientX: number) => {
    const bounds = viewportRef.current?.getBoundingClientRect?.();
    if (!bounds || !timeline.videoClips.length) return 0;
    const seconds = (clientX - bounds.left + scrollLeft.current - leadingPadding) / pixelsPerSecond;
    let target = 0;
    let nearest = Number.POSITIVE_INFINITY;
    timeline.videoClips.forEach((clip, index) => {
      const distance = Math.abs(seconds - (clip.startSec + clip.durationSec / 2));
      if (distance < nearest) { nearest = distance; target = index; }
    });
    return target;
  }, [leadingPadding, pixelsPerSecond, timeline.videoClips]);
  const updateSlotReorder = useCallback((clientX: number) => {
    const active = activeSlotReorder.current;
    if (!active) return;
    lastReorderPointerX.current = clientX;
    const toIndex = targetIndexAt(clientX);
    active.toIndex = toIndex;
    const bounds = viewportRef.current?.getBoundingClientRect?.();
    const pointerContentX = bounds ? clientX - bounds.left + scrollLeft.current : clientX;
    setReorderPreview({ clipId: active.clipId, toIndex, pointerContentX });
    const direction = bounds && clientX < bounds.left + 36 ? -1 : bounds && clientX > bounds.right - 36 ? 1 : 0;
    if (!direction) { stopEdgeScroll(); return; }
    if (edgeScrollTimer.current && edgeScrollDirection.current === direction) return;
    stopEdgeScroll();
    edgeScrollDirection.current = direction;
    edgeScrollTimer.current = setInterval(() => {
      const max = Math.max(0, contentWidth - viewportWidth);
      const next = Math.max(0, Math.min(max, scrollLeft.current + direction * 12));
      if (next === scrollLeft.current) { stopEdgeScroll(); return; }
      scrollLeft.current = next;
      scrollView.current?.scrollTo({ x: next, animated: false });
      updateSlotReorder(lastReorderPointerX.current);
    }, 50);
  }, [contentWidth, stopEdgeScroll, targetIndexAt, viewportWidth]);
  const beginSlotPress = useCallback((clip: Timeline["videoClips"][number], fromIndex: number, event: any) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (trimDrag.current) return;
    if (pendingSlotPress.current?.clipId === clipId(clip)) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    const pending = { clipId: clipId(clip), fromIndex, startX: event.clientX ?? event.pageX ?? event.nativeEvent?.pageX ?? 0, startY: event.clientY ?? event.pageY ?? event.nativeEvent?.pageY ?? 0, pointerId: event.pointerId ?? 0, target: event.currentTarget };
    pendingSlotPress.current = pending;
    lastReorderPointerX.current = pending.startX;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      if (pendingSlotPress.current !== pending) return;
      activeSlotReorder.current = { clipId: pending.clipId, fromIndex, toIndex: fromIndex, pointerId: pending.pointerId };
      pendingSlotPress.current = null;
      mouseDrag.current = null;
      touchDrag.current = null;
      const bounds = viewportRef.current?.getBoundingClientRect?.();
      setReorderPreview({ clipId: pending.clipId, toIndex: fromIndex, pointerContentX: bounds ? pending.startX - bounds.left + scrollLeft.current : pending.startX });
      try { if (typeof navigator !== "undefined") navigator.vibrate?.(10); } catch { /* Haptics are optional. */ }
      try { pending.target?.setPointerCapture?.(pending.pointerId); } catch { /* Some browser gestures do not expose pointer capture. */ }
      updateSlotReorder(lastReorderPointerX.current || pending.startX);
    }, 300);
  }, [updateSlotReorder]);
  const moveSlotPress = useCallback((event: any) => {
    const active = activeSlotReorder.current;
    if (active) { event.preventDefault?.(); updateSlotReorder(event.clientX); return; }
    const pending = pendingSlotPress.current;
    if (!pending) return;
    const dx = (event.clientX ?? pending.startX) - pending.startX;
    const dy = (event.clientY ?? pending.startY) - pending.startY;
    if (Math.hypot(dx, dy) > 6) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      pendingSlotPress.current = null;
    }
  }, [updateSlotReorder]);
  const finishSlotPress = useCallback((event: any, commit: boolean) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    pendingSlotPress.current = null;
    const active = activeSlotReorder.current;
    if (active) {
      if (commit && active.toIndex !== active.fromIndex) onReorder(active.clipId, active.toIndex);
      suppressNextPress.current = true;
      setTimeout(() => { suppressNextPress.current = false; }, 0);
      activeSlotReorder.current = null;
      setReorderPreview(null);
      stopEdgeScroll();
      event.currentTarget?.releasePointerCapture?.(active.pointerId);
    }
  }, [onReorder, stopEdgeScroll]);
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (edgeScrollTimer.current) clearInterval(edgeScrollTimer.current);
  }, []);

  const isTrimHandle = (event: any) => Boolean(event.target?.closest?.('[data-trim-handle="true"]'));

  const touchX = (touch: TouchPoint, left: number) => touch.locationX ?? (touch.clientX !== undefined ? touch.clientX - left : touch.pageX !== undefined ? touch.pageX - left - (typeof window === "undefined" ? 0 : window.scrollX) : 0);
  const onTouchStart = (event: { nativeEvent?: { touches?: ArrayLike<TouchPoint> }; touches?: ArrayLike<TouchPoint>; currentTarget?: { getBoundingClientRect?: () => { left: number } } }) => {
    if (isTrimHandle(event as any)) return;
    const touches = (event.nativeEvent ?? event).touches;
    if (touches?.length === 1) {
      beginInteraction();
      const left = event.currentTarget?.getBoundingClientRect?.().left ?? 0;
      touchDrag.current = { lastX: touchX(touches[0], left) };
    }
    if (!touches || touches.length < 2 || !viewportWidth) return;
    touchDrag.current = null;
    const left = event.currentTarget?.getBoundingClientRect?.().left ?? 0;
    const first = touchX(touches[0], left);
    const second = touchX(touches[1], left);
    const centerX = Math.max(0, Math.min(viewportWidth, (first + second) / 2));
    pinch.current = { distance: Math.abs(second - first), scale: pixelsPerSecond, timeAtCenter: xToTime(scrollLeft.current + centerX, pixelsPerSecond, leadingPadding), centerX };
    isUserScrolling.current = false;
  };
  const onTouchMove = (event: { nativeEvent?: { touches?: ArrayLike<TouchPoint> }; touches?: ArrayLike<TouchPoint>; currentTarget?: { getBoundingClientRect?: () => { left: number } } }) => {
    if (activeSlotReorder.current) return;
    if (isTrimHandle(event as any)) return;
    const initial = pinch.current;
    const touches = (event.nativeEvent ?? event).touches;
    if (!initial && touches?.length === 1 && touchDrag.current) {
      const left = event.currentTarget?.getBoundingClientRect?.().left ?? 0;
      const currentX = touchX(touches[0], left);
      scrubBy(touchDrag.current.lastX - currentX);
      touchDrag.current.lastX = currentX;
      return;
    }
    if (!initial || !touches || touches.length < 2 || initial.distance < 1) return;
    const left = event.currentTarget?.getBoundingClientRect?.().left ?? 0;
    const distance = Math.abs(touchX(touches[1], left) - touchX(touches[0], left));
    const nextScale = Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, initial.scale * distance / initial.distance));
    setPixelsPerSecond(nextScale);
    const x = Math.max(0, Math.min(nextScale * timeline.durationSec, timeToX(initial.timeAtCenter, nextScale, leadingPadding) - initial.centerX));
    scrollLeft.current = x;
    requestAnimationFrame(() => scrollView.current?.scrollTo({ x, animated: false }));
  };

  const webHandlers = {
    onMouseDown: (event: { button: number; clientX: number; preventDefault: () => void }) => {
      if (event.button !== 0) return;
      if (isTrimHandle(event as any)) return;
      if (!((event as any).target?.closest?.('[data-timeline-slot="true"]'))) event.preventDefault();
      beginInteraction();
      mouseDrag.current = { x: event.clientX, scrollLeft: scrollLeft.current };
    },
    onMouseMove: (event: { clientX: number }) => {
      if (activeSlotReorder.current) return;
      const drag = mouseDrag.current;
      if (!drag) return;
      scrubBy(drag.x - event.clientX);
    },
    onMouseUp: () => { mouseDrag.current = null; endInteractionSoon(); },
    onMouseLeave: () => { if (mouseDrag.current) { mouseDrag.current = null; endInteractionSoon(); } },
    onWheel: (event: { deltaX: number; deltaY: number; shiftKey?: boolean; preventDefault: () => void }) => {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta) return;
      event.preventDefault();
      beginInteraction();
      requestAnimationFrame(() => {
        scrubBy(delta);
        endInteractionSoon();
      });
    },
    onTouchEnd: () => { touchDrag.current = null; endInteractionSoon(); },
    onTouchCancel: () => { touchDrag.current = null; endInteractionSoon(); },
  } as any;

  return <View className="mt-1">
    <View className="mb-1 h-8 flex-row items-center justify-end gap-1">
      <Pressable role="button" accessibilityLabel="Zoom out timeline" disabled={pixelsPerSecond <= MIN_PIXELS_PER_SECOND} onPress={() => zoom(-4)} className="size-8 items-center justify-center rounded-full border border-on-screen-muted"><Text className="font-sans text-body text-on-screen">−</Text></Pressable>
      <Text accessibilityLabel={`Timeline zoom ${pixelsPerSecond} pixels per second`} className="w-12 text-center font-sans text-[10px] text-on-screen-muted">{pixelsPerSecond} px/s</Text>
      <Pressable role="button" accessibilityLabel="Zoom in timeline" disabled={pixelsPerSecond >= MAX_PIXELS_PER_SECOND} onPress={() => zoom(4)} className="size-8 items-center justify-center rounded-full border border-on-screen-muted"><Text className="font-sans text-body text-on-screen">+</Text></Pressable>
    </View>
    <View ref={viewportRef} className="relative overflow-hidden" style={{ touchAction: "none" }} onTouchStart={onTouchStart} onTouchMove={onTouchMove} {...webHandlers}>
      <ScrollView ref={scrollView} horizontal accessibilityLabel="Unified timeline" showsHorizontalScrollIndicator={false} onLayout={updateViewport} onScrollBeginDrag={beginInteraction} onScrollEndDrag={endInteractionSoon} onMomentumScrollBegin={beginInteraction} onMomentumScrollEnd={endInteractionSoon} onScroll={onScroll} scrollEventThrottle={16} style={{ width: "100%" }}>
        <TimelineRows timeline={timeline} sources={sources} selectedClipId={selectedClipId} soundtrackName={soundtrackName} pixelsPerSecond={pixelsPerSecond} leadingPadding={leadingPadding} contentWidth={contentWidth} onSelect={(id, start) => { if (suppressNextPress.current) return; onSelect(id, start); }} onTrimPointerDown={beginTrim} onTrimPointerMove={moveTrim} onTrimPointerUp={finishTrim} trimDraft={trimDraft} onDeselect={onDeselect} onSlotPointerDown={beginSlotPress} onSlotPointerMove={moveSlotPress} onSlotPointerUp={finishSlotPress} reorderPreview={reorderPreview} onSoundtrack={onSoundtrack} />
      </ScrollView>
      <View pointerEvents="none" accessibilityLabel="Timeline playhead" style={{ position: "absolute", zIndex: 10, top: 0, bottom: 0, left: viewportWidth / 2 - 1, width: 2, backgroundColor: "#F1734F" }} />
    </View>
  </View>;
}
