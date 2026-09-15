import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { formatDuration, getPendingMedia, mediaId, uploadMedia, type UploadProgress } from "@mosae/core";
import { StepProgress } from "@/components/StepProgress";
import { MediaPicker, type MediaPickerHandle } from "@/components/MediaPicker";
import { MediaThumb } from "@/components/MediaThumb";
import { ArrowRightIcon, CheckIcon, ChevronDownIcon, PlayIcon } from "@/components/icons";

type Picked = { id: string; file: File; isVideo: boolean; duration?: string; selected: boolean };

function toPicked(files: File[]): Picked[] {
  return files.map((file) => ({ id: mediaId(file), file, isVideo: file.type.startsWith("video/"), selected: true }));
}

// Figma: "Pick the Memory - Camera Roll" (1:128)
export default function PickMemoryScreen() {
  const [items, setItems] = useState<Picked[]>(() => toPicked(getPendingMedia()));
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<MediaPickerHandle>(null);
  const router = useRouter();

  function addFiles(files: File[]) {
    const next = toPicked(files);
    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...next.filter((n) => !seen.has(n.id))];
    });
  }

  function setDuration(id: string, seconds: number) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, duration: formatDuration(seconds) } : p)));
  }

  function toggle(id: string) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)));
  }

  const selected = items.filter((i) => i.selected);
  const videoCount = selected.filter((i) => i.isVideo).length;
  const photoCount = selected.length - videoCount;
  const anySelected = selected.length > 0;

  async function handleNext() {
    if (!anySelected) return;
    setUploading(true);
    setProgress(null);
    setError(null);
    try {
      const result = await uploadMedia(
        selected.map((i) => i.file),
        { mode: "memory", onProgress: setProgress },
      );
      if (result.finished === 0) {
        setError("Upload failed. Please try again.");
        setUploading(false);
        return;
      }
      router.push({ pathname: "/tell-story", params: { projectId: result.projectId, count: String(result.finished) } } as unknown as Href);
    } catch (e) {
      console.error("upload failed", e);
      setError("Upload failed. Please try again.");
      setUploading(false);
    }
  }

  const status =
    error ??
    (uploading
      ? progress
        ? `Uploading ${progress.finishedFiles + progress.failedFiles} of ${progress.totalFiles}`
        : "Uploading..."
      : `${selected.length} selected`);

  return (
    <View className="flex-1 bg-canvas">
      <MediaPicker ref={pickerRef} onFiles={addFiles} />
      <ScrollView className="flex-1" contentContainerClassName="pb-28" stickyHeaderIndices={[0]} style={{ overflow: "visible" }}>
        <View className="z-30 bg-canvas/85 shadow-[0_1px_8px_rgba(54,49,44,0.04)] backdrop-blur-md">
          <View className="h-14 flex-row items-center justify-between pl-5 pr-4">
            <Pressable role="button" onPress={() => router.push("/")}>
              <Text className="font-sans-medium text-sm leading-[22px] text-brand">Cancel</Text>
            </Pressable>
            <Text role="heading" aria-level={1} className="font-sans-bold text-sm tracking-[-0.35px] text-ink">
              Camera Roll
            </Text>
            <Pressable
              role="button"
              disabled={!anySelected}
              onPress={() => setItems((prev) => prev.map((p) => ({ ...p, selected: false })))}
              className="disabled:opacity-40"
            >
              <Text className="font-sans-semibold text-xs text-brand">Deselect</Text>
            </Pressable>
          </View>
          <StepProgress value={1 / 3} />
        </View>

        <View className="flex-row justify-center px-4 pb-2.5 pt-3.5">
          <Pressable
            role="button"
            onPress={() => pickerRef.current?.open()}
            className="flex-row items-center gap-1 rounded-full border border-line bg-surface-muted px-[13px] py-[5px]"
          >
            <Text className="font-sans-semibold text-xs text-ink">{items.length ? "Your Memories" : "Add Memories"}</Text>
            {items.length > 0 && <Text className="font-sans text-[11px] leading-[14px] text-ink-soft">({items.length})</Text>}
            <ChevronDownIcon />
          </Pressable>
        </View>

        {items.length === 0 ? (
          <Pressable
            role="button"
            onPress={() => pickerRef.current?.open()}
            className="mx-4 mt-2 h-[260px] items-center justify-center gap-2 rounded-2xl border border-dashed border-brand-dot bg-surface-muted"
          >
            <Text className="text-center font-sans-semibold text-sm text-ink">Pick photos & videos</Text>
            <Text className="max-w-[240px] text-center font-sans text-xs leading-[18px] text-ink-soft">
              Choose the moments from your trip, celebration, or everyday life.
            </Text>
          </Pressable>
        ) : (
          <View className="flex-row flex-wrap gap-0.5">
            {items.map((item) => (
              <Pressable
                role="button"
                key={item.id}
                aria-label={item.file.name}
                aria-pressed={item.selected}
                onPress={() => toggle(item.id)}
                className="relative aspect-square w-[calc((100%-4px)/3)] overflow-hidden bg-surface-sunken"
              >
                <MediaThumb file={item.file} isVideo={item.isVideo} onDuration={(s) => setDuration(item.id, s)} />

                {!item.selected && <View className="absolute inset-0 bg-canvas/40" />}

                {item.isVideo && item.duration && (
                  <View className="absolute bottom-1.5 left-1.5 flex-row items-center gap-0.5 rounded-2xl bg-[rgba(49,48,45,0.75)] px-1.5 py-0.5 backdrop-blur-[2px]">
                    <PlayIcon />
                    <Text className="font-sans text-[10px] leading-[14px] text-white">{item.duration}</Text>
                  </View>
                )}

                {item.selected ? (
                  <View className="absolute bottom-1.5 right-1.5 size-5 items-center justify-center rounded-full bg-brand shadow-md">
                    <CheckIcon />
                  </View>
                ) : (
                  <View className="absolute bottom-1.5 right-1.5 size-5 rounded-full border-2 border-white/90 bg-black/10" />
                )}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <View className="absolute inset-x-0 bottom-8 z-30 px-5">
        <View className="flex-row items-center justify-between rounded-full border border-line bg-canvas/90 p-[11px] shadow-xl backdrop-blur-md">
          <View className="min-w-0 flex-1 pl-3 pr-2">
            <Text numberOfLines={1} className="font-sans-semibold text-xs text-ink">
              {status}
            </Text>
            <Text numberOfLines={1} className="font-sans text-xs leading-[18px] text-ink-soft">
              {photoCount} {photoCount === 1 ? "photo" : "photos"}, {videoCount} {videoCount === 1 ? "video" : "videos"}
            </Text>
          </View>
          <Pressable
            role="button"
            disabled={!anySelected || uploading}
            onPress={handleNext}
            className="flex-row items-center gap-1.5 rounded-full bg-brand px-6 py-3 shadow-md disabled:opacity-50"
          >
            <Text className="font-sans-semibold text-sm text-white">Next</Text>
            <ArrowRightIcon />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
