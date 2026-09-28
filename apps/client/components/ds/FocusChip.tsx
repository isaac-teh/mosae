import { Pressable, Text } from "react-native";

type FocusChipProps = { label: string; selected?: boolean; onPress?: () => void; disabled?: boolean };

export function FocusChip({ label, selected = false, onPress, disabled = false }: FocusChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      role="button"
      aria-label={label}
      aria-pressed={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 justify-center rounded-sm border px-3 py-2 ${selected ? "border-action bg-action" : "border-line-strong bg-surface-raised"} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`text-label font-sans-medium ${selected ? "text-on-action" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}
