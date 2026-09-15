import { View } from "react-native";

type Props = {
  file: File;
  isVideo: boolean;
  onDuration: (seconds: number) => void;
};

// Native thumbnails come from the photo library asset URI in the iOS and Android apps.
export function MediaThumb(_props: Props) {
  return <View className="size-full bg-surface-sunken" />;
}
