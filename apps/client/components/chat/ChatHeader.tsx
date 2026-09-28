import { Pressable, Text, View } from "react-native";

type ChatHeaderProps = { title: string; confirmed: number; ready: boolean; onBack: () => void };

export function ChatHeader({ title, confirmed, ready, onBack }: ChatHeaderProps) {
  const progress = Math.max(0, Math.min(4, confirmed));
  return <View className="w-full flex-row items-center gap-3 border-b border-line bg-surface px-4 py-3">
    <Pressable accessibilityRole="button" accessibilityLabel="Back" role="button" aria-label="Back" onPress={onBack} className="min-h-11 min-w-11 items-center justify-center"><Text className="text-heading font-sans text-ink">‹</Text></Pressable>
    <View className="flex-1 flex-col gap-1">
      <Text className="text-heading font-title text-ink">{title}</Text>
      {ready ? <Text className="text-caption font-sans-medium text-positive">✓ Film ready</Text> : <View className="flex-row items-center gap-2">
        <View className="flex-row gap-1">{[0, 1, 2, 3].map((index) => <View key={index} className={`h-2 w-5 rounded-sm ${index < progress ? "bg-tile" : "bg-surface-sunken"}`} />)}</View>
        <Text className="text-caption font-sans text-ink-muted">{progress} of 4 confirmed</Text>
      </View>}
    </View>
  </View>;
}
