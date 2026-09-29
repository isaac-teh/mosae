import { Image, Text, View } from "react-native";
import { Button, FocusChip } from "../ds";

type FacePreview = { shotId: string; uri: string; bbox: [number, number, number, number] };
type ChatPersonQuestionProps = { momentCount: number; samples: FacePreview[]; days: number[]; chips: string[]; onPick: (role: string) => void; onTypeName: () => void; onSkip: () => void };

function FacePreviewTile({ sample, index }: { sample: FacePreview; index: number }) {
  const size = 72;
  const [ymin, xmin, ymax, xmax] = sample.bbox;
  const half = Math.max((xmax - xmin) * 0.8, (ymax - ymin) * 0.8, 0.02) / 2;
  const scaled = size / (2 * half);
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  return <View data-face-preview="true" className="h-[72px] w-[72px] overflow-hidden rounded-md bg-surface-sunken">
    <Image source={{ uri: sample.uri }} accessibilityLabel={`Person photo ${index + 1}`} resizeMode="cover" style={{ width: scaled, height: scaled, marginLeft: -(cx * scaled - size / 2), marginTop: -(cy * scaled - size / 2) }} />
  </View>;
}

function daysLabel(days: number[]): string {
  if (!days.length) return "";
  const values = days.map(String);
  const list = values.length > 1 ? `${values.slice(0, -1).join(", ")} and ${values.at(-1)}` : values[0];
  return ` · Day ${list}`;
}

export function ChatPersonQuestion({ momentCount, samples, days, chips, onPick, onTypeName, onSkip }: ChatPersonQuestionProps) {
  const roleChips = chips.includes("Type a name") ? chips.slice(0, 4) : [...chips.slice(0, 3), "Type a name"];
  return <View className="w-full flex-col gap-3">
    <Text className="text-body font-sans text-ink">One person appears in {momentCount} moments. Who is this?</Text>
    <View className="flex-row gap-2">{samples.slice(0, 4).map((sample, index) => <FacePreviewTile key={`${sample.shotId}-${index}`} sample={sample} index={index} />)}</View>
    <Text className="text-caption font-sans text-ink-muted">{Math.min(samples.length, 4)} of {momentCount} shown{daysLabel(days)}</Text>
    <View className="flex-row flex-wrap gap-2">{roleChips.map((chip) => <FocusChip key={chip} label={chip} onPress={() => chip === "Type a name" ? onTypeName() : onPick(chip)} />)}
      <Button label="Skip" variant="quiet" size="sm" onPress={onSkip} />
    </View>
  </View>;
}
