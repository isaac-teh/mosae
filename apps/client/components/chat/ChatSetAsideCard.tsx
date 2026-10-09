import { Pressable, Text, View } from "react-native";
import { StableUriImage } from "../StableUriImage";

type Photo = { shotId: string; uri: string };
type ChatSetAsideCardProps = {
  blurryCount: number;
  blurryPhotos: Photo[];
  blurryMore: number;
  duplicateCount: number;
  duplicatePhotos: Photo[];
  duplicateMore: number;
  onOpen: () => void;
  onPhotoOpen: (photo: Photo) => void;
};

function PhotoRow({ label, count, photos, more, onPress, onPhotoPress }: { label: string; count: number; photos: Photo[]; more: number; onPress: () => void; onPhotoPress: (photo: Photo) => void }) {
  return <View className="gap-2 border-b border-line py-3 last:border-0">
    <Text className="font-sans-semibold text-label text-ink">{label} {count}</Text>
    <View className="flex-row gap-2">
      {photos.slice(0, 4).map((photo) => <Pressable key={photo.shotId} role="button" accessibilityLabel={`View ${label.toLowerCase()} photo`} onPress={() => onPhotoPress(photo)} style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })} className="active:scale-[0.97] active:bg-surface-sunken"><StableUriImage uri={photo.uri} accessibilityLabel={`${label} photo`} resizeMode="cover" className="h-16 w-16 rounded-sm" /></Pressable>)}
      {more > 0 ? <Pressable role="button" onPress={onPress} accessibilityLabel={`${more} more ${label.toLowerCase()} photos`} style={({ pressed }) => ({ opacity: pressed ? 0.8 : undefined, transform: [{ scale: pressed ? 0.97 : 1 }] })} className="active:scale-[0.97] active:bg-action-pressed h-16 w-16 items-center justify-center rounded-sm bg-surface-sunken"><Text className="font-sans-medium text-caption text-ink-muted">+{more}</Text></Pressable> : null}
    </View>
  </View>;
}

export function ChatSetAsideCard(props: ChatSetAsideCardProps) {
  return <View accessibilityLabel="Filtered photos" className="w-full rounded-md border border-line bg-surface-raised px-4">
    <PhotoRow label="Blurry" count={props.blurryCount} photos={props.blurryPhotos} more={props.blurryMore} onPress={props.onOpen} onPhotoPress={props.onPhotoOpen} />
    <PhotoRow label="Near-duplicates" count={props.duplicateCount} photos={props.duplicatePhotos} more={props.duplicateMore} onPress={props.onOpen} onPhotoPress={props.onPhotoOpen} />
  </View>;
}
