import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { faceCropGeometry, imageSizeFromLoadEvent, type FaceBbox } from "../../lib/faceCrop";
import { StableUriImage } from "../StableUriImage";

type FacePreview = { shotId: string; uri: string; bbox: FaceBbox };
type ChatPersonQuestionProps = { samples: FacePreview[]; question?: string };

function FacePreviewTile({ sample, index, size = 72, rounded = false, onPress }: { sample: FacePreview; index: number; size?: number; rounded?: boolean; onPress?: (uri: string) => void }) {
  const Tile = onPress ? Pressable : View;
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const crop = sourceSize ? faceCropGeometry(sample.bbox, sourceSize.width, sourceSize.height, size) : null;
  return <Tile data-face-preview="true" accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={onPress ? `Open person photo ${index + 1}` : undefined} accessibilityHint={onPress ? "Opens a clearer view of this photo" : undefined} onPress={onPress ? () => onPress(sample.uri) : undefined} className={`overflow-hidden bg-surface-sunken ${rounded ? "rounded-full" : "rounded-md"}`} style={{ width: size, height: size }}>
    <StableUriImage uri={sample.uri} accessibilityLabel={`Person photo ${index + 1}`} resizeMode={crop ? "stretch" : "cover"} onLoad={(event: any) => {
      // The crop restyles the image, which fires onLoad again on web; measure once.
      if (sourceSize) return;
      const dimensions = imageSizeFromLoadEvent(event);
      if (dimensions) setSourceSize(dimensions);
      else Image.getSize(sample.uri, (width, height) => setSourceSize((current) => current ?? { width, height }), () => {});
    }} style={crop ? { position: "absolute", width: crop.width, height: crop.height, left: crop.left, top: crop.top } : { width: size, height: size }} />
  </Tile>;
}

export function FacePreviewStrip({ samples, limit = 4, size, rounded = false, onSamplePress }: { samples: FacePreview[]; limit?: number; size?: number; rounded?: boolean; onSamplePress?: (uri: string) => void }) {
  return <View className="flex-row gap-2">{samples.slice(0, limit).map((sample, index) => <FacePreviewTile key={`${sample.shotId}-${index}`} sample={sample} index={index} size={size} rounded={rounded} onPress={onSamplePress} />)}</View>;
}

export function ChatPersonQuestion({ samples, question, onSamplePress }: ChatPersonQuestionProps & { onSamplePress?: (uri: string) => void }) {
  return <View className="w-full flex-col gap-3">
    <Text className="text-body font-sans text-ink">{question ?? "Who is this?"}</Text>
    <FacePreviewStrip samples={samples.slice(0, 1)} size={160} onSamplePress={onSamplePress} />
  </View>;
}
