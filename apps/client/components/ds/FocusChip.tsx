import { Pressable, Text } from "react-native";

type FocusChipProps = { label: string; selected?: boolean; onPress?: () => void; disabled?: boolean; role?: "button" | "checkbox"; accessibilityLabel?: string };

export function FocusChip({ label, selected = false, onPress, disabled = false, role = "button", accessibilityLabel = label }: FocusChipProps) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      role={role}
      aria-label={accessibilityLabel}
      aria-pressed={role === "button" ? selected : undefined}
      aria-checked={role === "checkbox" ? selected : undefined}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 justify-center rounded-sm border px-3 py-2 ${selected ? "border-action bg-action" : "border-line-strong bg-surface-raised"} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`text-label font-sans-medium ${selected ? "text-on-action" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}
