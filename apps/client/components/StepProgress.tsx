import { View } from "react-native";

/** 4px progress track shown under the app header (Figma nodes 1:1433, 1:382). `value` is 0-1. */
export function StepProgress({ value }: { value: number }) {
  const pct = Math.min(1, Math.max(0, value)) * 100;
  return (
    <View className="relative h-1 w-full bg-track">
      <View
        className="absolute inset-y-0 left-0 rounded-r-full bg-brand"
        style={{ width: `${pct}%` }}
      />
    </View>
  );
}
