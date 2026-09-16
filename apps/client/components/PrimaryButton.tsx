import { Pressable, Text } from "react-native";
import type { ReactNode } from "react";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
};

// Figma: h-14 brand pill CTA (tell-story "Find the moments", review-moments "Continue")
export function PrimaryButton({
  label,
  onPress,
  icon,
  trailingIcon,
  disabled = false,
  busy = false,
  busyLabel,
}: PrimaryButtonProps) {
  const displayLabel = busy && busyLabel ? busyLabel : label;
  return (
    <Pressable
      role="button"
      disabled={disabled || busy}
      onPress={onPress}
      className="mt-6 h-14 w-full flex-row items-center justify-center gap-1 rounded-full bg-brand shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.1)] disabled:opacity-50"
    >
      {icon}
      <Text className="font-sans-medium text-sm tracking-[0.35px] text-white">
        {displayLabel}
      </Text>
      {trailingIcon}
    </Pressable>
  );
}
