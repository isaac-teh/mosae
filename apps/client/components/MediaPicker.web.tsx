import { forwardRef, useImperativeHandle, useRef } from "react";

export type MediaPickerHandle = { open: () => void };

/** Hidden browser file input. The accept list and multi-select match the Next.js app. */
export const MediaPicker = forwardRef<
  MediaPickerHandle,
  { onFiles: (files: File[]) => void }
>(function MediaPicker({ onFiles }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(
    ref,
    () => ({ open: () => inputRef.current?.click() }),
    [],
  );
  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept="image/*,video/*"
      style={{ display: "none" }}
      onChange={(e) => {
        onFiles(Array.from(e.target.files ?? []));
        e.target.value = "";
      }}
    />
  );
});
