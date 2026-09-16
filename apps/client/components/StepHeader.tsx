import { Pressable, Text, View } from "react-native";
import { ArrowLeftIcon } from "./icons";
import { StepProgress } from "./StepProgress";

type StepHeaderProps = {
  step: string;
  label: string;
  progress: number;
  onBack: () => void;
  backLabel?: string;
  showProgress?: boolean;
};

// Figma nodes: 1:1446 (Header), 1:1447 (Container), 1:1452 (pill), 1:1458 (progress bar)
export function StepHeader({
  step,
  label,
  progress,
  onBack,
  backLabel = "Go back",
  showProgress = true,
}: StepHeaderProps) {
  return (
    <View className="z-30 bg-canvas/85 shadow-[0_1px_8px_rgba(54,49,44,0.04)] backdrop-blur-md">
      <View className="relative h-14 flex-row items-center justify-center px-5">
        <Pressable
          role="button"
          aria-label={backLabel}
          onPress={onBack}
          className="absolute left-4 size-10 items-center justify-center rounded-full"
        >
          <ArrowLeftIcon />
        </Pressable>
        <View className="flex-row items-center gap-1 rounded-full bg-surface-pill px-4 py-1 shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
          <Text className="font-sans-semibold text-[11px] uppercase leading-[14px] tracking-[0.55px] text-ink-soft">
            {step}
          </Text>
          <View className="size-1 rounded-full bg-brand-dot" />
          <Text className="font-sans-semibold text-[11px] leading-[14px] text-ink-soft">
            {label}
          </Text>
        </View>
      </View>
      {showProgress && <StepProgress value={progress} />}
    </View>
  );
}
