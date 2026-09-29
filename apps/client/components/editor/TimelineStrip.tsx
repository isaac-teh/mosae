import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import type { Timeline } from "@mosae/contracts";

const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const shotId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.spec.slots[0]?.shotId : clip.source.shotId;
const stripClipWidth = (clip: Timeline["videoClips"][number]) => Math.max(36, clip.durationSec * 21.2);
const stripGap = 4;

export function TimelineStrip({ timeline, sources, selectedClipId, playheadSec, onSelect, onScrub }: {
  timeline: Timeline;
  sources: Record<string, string>;
  selectedClipId: string | null;
  playheadSec: number;
  onSelect: (clipId: string, startSec: number) => void;
  onScrub: (seconds: number) => void;
}) {
  const [scrubWidth, setScrubWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const scrollView = useRef<React.ElementRef<typeof ScrollView>>(null);
  const scrollLeft = useRef(0);
  const progress = timeline.durationSec > 0 ? Math.max(0, Math.min(1, playheadSec / timeline.durationSec)) : 0;
  const scrub = (event: GestureResponderEvent) => {
    if (!scrubWidth) return;
    const nativeEvent = event.nativeEvent as typeof event.nativeEvent & { clientX?: number; pageX?: number };
    let locationX = nativeEvent.locationX;
    if (!Number.isFinite(locationX)) {
      const target = event.currentTarget as unknown as HTMLElement | null;
      if (!target?.getBoundingClientRect) return;
      const rect = target.getBoundingClientRect();
      const scrollX = typeof window === "undefined" ? 0 : window.scrollX;
      locationX = Number.isFinite(nativeEvent.clientX)
        ? nativeEvent.clientX! - rect.left
        : Number.isFinite(nativeEvent.pageX) ? nativeEvent.pageX! - rect.left - scrollX : Number.NaN;
    }
    if (!Number.isFinite(locationX)) return;
    const seconds = Math.max(0, Math.min(1, locationX / scrubWidth)) * timeline.durationSec;
    onScrub(seconds);
  };
  const chapters = timeline.chapters.map((chapter, index) => {
    const end = chapter.durationSec !== undefined
      ? chapter.startSec + chapter.durationSec
      : timeline.chapters[index + 1]?.startSec ?? timeline.durationSec;
    const clips = timeline.videoClips.filter((clip) => clip.startSec >= chapter.startSec - 1e-6 && clip.startSec < end - 1e-6);
    return { ...chapter, key: `${chapter.title}-${index}`, clips, width: clips.reduce((sum, clip) => sum + stripClipWidth(clip), 0) + Math.max(0, clips.length - 1) * stripGap };
  }).filter((chapter) => chapter.clips.length > 0);
  const stripWidth = timeline.videoClips.reduce((sum, clip) => sum + stripClipWidth(clip), 0) + Math.max(0, timeline.videoClips.length - 1) * stripGap;
  useEffect(() => {
    if (!viewportWidth || stripWidth <= viewportWidth) return;
    const x = progress * stripWidth;
    if (x >= scrollLeft.current && x <= scrollLeft.current + viewportWidth) return;
    const left = Math.max(0, Math.min(stripWidth - viewportWidth, x - viewportWidth * 0.45));
    scrollLeft.current = left;
    scrollView.current?.scrollTo({ x: left, animated: false });
  }, [progress, stripWidth, viewportWidth]);
  return <View>
    <Pressable accessibilityRole="adjustable" accessibilityLabel="Scrub timeline" accessibilityValue={{ min: 0, max: timeline.durationSec, now: playheadSec }} onLayout={(event: LayoutChangeEvent) => setScrubWidth(event.nativeEvent.layout.width)} onPress={scrub} onPointerDown={(event) => scrub(event as unknown as GestureResponderEvent)} onPointerMove={(event) => { if ((event.nativeEvent as unknown as { buttons?: number }).buttons) scrub(event as unknown as GestureResponderEvent); }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={scrub} onResponderMove={scrub} className="relative mb-2 h-3 justify-center">
      <View className="h-[2px] w-full rounded-full bg-[#294655]" />
      <View pointerEvents="none" style={{ left: `${progress * 100}%` }} className="absolute top-0 h-3 w-[2px] bg-accent" />
    </Pressable>
    <ScrollView ref={scrollView} horizontal showsHorizontalScrollIndicator={false} onLayout={(event: LayoutChangeEvent) => setViewportWidth(event.nativeEvent.layout.width)} onScroll={(event: { nativeEvent: { contentOffset: { x: number } } }) => { scrollLeft.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={16} className="w-full">
      <View>
        <View className="mb-2 flex-row gap-1">
          {chapters.map((chapter) => <View key={chapter.key} style={{ width: chapter.width }} className="min-w-0">
            <Text numberOfLines={1} ellipsizeMode="tail" className="overflow-hidden font-sans text-caption text-on-screen-muted">{chapter.title}</Text>
          </View>)}
        </View>
        <View className="relative flex-row gap-1">
          <View pointerEvents="none" accessibilityLabel="Timeline playhead" style={{ left: `${progress * 100}%` }} className="absolute -top-1 bottom-0 z-10 w-[2px] bg-accent" />
        {timeline.videoClips.map((clip, index) => {
          const id = clipId(clip);
          const uri = sources[shotId(clip) ?? ""];
          return <Pressable key={id} role="button" accessibilityLabel={`Select clip ${id}`} onPress={() => onSelect(id, clip.startSec)}
            style={{ width: stripClipWidth(clip) }}
            className={`h-14 overflow-hidden rounded-sm border-2 ${selectedClipId === id ? "border-accent" : "border-transparent"}`}>
            {uri ? <Image source={{ uri }} resizeMode="cover" className="size-full" /> : <View className={`size-full ${index % 2 ? "bg-tide-tile" : "bg-paper"}`} />}
            {"kind" in clip && <View className="absolute bottom-0 left-0 right-0 bg-screen/70"><Text className="text-center font-sans text-[9px] text-on-screen">Collage</Text></View>}
          </Pressable>;
        })}
      </View>
      </View>
    </ScrollView>
  </View>;
}
