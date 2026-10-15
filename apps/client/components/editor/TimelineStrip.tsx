import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Image, Platform, Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ViewStyle } from "react-native";
import type { Timeline } from "@mosae/contracts";
import { reorderSlots } from "@mosae/core";
import { DEFAULT_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND, MIN_PIXELS_PER_SECOND, timeToX, timelineContentWidth, xToTime } from "./timelineScale";

const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const shotId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.spec.slots[0]?.shotId : clip.source.shotId;
const secondsLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

type TimelineRowsProps = {
  timeline: Timeline;
  sources: Record<string, string>;
  thumbnails: Record<string, string>;
  selectedClipId: string | null;
  highlightedClipIds: string[];
  selectedAudioClipId: string | null;
  soundtrackName: string | null;
  pixelsPerSecond: number;
  leadingPadding: number;
  contentWidth: number;
  onSelect: (clipId: string, startSec: number) => void;
  onTrimPointerDown: (clip: Timeline["videoClips"][number], edge: "start" | "end", event: any) => void;
  onTrimPointerMove: (event: any) => void;
  onTrimPointerUp: (event: any, commit: boolean) => void;
  onDeselect: () => void;
  onSlotPointerDown: (clip: Timeline["videoClips"][number], index: number, event: any) => void;
  onSlotPointerMove: (event: any) => void;
  onSlotPointerUp: (event: any, commit: boolean) => void;
  reorderPreview: { clipId: string; toIndex: number; pointerContentX: number } | null;
  onSoundtrack: () => void;
  onSelectAudio: (audioClipId: string) => void;
  onAddClip: () => void;
};

