import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { Timeline } from "@mosae/contracts";
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
  onSoundtrack: () => void;
};

const TimelineRows = memo(function TimelineRows({ timeline, sources, selectedClipId, soundtrackName, pixelsPerSecond, leadingPadding, contentWidth, onSelect, onSoundtrack }: TimelineRowsProps) {
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
      {timeline.videoClips.map((clip, index) => {
        const id = clipId(clip);
        const uri = sources[shotId(clip) ?? ""];
        const width = Math.max(1, clip.durationSec * pixelsPerSecond);
        return <Pressable key={id} role="button" accessibilityLabel={`Select clip ${id}`} onPress={() => onSelect(id, clip.startSec)}
          style={{ position: "absolute", left: timeToX(clip.startSec, pixelsPerSecond, leadingPadding), width, top: 0, height: 58, borderWidth: 2, borderRadius: 7, overflow: "hidden", borderColor: selectedClipId === id ? "#F1734F" : "transparent", backgroundColor: index % 2 ? "#294655" : "#E8E2D5" }}>
          {uri ? <Image source={{ uri }} resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : null}
          {"kind" in clip ? <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 items-center bg-screen/75"><Text className="font-sans text-[9px] text-on-screen">Collage</Text></View> : null}
        </Pressable>;
      })}
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

export function TimelineStrip({ timeline, sources, selectedClipId, playheadSec, soundtrackName = null, onSelect, onScrub, onScrubStart = () => {}, onSoundtrack = () => {} }: {
  timeline: Timeline;
  sources: Record<string, string>;
  selectedClipId: string | null;
  playheadSec: number;
  soundtrackName?: string | null;
  onSelect: (clipId: string, startSec: number) => void;
  onScrub: (seconds: number) => void;
  onScrubStart?: () => void;
  onSoundtrack?: () => void;
}) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollView = useRef<React.ElementRef<typeof ScrollView>>(null);
  const scrollLeft = useRef(0);
  const isUserScrolling = useRef(false);
  const programmaticOffset = useRef<number | null>(null);
  const interactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseDrag = useRef<{ x: number; scrollLeft: number } | null>(null);
  const touchDrag = useRef<TouchDragState>(null);
  const pinch = useRef<PinchState>(null);
  const leadingPadding = viewportWidth / 2;
  const contentWidth = timelineContentWidth(timeline.durationSec, viewportWidth, pixelsPerSecond);

  const updateViewport = useCallback((event: LayoutChangeEvent) => setViewportWidth(event.nativeEvent.layout.width), []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
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

  const touchX = (touch: TouchPoint, left: number) => touch.locationX ?? (touch.clientX !== undefined ? touch.clientX - left : touch.pageX !== undefined ? touch.pageX - left - (typeof window === "undefined" ? 0 : window.scrollX) : 0);
  const onTouchStart = (event: { nativeEvent?: { touches?: ArrayLike<TouchPoint> }; touches?: ArrayLike<TouchPoint>; currentTarget?: { getBoundingClientRect?: () => { left: number } } }) => {
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
  const onTouchMove = (event: { nativeEvent?: { touches?: ArrayLike<TouchPoint> }; touches?: ArrayLike<TouchPoint>; currentTarget?: { getBoundingClientRect?: () => { left: number } }; preventDefault?: () => void }) => {
    const initial = pinch.current;
    const touches = (event.nativeEvent ?? event).touches;
    if (!initial && touches?.length === 1 && touchDrag.current) {
      event.preventDefault?.();
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
      event.preventDefault();
      beginInteraction();
      mouseDrag.current = { x: event.clientX, scrollLeft: scrollLeft.current };
    },
    onMouseMove: (event: { clientX: number }) => {
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
    <View className="relative overflow-hidden" onTouchStart={onTouchStart} onTouchMove={onTouchMove} {...webHandlers}>
      <ScrollView ref={scrollView} horizontal accessibilityLabel="Unified timeline" showsHorizontalScrollIndicator={false} onLayout={updateViewport} onScrollBeginDrag={beginInteraction} onScrollEndDrag={endInteractionSoon} onMomentumScrollBegin={beginInteraction} onMomentumScrollEnd={endInteractionSoon} onScroll={onScroll} scrollEventThrottle={16} style={{ width: "100%" }}>
        <TimelineRows timeline={timeline} sources={sources} selectedClipId={selectedClipId} soundtrackName={soundtrackName} pixelsPerSecond={pixelsPerSecond} leadingPadding={leadingPadding} contentWidth={contentWidth} onSelect={onSelect} onSoundtrack={onSoundtrack} />
      </ScrollView>
      <View pointerEvents="none" accessibilityLabel="Timeline playhead" style={{ position: "absolute", zIndex: 10, top: 0, bottom: 0, left: viewportWidth / 2 - 1, width: 2, backgroundColor: "#F1734F" }} />
    </View>
  </View>;
}
