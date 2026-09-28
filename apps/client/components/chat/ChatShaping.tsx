import { Text, View } from "react-native";

const steps = ["Picked moments for each chapter", "Trimmed the best parts of each clip", "Pacing it to the music"];

export function ChatShaping({ stepsDone }: { stepsDone: number }) {
  const done = Math.max(0, Math.min(steps.length, stepsDone));
  return <View className="w-full flex-col gap-3 rounded-md bg-surface-sunken p-4">
    <Text className="text-heading font-title text-ink">Shaping your film</Text>
    <View accessibilityRole="progressbar" accessibilityLabel="Film shaping progress" accessibilityValue={{ min: 0, max: 3, now: done }} className="flex-row gap-1">{Array.from({ length: 10 }, (_, index) => <View key={index} className={`h-2 flex-1 rounded-sm ${index < done * 10 / 3 ? "bg-tile" : "bg-surface-raised"}`} />)}</View>
    <View className="flex-col gap-2">{steps.map((step, index) => <View key={step} className="flex-row items-start gap-2"><Text className={`text-label font-sans-semibold ${index < done ? "text-positive" : index === done ? "text-ink" : "text-ink-muted"}`}>{index < done ? "✓" : index === done ? "◷" : "·"}</Text><Text className={`flex-1 text-label font-sans ${index < done ? "text-ink-muted" : "text-ink"}`}>{step}</Text></View>)}</View>
  </View>;
}
