import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

type ChatComposerProps = { placeholder: string; onSend: (text: string) => void; disabled?: boolean; confirmed?: number };

export function ChatComposer({ placeholder, onSend, disabled = false, confirmed = 0 }: ChatComposerProps) {
  const [text, setText] = useState("");
  const progress = Math.max(0, Math.min(4, confirmed));
  const send = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText("");
  };
  return <View className="w-full flex-col gap-3 border-t border-line bg-surface px-4 pb-4 pt-3">
    <View className="flex-row items-center gap-1" accessibilityLabel={`${progress} of 4 confirmed`}>
      {[0, 1, 2, 3].map((index) => <View key={index} className={`h-2.5 w-2.5 rounded-sm ${index < progress ? "bg-tile" : "bg-surface-sunken"}`} />)}
      <Text className="ml-2 text-caption font-sans text-ink-muted">{progress} of 4 confirmed</Text>
    </View>
    <View className="flex-row items-center gap-2">
      <TextInput accessibilityLabel={placeholder} placeholder={placeholder} value={text} onChangeText={setText} editable={!disabled} className="min-h-14 flex-1 rounded-md border border-line-strong bg-surface-raised px-4 text-body font-sans text-ink" />
      <Pressable accessibilityRole="button" accessibilityLabel="Send" role="button" aria-label="Send" aria-disabled={disabled || !text.trim()} disabled={disabled || !text.trim()} onPress={send} className={`h-11 w-11 items-center justify-center rounded-md bg-action ${disabled || !text.trim() ? "opacity-[0.38]" : ""}`}><Text className="text-heading font-sans-semibold text-on-action">→</Text></Pressable>
    </View>
  </View>;
}
