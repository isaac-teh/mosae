import { Text, View } from "react-native";
import { FocusChip } from "../ds";

type Change = { aspect?: "9:16" | "16:9"; pace?: "gentle" | "lively"; focus?: string; collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful" };
type ChatDirectionCardProps = { aspect: "9:16" | "16:9"; orientation?: { portrait: number; landscape: number; suggested: "9:16" | "16:9" | null }; pace: "gentle" | "lively"; focus: string; collageAmount: "few" | "lots" | "none"; motionFeel: "calm" | "playful"; focusOptions: { id: string; label: string }[]; onChange: (change: Change) => void };

export function ChatDirectionCard({ aspect, pace, focus, collageAmount, focusOptions, onChange }: ChatDirectionCardProps) {
  const selectedFocus = focus.split(",").filter(Boolean);
  const toggleFocus = (id: string) => {
    if (id === "family") { onChange({ focus: "family" }); return; }
    const next = selectedFocus.includes(id) ? selectedFocus.filter(value => value !== id) : [...selectedFocus.filter(value => value !== "family"), id];
    onChange({ focus: next.length ? next.join(",") : "family" });
  };
  const chipProps = { selectedTone: "muted" as const };
  return <View className="w-full flex-col gap-4 rounded-md border border-line bg-surface-raised p-4">
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Orientation</Text><View className="flex-row flex-wrap gap-2">
      <FocusChip {...chipProps} label="Landscape" selected={aspect === "16:9"} onPress={() => onChange({ aspect: "16:9" })} />
      <FocusChip {...chipProps} label="Portrait" selected={aspect === "9:16"} onPress={() => onChange({ aspect: "9:16" })} />
    </View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Pace</Text><View className="flex-row flex-wrap gap-2">
      <FocusChip {...chipProps} label="Lively" selected={pace === "lively"} onPress={() => onChange({ pace: "lively" })} />
      <FocusChip {...chipProps} label="Calm" selected={pace === "gentle"} onPress={() => onChange({ pace: "gentle" })} />
    </View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Focus</Text><View className="flex-row flex-wrap gap-2">
      {focusOptions.map((option) => <FocusChip {...chipProps} key={option.id} label={option.label} selected={selectedFocus.includes(option.id)} onPress={() => toggleFocus(option.id)} />)}
    </View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Collage</Text><View className="flex-row flex-wrap gap-2">
      {([ ["few", "A few"], ["lots", "Lots"], ["none", "None"] ] as const).map(([value, label]) => <FocusChip {...chipProps} key={value} label={label} selected={collageAmount === value} onPress={() => onChange({ collageAmount: value })} />)}
    </View></View>
  </View>;
}
