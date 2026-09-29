import { Image, Text, View } from "react-native";
import type { Timeline } from "@mosae/contracts";

export function EditorPreview({ timeline, sources }: { timeline: Timeline; sources: Record<string, string>; onTimeChange?: (seconds: number) => void; seekRequest?: { seconds: number } | null }) {
  const first = timeline.videoClips[0];
  const shotId = first && ("kind" in first ? first.spec.slots[0]?.shotId : first.source.shotId);
  const uri = shotId ? sources[shotId] : undefined;
  return <View className="size-full overflow-hidden rounded-[14px] bg-tide-tile">
    {uri && <Image source={{ uri }} resizeMode="cover" className="size-full opacity-60" />}
    <View className="absolute inset-0 items-center justify-center bg-black/35 px-6"><Text className="text-center font-sans text-body text-on-screen">Editing is available on the web for now.</Text></View>
  </View>;
}
