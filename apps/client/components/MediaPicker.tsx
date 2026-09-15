import { forwardRef, useImperativeHandle } from "react";
import { Alert } from "react-native";

export type MediaPickerHandle = { open: () => void };

// Native photo library picking (expo-image-picker) arrives with the iOS and Android apps.
export const MediaPicker = forwardRef<
  MediaPickerHandle,
  { onFiles: (files: File[]) => void }
>(function MediaPicker(_props, ref) {
  useImperativeHandle(
    ref,
    () => ({
      open: () =>
        Alert.alert(
          "Coming soon",
          "Uploading from this device is coming soon.",
        ),
    }),
    [],
  );
  return null;
});
