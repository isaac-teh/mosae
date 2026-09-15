import type { ReactNode } from "react";
import { View } from "react-native";

type Props = {
  onFiles: (files: File[]) => void;
  onDraggingChange: (dragging: boolean) => void;
  className?: string;
  children: ReactNode;
};

// Native has no drag-and-drop; the child Pressable opens the picker.
export function DropZone({ className, children }: Props) {
  return <View className={className}>{children}</View>;
}
