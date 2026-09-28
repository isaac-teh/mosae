import { Image, Text, View } from "react-native";
import { Button, FocusChip } from "../ds";

type ChatPersonQuestionProps = { momentCount: number; sampleUris: string[]; days: number[]; chips: string[]; onPick: (role: string) => void; onTypeName: () => void; onSkip: () => void };

function daysLabel(days: number[]): string {
  if (!days.length) return "";
  const values = days.map(String);
  const list = values.length > 1 ? `${values.slice(0, -1).join(", ")} and ${values.at(-1)}` : values[0];
  return ` · Day ${list}`;
}

export function ChatPersonQuestion({ momentCount, sampleUris, days, chips, onPick, onTypeName, onSkip }: ChatPersonQuestionProps) {
  const roleChips = chips.includes("Type a name") ? chips.slice(0, 4) : [...chips.slice(0, 3), "Type a name"];
  return <View className="w-full flex-col gap-3">
    <Text className="text-body font-sans text-ink">One person appears in {momentCount} moments. Who is this?</Text>
    <View className="flex-row gap-2">{sampleUris.slice(0, 4).map((uri, index) => <Image key={`${uri}-${index}`} source={{ uri }} accessibilityLabel={`Person photo ${index + 1}`} resizeMode="cover" className="h-[72px] w-[72px] rounded-md" />)}</View>
    <Text className="text-caption font-sans text-ink-muted">{sampleUris.length} of {momentCount} shown{daysLabel(days)}</Text>
    <View className="flex-row flex-wrap gap-2">{roleChips.map((chip) => <FocusChip key={chip} label={chip} onPress={() => chip === "Type a name" ? onTypeName() : onPick(chip)} />)}
      <Button label="Skip" variant="quiet" size="sm" onPress={onSkip} />
    </View>
  </View>;
}
