import { Text, View } from "react-native";

export function ChatTyping({ text }: { text: string }) {
  return <View className="w-full flex-row items-center gap-2" accessibilityLiveRegion="polite">
    <View className="flex-row gap-[3px]" accessibilityLabel="Working" accessibilityRole="text">
      {[0, 1, 2].map((dot) => <View key={dot} aria-hidden={true} className="h-1.5 w-1.5 rounded-sm bg-tile" />)}
    </View>
    <Text className="text-label font-sans text-ink-muted">{text}</Text>
  </View>;
}
