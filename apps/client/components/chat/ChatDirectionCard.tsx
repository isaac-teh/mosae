import { Text, View } from "react-native";
import { FocusChip } from "../ds";

type Change = { aspect?: "9:16" | "16:9"; pace?: "gentle" | "lively"; lengthSec?: number; focus?: string; collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful" };
type ChatDirectionCardProps = { aspect: "9:16" | "16:9"; orientation?: { portrait: number; landscape: number; suggested: "9:16" | "16:9" | null }; pace: "gentle" | "lively"; lengthSec: number; durations: { id: string; label: string; caption?: string; seconds: number }[]; focus: string; collageAmount: "few" | "lots" | "none"; motionFeel: "calm" | "playful"; focusOptions: { id: string; label: string }[]; onChange: (change: Change) => void };

export function ChatDirectionCard({ aspect, orientation, pace, lengthSec, durations, focus, collageAmount, motionFeel, focusOptions, onChange }: ChatDirectionCardProps) {
  const total = (orientation?.portrait ?? 0) + (orientation?.landscape ?? 0);
  const suggested = orientation?.suggested;
  const prompt = suggested === "9:16" ? `Most of your photos are portrait (${orientation!.portrait} of ${total}) — make it a portrait film for phones? 📱` : suggested === "16:9" ? `Most of your photos are landscape (${orientation!.landscape} of ${total}) — make it a landscape film for TV/laptop? 🖥️` : "Your photos are a mix of portrait and landscape — how will you mostly watch it?";
  const yes = suggested === "9:16" ? "Yes, portrait" : suggested === "16:9" ? "Yes, landscape" : "📱 Portrait";
  const other = suggested ? (suggested === "9:16" ? "Landscape instead" : "Portrait instead") : "🖥️ Landscape";
  return <View className="w-full flex-col gap-4 rounded-md border border-line bg-surface-raised p-4">
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink">{prompt}</Text><View className="flex-row flex-wrap gap-2"><FocusChip label={yes} selected={aspect === (suggested ?? "9:16")} onPress={() => onChange({ aspect: suggested ?? "9:16" })} /><FocusChip label={other} selected={aspect === (suggested ? (suggested === "9:16" ? "16:9" : "9:16") : "16:9")} onPress={() => onChange({ aspect: suggested ? (suggested === "9:16" ? "16:9" : "9:16") : "16:9" })} /></View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Pace</Text><View className="flex-row flex-wrap gap-2"><FocusChip label="Gentle" selected={pace === "gentle"} onPress={() => onChange({ pace: "gentle" })} /><FocusChip label="Lively" selected={pace === "lively"} onPress={() => onChange({ pace: "lively" })} /></View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Length</Text><View className="flex-row flex-wrap gap-2">{durations.map(({ id, label, seconds }) => <FocusChip key={id} label={label} selected={lengthSec === seconds} onPress={() => onChange({ lengthSec: seconds })} />)}</View>{durations.filter(({ id }) => id === "short").map(({ caption }) => <Text key="short-caption" className="text-caption text-ink-muted">{caption}</Text>)}</View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Focus</Text><View className="flex-row flex-wrap gap-2">{focusOptions.map((option) => <FocusChip key={option.id} label={option.label} selected={focus === option.id} onPress={() => onChange({ focus: option.id })} />)}</View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Style</Text>
      <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Collages</Text><View className="flex-row flex-wrap gap-2">{([ ["few", "A few"], ["lots", "Lots"], ["none", "None"] ] as const).map(([value, label]) => <FocusChip key={value} label={label} selected={collageAmount === value} onPress={() => onChange({ collageAmount: value })} />)}</View></View>
      <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Motion</Text><View className="flex-row flex-wrap gap-2">{([ ["calm", "Calm"], ["playful", "Playful"] ] as const).map(([value, label]) => <FocusChip key={value} label={label} selected={motionFeel === value} onPress={() => onChange({ motionFeel: value })} />)}</View></View>
    </View>
  </View>;
}
