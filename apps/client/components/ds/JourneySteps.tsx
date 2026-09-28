import { Text, View } from "react-native";

const labels = ["Pick", "Shape", "Review", "Direct", "Watch", "Save"];
type JourneyStepsProps = { current: number; compact?: boolean };

export function JourneySteps({ current, compact = false }: JourneyStepsProps) {
  const step = Math.max(1, Math.min(6, current));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of 6`} accessibilityValue={{ min: 1, max: 6, now: step }} role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={step} className="w-full">
      <View className="flex-row gap-1">
        {labels.map((label, index) => {
          const number = index + 1;
          return <View key={label} className="flex-1 items-center gap-2">
            <View className={`h-2 w-full rounded-sm ${number <= step ? "bg-tile" : "bg-surface-sunken"}`} />
            {!compact ? <Text className={`text-caption font-sans-medium ${number === step ? "text-ink" : "text-ink-muted"}`}>{label}</Text> : null}
          </View>;
        })}
      </View>
      {compact ? <Text className="mt-2 text-caption font-sans text-ink-muted">Step {step} of 6 · {labels[step - 1]}</Text> : null}
    </View>
  );
}
