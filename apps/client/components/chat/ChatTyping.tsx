import { Text, View } from "react-native";
import { StableUriImage } from "../StableUriImage";

export function ChatTyping({ text, photos = [] }: { text: string; photos?: { id: string; uri: string; understood: boolean; label: string }[] }) {
  return <View className="w-full gap-3" accessibilityLiveRegion="polite">
    <View className="flex-row items-center gap-2">
      <View className="flex-row gap-[3px]" accessibilityLabel="Working" accessibilityRole="text">
        {[0, 1, 2].map((dot) => <View key={dot} aria-hidden={true} className="h-1.5 w-1.5 rounded-sm bg-tile" />)}
      </View>
      <Text className="text-label font-sans text-ink-muted">{text}</Text>
    </View>
    {photos.length > 0 && <View className="flex-row flex-wrap gap-2" accessibilityLabel="Photos being read">
      {photos.map((photo) => <View key={photo.id} data-reading-photo="true" accessibilityLabel={photo.label} className="size-[68px] overflow-hidden rounded-md bg-surface-sunken">
        <StableUriImage uri={photo.uri} resizeMode="cover" className={`size-full object-cover transition-all duration-700 ${photo.understood ? "blur-0 opacity-100" : "blur-[6px] opacity-55"}`} />
      </View>)}
    </View>}
  </View>;
}
