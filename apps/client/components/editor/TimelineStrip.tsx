import { Image, Pressable, ScrollView, Text, View } from "react-native";
import type { Timeline } from "@mosae/contracts";

const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const shotId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.spec.slots[0]?.shotId : clip.source.shotId;
const stripClipWidth = (clip: Timeline["videoClips"][number]) => Math.max(36, clip.durationSec * 21.2);
const stripGap = 4;

export function TimelineStrip({ timeline, sources, selectedClipId, onSelect }: {
  timeline: Timeline;
  sources: Record<string, string>;
  selectedClipId: string | null;
  onSelect: (clipId: string) => void;
}) {
  const chapters = timeline.chapters.map((chapter, index) => {
    const end = chapter.durationSec !== undefined
      ? chapter.startSec + chapter.durationSec
      : timeline.chapters[index + 1]?.startSec ?? timeline.durationSec;
    const clips = timeline.videoClips.filter((clip) => clip.startSec >= chapter.startSec - 1e-6 && clip.startSec < end - 1e-6);
    return { ...chapter, key: `${chapter.title}-${index}`, clips, width: clips.reduce((sum, clip) => sum + stripClipWidth(clip), 0) + Math.max(0, clips.length - 1) * stripGap };
  }).filter((chapter) => chapter.clips.length > 0);
  return <View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="w-full">
      <View>
        <View className="mb-2 flex-row gap-1">
          {chapters.map((chapter) => <View key={chapter.key} style={{ width: chapter.width }} className="min-w-0">
            <Text numberOfLines={1} ellipsizeMode="tail" className="overflow-hidden font-sans text-caption text-on-screen-muted">{chapter.title}</Text>
          </View>)}
        </View>
        <View className="flex-row gap-1">
        {timeline.videoClips.map((clip, index) => {
          const id = clipId(clip);
          const uri = sources[shotId(clip) ?? ""];
          return <Pressable key={id} role="button" accessibilityLabel={`Select clip ${id}`} onPress={() => onSelect(id)}
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
