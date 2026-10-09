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
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })}
      className={`min-h-11 justify-center rounded-sm border px-3 py-2 active:scale-[0.97] active:opacity-80 ${selected ? "border-action bg-action active:bg-action-pressed" : "border-line-strong bg-surface-raised active:bg-surface-sunken"} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`text-label font-sans-medium ${selected ? "text-on-action" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}
