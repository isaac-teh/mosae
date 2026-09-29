import { Text, View } from "react-native";
import { FocusChip } from "../ds";

type Change = { pace?: "gentle" | "lively"; lengthSec?: number; focus?: string; collageAmount?: "few" | "lots" | "none"; motionFeel?: "calm" | "playful" };
type ChatDirectionCardProps = { pace: "gentle" | "lively"; lengthSec: number; focus: string; collageAmount: "few" | "lots" | "none"; motionFeel: "calm" | "playful"; focusOptions: { id: string; label: string }[]; onChange: (change: Change) => void };

export function ChatDirectionCard({ pace, lengthSec, focus, collageAmount, motionFeel, focusOptions, onChange }: ChatDirectionCardProps) {
  return <View className="w-full flex-col gap-4 rounded-md border border-line bg-surface-raised p-4">
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Pace</Text><View className="flex-row flex-wrap gap-2"><FocusChip label="Gentle" selected={pace === "gentle"} onPress={() => onChange({ pace: "gentle" })} /><FocusChip label="Lively" selected={pace === "lively"} onPress={() => onChange({ pace: "lively" })} /></View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Length</Text><View className="flex-row flex-wrap gap-2">{[60, 120, 240].map((seconds) => <FocusChip key={seconds} label={`${seconds / 60} min`} selected={lengthSec === seconds} onPress={() => onChange({ lengthSec: seconds })} />)}</View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Focus</Text><View className="flex-row flex-wrap gap-2">{focusOptions.map((option) => <FocusChip key={option.id} label={option.label} selected={focus === option.id} onPress={() => onChange({ focus: option.id })} />)}</View></View>
    <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Style</Text>
      <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Collages</Text><View className="flex-row flex-wrap gap-2">{([ ["few", "A few"], ["lots", "Lots"], ["none", "None"] ] as const).map(([value, label]) => <FocusChip key={value} label={label} selected={collageAmount === value} onPress={() => onChange({ collageAmount: value })} />)}</View></View>
      <View className="flex-col gap-2"><Text className="text-label font-sans-medium text-ink-muted">Motion</Text><View className="flex-row flex-wrap gap-2">{([ ["calm", "Calm"], ["playful", "Playful"] ] as const).map(([value, label]) => <FocusChip key={value} label={label} selected={motionFeel === value} onPress={() => onChange({ motionFeel: value })} />)}</View></View>
    </View>
  </View>;
}
