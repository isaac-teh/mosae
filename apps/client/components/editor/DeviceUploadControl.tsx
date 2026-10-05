import { createElement, useRef } from "react";
import { Pressable, Text, View } from "react-native";

/** A styled phone photo picker shared by the editor's media sheets. */
export function DeviceUploadControl({ onFiles, multiple = false, accept = "image/*", uploading = false, uploadProgress, uploadError = null }: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  uploading?: boolean;
  uploadProgress?: { totalFiles: number; finishedFiles: number; failedFiles: number } | null;
  uploadError?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <View className="mb-3 rounded-xl bg-[#1a2c38] p-3">
    <Pressable accessibilityRole="button" accessibilityLabel="Upload from phone" disabled={uploading} onPress={() => input.current?.click()} style={{ minHeight: 48 }} className="h-[48px] flex-row items-center justify-center gap-2 rounded-xl bg-[#263c49] px-4">
      <Text className="font-sans-semibold text-button text-on-screen">＋</Text>
      <Text className="font-sans-semibold text-button text-on-screen">Upload from phone</Text>
    </Pressable>
    {createElement("input", { ref: input, type: "file", accept, multiple, disabled: uploading, "aria-label": "Choose files from phone", onChange: (event: { currentTarget: HTMLInputElement }) => {
      const files = Array.from(event.currentTarget.files ?? []);
      if (files.length) onFiles(files);
      event.currentTarget.value = "";
    }, style: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 } })}
    {uploading ? <Text accessibilityRole="progressbar" className="mt-2 font-sans text-caption text-on-screen-muted">{uploadProgress ? `Uploading ${uploadProgress.finishedFiles + uploadProgress.failedFiles} of ${uploadProgress.totalFiles}` : "Uploading and preparing media…"}</Text> : null}
    {uploadError ? <Text accessibilityRole="alert" className="mt-2 font-sans text-caption text-critical">{uploadError}</Text> : null}
  </View>;
}
