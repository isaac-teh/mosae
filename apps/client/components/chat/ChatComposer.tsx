import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

type ChatComposerProps = { placeholder: string; onSend: (text: string) => void; disabled?: boolean };

export function ChatComposer({ placeholder, onSend, disabled = false }: ChatComposerProps) {
  const [text, setText] = useState("");
  const send = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText("");
  };
  return <View className="w-full flex-col gap-3 border-t border-line bg-surface px-4 pb-4 pt-3">
    <View className="flex-row items-center gap-2">
      <TextInput accessibilityLabel={placeholder} placeholder={placeholder} value={text} onChangeText={setText} editable={!disabled} className="min-h-14 flex-1 rounded-md border border-line-strong bg-surface-raised px-4 text-body font-sans text-ink" />
      <Pressable accessibilityRole="button" accessibilityLabel="Send" role="button" aria-label="Send" aria-disabled={disabled || !text.trim()} disabled={disabled || !text.trim()} onPress={send} style={({ pressed }) => ({ opacity: pressed && !disabled && Boolean(text.trim()) ? 0.8 : undefined, transform: [{ scale: pressed && !disabled && Boolean(text.trim()) ? 0.97 : 1 }] })} className={`h-11 w-11 items-center justify-center rounded-md bg-action active:bg-action-pressed active:scale-[0.97] ${disabled || !text.trim() ? "opacity-[0.38]" : ""}`}><Text className="text-heading font-sans-semibold text-on-action">→</Text></Pressable>
    </View>
  </View>;
}
