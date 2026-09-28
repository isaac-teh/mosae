import { describeProgress, type ProjectProgress } from "@mosae/core";
import { Text, View } from "react-native";

/**
 * Not in the Figma frames. It is deliberately quiet, uses existing tokens only,
 * and renders nothing without progress, so it needs design review before launch.
 */
export function ProcessingBanner({ progress }: { progress: ProjectProgress | null }) {
  if (!progress) return null;
  const tone = progress.status === "failed" ? "bg-ink-tint" : "bg-surface-sunken";
  return (
    <View role="status" aria-live="polite" className={`mt-4 rounded-2xl px-4 py-3 ${tone}`}>
      <Text className="font-sans text-caption leading-[18px] text-ink-muted">{describeProgress(progress)}</Text>
    </View>
  );
}
