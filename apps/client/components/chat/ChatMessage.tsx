import { Text, View } from "react-native";
import { StableUriImage } from "../StableUriImage";
import { FacePreviewStrip } from "./ChatPersonQuestion";

type ChatMessageProps = { from: "mosae" | "you"; text: string; facts?: string[]; photos?: string[]; faceSamples?: { shotId: string; uri: string; bbox: [number, number, number, number] }[] };

export function ChatMessage({ from, text, facts = [], photos = [], faceSamples = [] }: ChatMessageProps) {
  const isYou = from === "you";
  return <View data-from={from} className={`w-full flex-row ${isYou ? "justify-end" : "justify-start"}`}>
    <View className={`max-w-[80%] flex-col gap-2 ${isYou ? "rounded-md bg-bubble-you px-4 py-3" : ""}`}>
      <Text className={`text-body font-sans text-ink ${isYou ? "" : "leading-7"}`}>{text}</Text>
      {facts.length ? <View className="flex-col gap-1">{facts.map((fact) => <Text key={fact} className="text-label font-sans text-ink-muted">{fact}</Text>)}</View> : null}
      {faceSamples.length ? <FacePreviewStrip samples={faceSamples} /> : photos.length ? <View className="flex-row gap-1">{photos.slice(0, 4).map((uri, index) => <StableUriImage key={index} uri={uri} accessibilityLabel={`Photo ${index + 1}`} resizeMode="cover" style={{ width: 56, height: 56, borderRadius: 2 }} />)}</View> : null}
    </View>
  </View>;
}
