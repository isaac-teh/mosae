import { Image, Pressable, ScrollView, Text, View } from "react-native";
import type { Timeline } from "@mosae/contracts";

const clipId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;
const shotId = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.spec.slots[0]?.shotId : clip.source.shotId;

export function TimelineStrip({ timeline, sources, selectedClipId, onSelect }: {
  timeline: Timeline;
  sources: Record<string, string>;
  selectedClipId: string | null;
  onSelect: (clipId: string) => void;
}) {
  return <View>
    <View className="mb-2 flex-row justify-between px-0.5">
      {timeline.chapters.map((chapter, index) => <Text key={`${chapter.title}-${index}`} className="font-sans text-caption text-on-screen-muted">{chapter.title}</Text>)}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="w-full">
      <View className="flex-row gap-1">
        {timeline.videoClips.map((clip, index) => {
          const id = clipId(clip);
          const uri = sources[shotId(clip) ?? ""];
          return <Pressable key={id} role="button" accessibilityLabel={`Select clip ${id}`} onPress={() => onSelect(id)}
            style={{ width: Math.max(36, clip.durationSec * 21.2) }}
            className={`h-14 overflow-hidden rounded-sm border-2 ${selectedClipId === id ? "border-accent" : "border-transparent"}`}>
            {uri ? <Image source={{ uri }} resizeMode="cover" className="size-full" /> : <View className={`size-full ${index % 2 ? "bg-tide-tile" : "bg-paper"}`} />}
            {"kind" in clip && <View className="absolute bottom-0 left-0 right-0 bg-screen/70"><Text className="text-center font-sans text-[9px] text-on-screen">Collage</Text></View>}
          </Pressable>;
        })}
      </View>
    </ScrollView>
  </View>;
}
