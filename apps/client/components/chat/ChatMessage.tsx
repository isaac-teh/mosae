import { Image, Text, View } from "react-native";

type ChatMessageProps = { from: "mosae" | "you"; text: string; facts?: string[]; photos?: string[] };

export function ChatMessage({ from, text, facts = [], photos = [] }: ChatMessageProps) {
  const isYou = from === "you";
  return <View data-from={from} className={`w-full flex-row ${isYou ? "justify-end" : "justify-start"}`}>
    <View className={`max-w-[80%] flex-col gap-2 ${isYou ? "rounded-md bg-bubble-you px-4 py-3" : ""}`}>
      <Text className={`text-body font-sans text-ink ${isYou ? "" : "leading-7"}`}>{text}</Text>
      {facts.length ? <View className="flex-col gap-1">{facts.map((fact) => <Text key={fact} className="text-label font-sans text-ink-muted">{fact}</Text>)}</View> : null}
      {photos.length ? <View className="flex-row gap-1">{photos.slice(0, 4).map((uri, index) => <Image key={`${uri}-${index}`} source={{ uri }} accessibilityLabel={`Photo ${index + 1}`} resizeMode="cover" className="h-14 w-14 rounded-sm" />)}</View> : null}
    </View>
  </View>;
}
