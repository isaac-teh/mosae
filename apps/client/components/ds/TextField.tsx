import { Text, TextInput, View } from "react-native";

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText?: (value: string) => void;
  hint?: string;
  error?: string;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
};

export function TextField({ label, value, onChangeText, hint, error, multiline = false, placeholder, disabled = false }: TextFieldProps) {
  const message = error ?? hint;
  return (
    <View className="w-full max-w-[480px] flex-col gap-2">
      <Text className="text-label font-sans-medium text-ink">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        accessibilityHint={message}
        aria-label={label}
        aria-invalid={Boolean(error)}
        aria-describedby={message ? `${label.replace(/\s+/g, "-")}-message` : undefined}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholder={placeholder}
        editable={!disabled}
        textAlignVertical={multiline ? "top" : "center"}
        className={`min-h-12 rounded-sm border bg-surface-raised p-3 text-body font-sans text-ink focus:ring-2 focus:ring-focus-ring focus:ring-offset-2 ${error ? "border-2 border-critical" : "border-line-strong"} ${multiline ? "min-h-24" : ""} ${disabled ? "opacity-50" : ""}`}
      />
      {message ? <Text nativeID={`${label.replace(/\s+/g, "-")}-message`} className={`text-caption font-sans ${error ? "text-critical" : "text-ink-muted"}`}>{message}</Text> : null}
    </View>
  );
}
