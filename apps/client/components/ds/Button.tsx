import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "on-media";
  size?: "md" | "sm";
  disabled?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
};

const variantClasses = {
  primary: "bg-action border-action",
  secondary: "bg-transparent border-line-strong",
  quiet: "bg-transparent border-transparent underline",
  "on-media": "bg-scrim/60 border-line",
};
const labelClasses = { primary: "text-on-action", secondary: "text-ink", quiet: "text-ink", "on-media": "text-on-screen" };
const pressedClasses = { primary: "active:bg-action-pressed", secondary: "active:bg-surface-sunken", quiet: "active:bg-surface-sunken", "on-media": "active:opacity-80" };

export function Button({ label, onPress, variant = "primary", size = "md", disabled = false, loading = false, leadingIcon }: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive }}
      role="button"
      aria-label={label}
      aria-disabled={inactive}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed && !inactive ? 0.8 : undefined, transform: [{ scale: pressed && !inactive ? 0.97 : 1 }] })}
      className={`flex-row items-center justify-center gap-2 rounded-md border focus:ring-2 focus:ring-focus-ring focus:ring-offset-2 active:scale-[0.97] ${pressedClasses[variant]} ${variantClasses[variant]} ${size === "md" ? "min-h-12 px-6" : "min-h-11 px-4"} ${inactive ? "opacity-[0.38]" : ""}`}
    >
      {loading ? <View className="h-6 w-6 flex-row items-center justify-center gap-0.5" accessibilityLabel="Loading"><View className="h-1.5 w-1.5 rounded-sm bg-current" /><View className="h-1.5 w-1.5 rounded-sm bg-current" /><View className="h-1.5 w-1.5 rounded-sm bg-current" /></View> : leadingIcon}
      <Text className={`${size === "md" ? "text-button" : "text-label"} font-sans-semibold ${labelClasses[variant]} ${variant === "quiet" ? "underline" : ""}`}>{label}</Text>
    </Pressable>
  );
}
