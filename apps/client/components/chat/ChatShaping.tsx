import { Text, View } from "react-native";

const steps = ["Picked moments for each chapter", "Trimmed the best parts of each clip", "Film ready"];

export function ChatShaping({ progress, stepsDone }: { progress: number; stepsDone: number }) {
  const done = Math.max(0, Math.min(steps.length, stepsDone));
  const percentage = Math.max(0, Math.min(1, progress)) * 100;
  return <View className="w-full flex-col gap-3 rounded-md bg-surface-sunken p-4">
    <Text className="text-heading font-title text-ink">Shaping your film</Text>
    <View accessibilityRole="progressbar" accessibilityLabel="Film shaping progress" accessibilityValue={{ min: 0, max: 100, now: percentage }} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} className="flex-row gap-1">
      {Array.from({ length: 10 }, (_, index) => {
        const fill = Math.max(0, Math.min(1, percentage / 10 - index));
        return <View key={index} data-progress-segment="true" data-filled={fill > 0} className="h-2 flex-1 overflow-hidden rounded-sm bg-surface-raised">
          <View aria-hidden={true} data-progress-fill="true" style={{ width: `${fill * 100}%`, height: "100%" }} className="rounded-sm bg-tile transition-all duration-300 ease-linear" />
        </View>;
      })}
    </View>
    <View className="flex-col gap-2">{steps.map((step, index) => {
      const status = index < done ? "done" : index === done ? "current" : "upcoming";
      return <View key={step} className="flex-row items-start gap-2">
        <Text data-step={step} data-status={status} className={`text-label font-sans-semibold ${status === "done" ? "text-positive" : status === "current" ? "text-ink" : "text-ink-muted"}`}>{status === "done" ? "✓" : status === "current" ? "◷" : "·"}</Text>
        <Text className={`flex-1 text-label font-sans ${status === "done" ? "text-ink-muted" : "text-ink"}`}>{step}</Text>
      </View>;
    })}</View>
  </View>;
}