const TimelineRows = memo(function TimelineRows({ timeline, sources, thumbnails, selectedClipId, highlightedClipIds, selectedAudioClipId, soundtrackName, pixelsPerSecond, leadingPadding, contentWidth, onSelect, onTrimPointerDown, onTrimPointerMove, onTrimPointerUp, onDeselect, onSlotPointerDown, onSlotPointerMove, onSlotPointerUp, reorderPreview, onSoundtrack, onSelectAudio, onAddClip }: TimelineRowsProps) {
  const musicClips = timeline.audioClips.filter((clip) => clip.role === "music" && clip.source.kind === "soundtrack");
  const music = musicClips[0];
  const musicStartSec = musicClips.length ? Math.min(...musicClips.map((clip) => clip.startSec)) : 0;
  const musicEndSec = musicClips.length ? Math.min(timeline.durationSec, Math.max(...musicClips.map((clip) => clip.startSec + clip.source.sourceOutSec - clip.source.sourceInSec))) : 0;
  const musicLeft = music ? timeToX(musicStartSec, pixelsPerSecond, leadingPadding) : 0;
  const musicWidth = music ? Math.max(1, timeToX(musicEndSec, pixelsPerSecond, leadingPadding) - musicLeft) : 0;
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
    <View className="relative mt-1 h-[36px]">
      {selectedClipId || selectedAudioClipId ? <Pressable role="button" accessibilityLabel="Deselect selected audio" onPress={onDeselect} style={{ position: "absolute", zIndex: 0, left: 0, right: 0, top: 0, height: 32 }} /> : null}
      {music ? <Pressable role="button" accessibilityLabel={`Music track ${soundtrackName ?? "Soundtrack"}`} aria-pressed={selectedAudioClipId === music.id} onPress={() => onSelectAudio(music.id)}
        style={{ position: "absolute", left: musicLeft, width: musicWidth, height: 32, top: 0, borderWidth: selectedAudioClipId === music.id ? 2 : 0, borderColor: "#FF8F70" }} className="justify-center rounded-sm bg-[#2B856C] px-2">
        <Text accessibilityLabel="Music track label" numberOfLines={1} ellipsizeMode="tail" className="font-sans-medium text-[11px] text-white">♫ {soundtrackName ?? "Soundtrack"}</Text>
      </Pressable> : <Pressable role="button" accessibilityLabel="Open soundtrack picker" onPress={onSoundtrack} style={{ position: "absolute", left: leadingPadding, width: Math.max(1, timeline.durationSec * pixelsPerSecond), height: 32, top: 0 }} className="justify-center rounded-sm bg-[#1C5548] px-2">
        <Text numberOfLines={1} className="font-sans text-[11px] text-white">+ Add soundtrack</Text>
      </Pressable>}
    </View>
    <View className="relative mt-1 h-[62px]">
      {selectedClipId || selectedAudioClipId ? <Pressable role="button" accessibilityLabel="Deselect selected clip" onPress={onDeselect} style={{ position: "absolute", zIndex: 0, left: 0, right: 0, top: 0, height: 58 }} /> : null}
      {(() => {
        const fromIndex = reorderPreview ? timeline.videoClips.findIndex((clip) => clipId(clip) === reorderPreview.clipId) : -1;
        const displayClips = reorderPreview && fromIndex >= 0 ? reorderSlots(timeline.videoClips, fromIndex, reorderPreview.toIndex) : timeline.videoClips;
        return displayClips.map((clip) => {
        const id = clipId(clip);
        const selected = selectedClipId === id;
        const lifted = reorderPreview?.clipId === id;
        const idForSource = shotId(clip) ?? "";
        const isVideo = "source" in clip && clip.source.kind === "video";
        const typeColor = "kind" in clip ? "#6D5A3E" : isVideo ? "#4F5B46" : "#36566A";
        const uri = isVideo ? thumbnails[idForSource] : sources[idForSource];
        const duration = clip.durationSec;
        const start = clip.startSec;
        const makeHandle = (edge: "start" | "end") => <Pressable key={edge} role="button" accessibilityLabel={`Trim ${edge} of clip ${id}`} aria-pressed={selected}
          onPointerDown={(event: any) => onTrimPointerDown(clip, edge, event)} onPointerMove={onTrimPointerMove} onPointerUp={(event: any) => onTrimPointerUp(event, true)} onPointerCancel={(event: any) => onTrimPointerUp(event, false)} data-trim-handle="true"
          style={{ position: "absolute", zIndex: 20, left: edge === "start" ? -22 : undefined, right: edge === "end" ? -22 : undefined, top: 7, height: 44, width: 44, borderRadius: 22, backgroundColor: "transparent", borderWidth: 0, alignItems: "center", justifyContent: "center", ...(Platform.OS === "web" ? ({ touchAction: "none" } as unknown as ViewStyle) : {}) }}><View pointerEvents="none" style={{ height: 34, width: 12, borderRadius: 6, backgroundColor: "#F5C842", borderWidth: 1, borderColor: "#2B2B20" }} /></Pressable>;
        const end = Math.min(timeline.durationSec, start + duration);
        const width = Math.max(1, (end - start) * pixelsPerSecond);
        const changed = highlightedClipIds.includes(id);
        return <View key={id} className="transition-all duration-200" style={{ position: "absolute", zIndex: lifted ? 30 : selected || changed ? 10 : 1, left: lifted && reorderPreview ? reorderPreview.pointerContentX - width / 2 : timeToX(start, pixelsPerSecond, leadingPadding), width, top: 0, height: 58, borderWidth: changed ? 3 : 2, borderRadius: 7, overflow: "visible", borderColor: changed ? "#FFC27A" : selected ? "#FF8F70" : typeColor, backgroundColor: typeColor, boxShadow: changed ? "0px 0px 16px rgba(255,178,99,0.95)" : lifted ? "0px 8px 22px rgba(0,0,0,0.35)" : undefined, elevation: lifted || changed ? 8 : 0 }}>
          <Pressable role="button" accessibilityLabel={`Select clip ${id}`} aria-pressed={selected} data-timeline-slot="true"
            onPointerDown={(event: any) => onSlotPointerDown(clip, timeline.videoClips.findIndex((item) => clipId(item) === id), event)} onPointerMove={onSlotPointerMove} onPointerUp={(event: any) => onSlotPointerUp(event, true)} onPointerCancel={(event: any) => onSlotPointerUp(event, false)}
            onTouchStart={(event: any) => onSlotPointerDown(clip, timeline.videoClips.findIndex((item) => clipId(item) === id), { ...event.nativeEvent, currentTarget: event.currentTarget, pointerId: 0 })}
            onContextMenu={(event: any) => event.preventDefault()}
            onDragStart={(event: any) => event.preventDefault()}
            onPress={(event: any) => { event?.stopPropagation?.(); onSelect(id, start); }}
            style={{ width, height: "100%", overflow: "hidden", borderRadius: 5, backgroundColor: "transparent", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", ...(Platform.OS === "web" ? ({ touchAction: "pan-x" } as unknown as ViewStyle) : {}) }}
            {...({ draggable: false } as any)}>
            {uri && isVideo ? <View pointerEvents="none" accessibilityLabel="Video filmstrip frames" style={{ position: "absolute", inset: 0, flexDirection: "row", overflow: "hidden" }}>
              {Array.from({ length: Math.max(1, Math.ceil(width / 48)) }, (_, frame) => <Image key={frame} source={{ uri }} accessibilityLabel="Video thumbnail frame" data-video-frame="true" resizeMode="cover" {...({ draggable: false } as any)} style={{ width: 48, height: "100%", borderRightWidth: 1, borderRightColor: "rgba(255,255,255,0.35)", pointerEvents: "none" }} />)}
            </View> : uri ? <Image source={{ uri }} resizeMode="cover" pointerEvents="none" {...({ draggable: false } as any)} style={{ width: "100%", height: "100%", pointerEvents: "none", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }} /> : null}
            {isVideo ? <View pointerEvents="none" accessibilityLabel="Video clip badge" className="absolute right-1 top-1 rounded-sm bg-black/75 px-1"><Text className="font-sans-medium text-[8px] text-white">VIDEO</Text></View> : null}
            {changed ? <View pointerEvents="none" accessibilityLabel="Changed moment" className="absolute -right-1 -top-1 h-3 w-3 rounded-full border border-[#111d26] bg-[#FFC27A]" /> : null}
            {"kind" in clip ? <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 items-center bg-screen/75"><Text className="font-sans text-[9px] text-on-screen">Collage</Text></View> : null}
          </Pressable>
          {selected ? <>{makeHandle("start")}{makeHandle("end")}</> : null}
        </View>;
      });
      })()}
    </View>
  </View>;
});

type TouchPoint = { pageX?: number; clientX?: number; locationX?: number };
type PinchState = { distance: number; scale: number; timeAtCenter: number; centerX: number } | null;
type TouchDragState = { lastX: number; active: boolean } | null;
type TrimDragState = { clipId: string; edge: "start" | "end"; startX: number; edgeTime: number; pixelsPerSecond: number; target: HTMLElement; button: HTMLElement | null; startLeft: number; startWidth: number; pendingDelta: number; raf: number | null; lastPreviewAt: number } | null;
type PendingSlotPress = { clipId: string; fromIndex: number; startX: number; startY: number; pointerId: number; target: any } | null;
type ActiveSlotReorder = { clipId: string; fromIndex: number; toIndex: number; pointerId: number } | null;

export function TimelineStrip({ timeline, sources, thumbnails = {}, selectedClipId, selectedAudioClipId = null, playheadSec, soundtrackName = null, isPlaying = false, highlightedClipIds = [], focusClipRequest = null, onSelect, onScrub, onScrubStart = () => {}, onTrim = () => {}, onReorder = () => {}, onDeselect = () => {}, onSoundtrack = () => {}, onSelectAudio = () => {}, onAddClip = () => {} }: {
  timeline: Timeline;
  sources: Record<string, string>;
  thumbnails?: Record<string, string>;
  selectedClipId: string | null;
  selectedAudioClipId?: string | null;
  playheadSec: number;
  soundtrackName?: string | null;
  isPlaying?: boolean;
  highlightedClipIds?: string[];
  focusClipRequest?: { clipId: string; nonce: number } | null;
  onSelect: (clipId: string, startSec: number) => void;
  onScrub: (seconds: number) => void;
  onScrubStart?: () => void;
  onTrim?: (clipId: string, edge: "start" | "end", deltaSec: number) => void;
  onReorder?: (clipId: string, toIndex: number) => void;
  onDeselect?: () => void;
  onSoundtrack?: () => void;
  onSelectAudio?: (audioClipId: string) => void;
  onAddClip?: () => void;
}) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollView = useRef<React.ElementRef<typeof ScrollView>>(null);
  const viewportRef = useRef<any>(null);
  const scrollLeft = useRef(0);
  const isUserScrolling = useRef(false);
  const programmaticOffset = useRef<number | null>(null);
  const slideFrame = useRef<number | null>(null);
  const slideToken = useRef(0);
  const interactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseDrag = useRef<{ x: number; active: boolean } | null>(null);
  const touchDrag = useRef<TouchDragState>(null);
  const trimDrag = useRef<TrimDragState>(null);
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

  const cancelSlide = useCallback(() => {
    slideToken.current += 1;
    if (slideFrame.current !== null) cancelAnimationFrame(slideFrame.current);
    slideFrame.current = null;
  }, []);

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
    cancelSlide();
    if (interactionTimer.current) clearTimeout(interactionTimer.current);
    interactionTimer.current = null;
    if (!isUserScrolling.current) onScrubStart();
    isUserScrolling.current = true;
    programmaticOffset.current = null;
  }, [cancelSlide, onScrubStart]);
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

  const slideToTime = useCallback((seconds: number) => {
    cancelSlide();
    if (!viewportWidth) return;
    const target = Math.max(0, Math.min(contentWidth - viewportWidth, timeToX(seconds, pixelsPerSecond, leadingPadding) - viewportWidth / 2));
    const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (isPlaying || isUserScrolling.current || prefersReducedMotion) {
      scrollLeft.current = target;
      programmaticOffset.current = target;
      scrollView.current?.scrollTo({ x: target, animated: false });
      return;
    }
    const from = scrollLeft.current;
    if (Math.abs(target - from) < 0.5) return;
    const token = slideToken.current;
    const startedAt = performance.now();
    const durationMs = 250;
    const step = (now: number) => {
      if (slideToken.current !== token) return;
      const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      const eased = 1 - (1 - progress) ** 3;
      const x = from + (target - from) * eased;
      scrollLeft.current = x;
      programmaticOffset.current = x;
      scrollView.current?.scrollTo({ x, animated: false });
      if (progress < 1) slideFrame.current = requestAnimationFrame(step);
      else { scrollLeft.current = target; programmaticOffset.current = target; slideFrame.current = null; }
    };
    slideFrame.current = requestAnimationFrame(step);
  }, [cancelSlide, contentWidth, isPlaying, leadingPadding, pixelsPerSecond, viewportWidth]);

  useEffect(() => cancelSlide, [cancelSlide]);
  useEffect(() => { if (isPlaying) cancelSlide(); }, [cancelSlide, isPlaying]);

  // Player frames move the content under the fixed playhead. This imperative sync never calls onScrub.
  useEffect(() => { if (slideFrame.current === null) syncScrollToTime(playheadSec); }, [playheadSec, syncScrollToTime]);
  useEffect(() => {
    if (!focusClipRequest) return;
    const clip = timeline.videoClips.find((candidate) => clipId(candidate) === focusClipRequest.clipId);
    if (clip) syncScrollToTime(clip.startSec, false);
  }, [focusClipRequest, syncScrollToTime, timeline.videoClips]);

  const zoom = useCallback((delta: number) => {
    cancelSlide();
    const nextScale = Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, pixelsPerSecond + delta));
    if (nextScale === pixelsPerSecond) return;
    isUserScrolling.current = false;
    setPixelsPerSecond(nextScale);
    requestAnimationFrame(() => syncScrollToTime(playheadSec));
  }, [cancelSlide, pixelsPerSecond, playheadSec, syncScrollToTime]);

  const beginTrim = useCallback((clip: Timeline["videoClips"][number], edge: "start" | "end", event: any) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    const id = clipId(clip);
    const edgeTime = clip.startSec + (edge === "end" ? clip.durationSec : 0);
    const target = event.currentTarget?.parentElement as HTMLElement | null;
    if (!target) return;
    const button = target.querySelector<HTMLElement>("[data-timeline-slot]");
    trimDrag.current = { clipId: id, edge, startX: event.clientX, edgeTime, pixelsPerSecond, target, button, startLeft: target.offsetLeft, startWidth: target.offsetWidth, pendingDelta: 0, raf: null, lastPreviewAt: 0 };
    onScrubStart();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }, [onScrubStart, pixelsPerSecond]);

  const moveTrim = useCallback((event: any) => {
    const drag = trimDrag.current;
    if (!drag) return;
    const deltaSec = (event.clientX - drag.startX) / drag.pixelsPerSecond;
    drag.pendingDelta = deltaSec;
    if (drag.raf === null) drag.raf = requestAnimationFrame(() => {
      if (trimDrag.current !== drag) return;
      const minWidth = drag.pixelsPerSecond * 0.5;
      const width = Math.max(minWidth, drag.startWidth + (drag.edge === "start" ? -1 : 1) * drag.pendingDelta * drag.pixelsPerSecond);
      drag.target.style.width = `${width}px`;
      if (drag.edge === "start") drag.target.style.left = `${drag.startLeft + drag.startWidth - width}px`;
      if (drag.button) drag.button.style.width = `${width}px`;
      drag.raf = null;
      const now = performance.now();
      if (now - drag.lastPreviewAt >= 100) {
        drag.lastPreviewAt = now;
        onScrub(Math.max(0, Math.min(timeline.durationSec, drag.edgeTime + drag.pendingDelta)));
      }
    });
  }, [onScrub, timeline.durationSec]);

  const finishTrim = useCallback((event: any, commit: boolean) => {
    const drag = trimDrag.current;
    if (!drag) return;
    if (drag.raf !== null) cancelAnimationFrame(drag.raf);
    drag.pendingDelta = (event.clientX - drag.startX) / drag.pixelsPerSecond;
    if (commit) {
      if (performance.now() - drag.lastPreviewAt >= 100 || drag.lastPreviewAt === 0) {
        const requested = drag.edgeTime + drag.pendingDelta;
        onScrub(Math.max(0, Math.min(timeline.durationSec, requested)));
      }
      if (Math.abs(drag.pendingDelta) >= 0.02) onTrim(drag.clipId, drag.edge, drag.pendingDelta);
    }
    if (!commit || Math.abs(drag.pendingDelta) < 0.02) {
      drag.target.style.left = `${drag.startLeft}px`; drag.target.style.width = `${drag.startWidth}px`;
      if (drag.button) drag.button.style.width = `${drag.startWidth}px`;
    }
    trimDrag.current = null;
  }, [onScrub, onTrim, timeline.durationSec]);

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
      // Pointer-up is the authoritative drop location. Touch and captured-pointer
      // sequences can end at a new coordinate without a final pointer-move.
      const dropX = event.clientX ?? event.nativeEvent?.clientX ?? event.nativeEvent?.pageX;
      const toIndex = commit && typeof dropX === "number" ? targetIndexAt(dropX) : active.toIndex;
      if (commit && toIndex !== active.fromIndex) onReorder(active.clipId, toIndex);
      suppressNextPress.current = true;
      setTimeout(() => { suppressNextPress.current = false; }, 0);
      activeSlotReorder.current = null;
      setReorderPreview(null);
      stopEdgeScroll();
      event.currentTarget?.releasePointerCapture?.(active.pointerId);
    }
  }, [onReorder, stopEdgeScroll, targetIndexAt]);
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
      const left = event.currentTarget?.getBoundingClientRect?.().left ?? 0;
      touchDrag.current = { lastX: touchX(touches[0], left), active: false };
    }
    if (!touches || touches.length < 2 || !viewportWidth) return;
    cancelSlide();
    touchDrag.current = null;
    const left = event.currentTarget?.getBoundingClientRect?.().left ?? 0;
    const first = touchX(touches[0], left);
    const second = touchX(touches[1], left);
    const centerX = Math.max(0, Math.min(viewportWidth, (first + second) / 2));
    pinch.current = { distance: Math.abs(second - first), scale: pixelsPerSecond, timeAtCenter: xToTime(scrollLeft.current + centerX, pixelsPerSecond, leadingPadding), centerX };
    isUserScrolling.current = false;
  };
  const onTouchMove = (event: { nativeEvent?: { touches?: ArrayLike<TouchPoint> }; touches?: ArrayLike<TouchPoint>; currentTarget?: { getBoundingClientRect?: () => { left: number } }; preventDefault?: () => void }) => {
    if (activeSlotReorder.current) { event.preventDefault?.(); return; }
    if (isTrimHandle(event as any)) return;
    const initial = pinch.current;
    const touches = (event.nativeEvent ?? event).touches;
    if (!initial && touches?.length === 1 && touchDrag.current) {
      if (!touchDrag.current.active) {
        touchDrag.current.active = true;
        beginInteraction();
      }
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
      mouseDrag.current = { x: event.clientX, active: false };
    },
    onMouseMove: (event: { clientX: number }) => {
      if (activeSlotReorder.current) return;
      const drag = mouseDrag.current;
      if (!drag) return;
      if (!drag.active && Math.abs(drag.x - event.clientX) > 2) { drag.active = true; beginInteraction(); }
      if (!drag.active) return;
      scrubBy(drag.x - event.clientX);
      drag.x = event.clientX;
    },
    onMouseUp: () => { const wasDragging = mouseDrag.current?.active; mouseDrag.current = null; if (wasDragging) endInteractionSoon(); },
    onMouseLeave: () => { if (mouseDrag.current) { const wasDragging = mouseDrag.current.active; mouseDrag.current = null; if (wasDragging) endInteractionSoon(); } },
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
    <View ref={viewportRef} className="relative overflow-hidden" style={{ touchAction: "pan-x", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }} onTouchStart={onTouchStart} onTouchMove={onTouchMove} {...webHandlers}>
      <ScrollView ref={scrollView} horizontal accessibilityLabel="Unified timeline" showsHorizontalScrollIndicator={false} onLayout={updateViewport} onScrollBeginDrag={beginInteraction} onScrollEndDrag={endInteractionSoon} onMomentumScrollBegin={beginInteraction} onMomentumScrollEnd={endInteractionSoon} onScroll={onScroll} scrollEventThrottle={16} style={{ width: "100%" }}>
      <TimelineRows timeline={timeline} sources={sources} thumbnails={thumbnails} selectedClipId={selectedClipId} highlightedClipIds={highlightedClipIds} selectedAudioClipId={selectedAudioClipId} soundtrackName={soundtrackName} pixelsPerSecond={pixelsPerSecond} leadingPadding={leadingPadding} contentWidth={contentWidth} onSelect={(id, start) => {
        if (suppressNextPress.current) return;
        if (id === selectedClipId) { onDeselect(); return; }
        const tapped = timeline.videoClips.find((clip) => clipId(clip) === id);
        const selected = selectedClipId ? timeline.videoClips.find((clip) => clipId(clip) === selectedClipId) : undefined;
        const seekSec = tapped && selected && tapped.startSec < selected.startSec
          ? Math.max(tapped.startSec, tapped.startSec + tapped.durationSec - 1 / timeline.fps)
          : start;
        onSelect(id, seekSec);
        slideToTime(seekSec);
      }} onTrimPointerDown={beginTrim} onTrimPointerMove={moveTrim} onTrimPointerUp={finishTrim} onDeselect={onDeselect} onSlotPointerDown={beginSlotPress} onSlotPointerMove={moveSlotPress} onSlotPointerUp={finishSlotPress} reorderPreview={reorderPreview} onSoundtrack={onSoundtrack} onSelectAudio={onSelectAudio} onAddClip={onAddClip} />
      </ScrollView>

      <Pressable role="button" accessibilityLabel="Add clip" onPress={onAddClip} style={{ position: "absolute", zIndex: 21, right: 8, top: 105, width: 44, height: 44, borderRadius: 22, backgroundColor: "#F7F6F2", alignItems: "center", justifyContent: "center", boxShadow: "0px 4px 12px rgba(0,0,0,0.45)", elevation: 8 }}><Text className="font-sans text-[25px] leading-[28px] text-[#172027]">+</Text></Pressable>
      <View pointerEvents="none" accessibilityLabel="Timeline playhead" style={{ position: "absolute", zIndex: 10, top: 0, bottom: 0, left: viewportWidth / 2 - 1, width: 2, backgroundColor: "#F1734F" }} />
    </View>
  </View>;
}
