import { useState } from "react";
import { Image, Text, View } from "react-native";
import { Button, FocusChip } from "../ds";
import { faceCropGeometry, imageSizeFromLoadEvent, type FaceBbox } from "../../lib/faceCrop";

type FacePreview = { shotId: string; uri: string; bbox: FaceBbox };
type ChatPersonQuestionProps = { momentCount: number; samples: FacePreview[]; days: number[]; chips: string[]; onPick: (role: string) => void; onTypeName: () => void; onSkip: () => void };

function FacePreviewTile({ sample, index }: { sample: FacePreview; index: number }) {
  const size = 72;
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const crop = sourceSize ? faceCropGeometry(sample.bbox, sourceSize.width, sourceSize.height, size) : null;
  return <View data-face-preview="true" className="h-[72px] w-[72px] overflow-hidden rounded-md bg-surface-sunken">
    <Image source={{ uri: sample.uri }} accessibilityLabel={`Person photo ${index + 1}`} resizeMode={crop ? "stretch" : "cover"} onLoad={(event: any) => { const dimensions = imageSizeFromLoadEvent(event); if (dimensions) setSourceSize(dimensions); }} style={crop ? { position: "absolute", width: crop.width, height: crop.height, left: crop.left, top: crop.top } : { width: size, height: size }} />
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
