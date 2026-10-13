import { Text, View } from "react-native";
import { FocusChip } from "../ds";

type Change = { aspect?: "9:16" | "16:9"; pace?: "gentle" | "lively"; focus?: string; collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful" };
type ChatDirectionCardProps = { aspect: "9:16" | "16:9"; orientation?: { portrait: number; landscape: number; suggested: "9:16" | "16:9" | null }; pace: "gentle" | "lively"; focus: string; collageAmount: "few" | "lots" | "none"; motionFeel: "calm" | "playful"; focusOptions: { id: string; label: string }[]; onChange: (change: Change) => void };

export function ChatDirectionCard({ aspect, orientation, pace, focus, collageAmount, motionFeel, focusOptions, onChange }: ChatDirectionCardProps) {
  const selectedFocus = focus.split(",").filter(Boolean);
  const toggleFocus = (id: string) => {
    if (id === "family") { onChange({ focus: "family" }); return; }
    const next = selectedFocus.includes(id) ? selectedFocus.filter(value => value !== id) : [...selectedFocus.filter(value => value !== "family"), id];
    onChange({ focus: next.length ? next.join(",") : "family" });
  };
  const total = (orientation?.portrait ?? 0) + (orientation?.landscape ?? 0);
  const suggested = orientation?.suggested;
  const prompt = suggested === "9:16" ? `Most of your photos are vertical (${orientation!.portrait} of ${total}) — make it portrait? 📱` : suggested === "16:9" ? `Most of your photos are horizontal (${orientation!.landscape} of ${total}) — make it landscape? 🖥️` : "Your photos are a mix — which orientation do you want?";
  const yes = suggested === "9:16" ? "Yes, portrait" : suggested === "16:9" ? "Yes, landscape" : "📱 Portrait";
  const other = suggested ? (suggested === "9:16" ? "Landscape instead" : "Portrait instead") : "🖥️ Landscape";
  return <View className="w-full flex-col gap-4 rounded-md border border-line bg-surface-raised p-4">
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink">{prompt}</Text><View className="flex-row flex-wrap gap-2"><FocusChip label={yes} selected={aspect === (suggested ?? "9:16")} onPress={() => onChange({ aspect: suggested ?? "9:16" })} /><FocusChip label={other} selected={aspect === (suggested ? (suggested === "9:16" ? "16:9" : "9:16") : "16:9")} onPress={() => onChange({ aspect: suggested ? (suggested === "9:16" ? "16:9" : "9:16") : "16:9" })} /></View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Pace</Text><View className="flex-row flex-wrap gap-2"><FocusChip label="Gentle" selected={pace === "gentle"} onPress={() => onChange({ pace: "gentle" })} /><FocusChip label="Lively" selected={pace === "lively"} onPress={() => onChange({ pace: "lively" })} /></View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Focus</Text><View className="flex-row flex-wrap gap-2">{focusOptions.map((option) => <FocusChip key={option.id} label={option.label} selected={selectedFocus.includes(option.id)} onPress={() => toggleFocus(option.id)} />)}</View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Style</Text>
      <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Collages</Text><View className="flex-row flex-wrap gap-2">{([ ["few", "A few"], ["lots", "Lots"], ["none", "None"] ] as const).map(([value, label]) => <FocusChip key={value} label={label} selected={collageAmount === value} onPress={() => onChange({ collageAmount: value })} />)}</View></View>
      <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Motion</Text><View className="flex-row flex-wrap gap-2">{([ ["calm", "Calm"], ["playful", "Playful"] ] as const).map(([value, label]) => <FocusChip key={value} label={label} selected={motionFeel === value} onPress={() => onChange({ motionFeel: value })} />)}</View></View>
    </View>
  </View>;
}
