import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { formatDuration, getPendingMedia, mediaId, uploadMedia, type UploadProgress } from "@mosae/core";
import { JourneySteps, MomentTile } from "@/components/ds";
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
      router.push({ pathname: "/tell-story", params: { projectId: result.projectId, count: String(result.finished), live: "1" } } as unknown as Href);
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
    <View className="flex-1 bg-surface">
      <MediaPicker ref={pickerRef} onFiles={addFiles} />
      <ScrollView className="flex-1" contentContainerClassName="pb-28" stickyHeaderIndices={[0]}>
        <View className="z-30 bg-surface/85 shadow-[0_1px_8px_rgba(54,49,44,0.04)] backdrop-blur-md">
          <View className="h-14 flex-row items-center justify-between pl-5 pr-4">
            <Pressable role="button" onPress={() => router.push("/")}>
              <Text className="font-sans-medium text-label leading-[22px] text-action">Cancel</Text>
            </Pressable>
            <Text role="heading" aria-level={1} className="font-sans-semibold text-button tracking-[-0.35px] text-ink">
              Camera Roll
            </Text>
            <Pressable
              role="button"
              disabled={!anySelected}
              onPress={() => setItems((prev) => prev.map((p) => ({ ...p, selected: false })))}
              className="disabled:opacity-40"
            >
              <Text className="font-sans-semibold text-caption text-action">Deselect</Text>
            </Pressable>
          </View>
          <JourneySteps current={1} compact />
        </View>

        <View className="flex-row justify-center px-4 pb-2.5 pt-3.5">
          <Pressable
            role="button"
            onPress={() => pickerRef.current?.open()}
            className="flex-row items-center gap-1 rounded-full border border-line bg-surface-sunken px-[13px] py-[5px]"
          >
            <Text className="font-sans-semibold text-caption text-ink">{items.length ? "Your Memories" : "Add Memories"}</Text>
            {items.length > 0 && <Text className="font-sans text-[11px] leading-[14px] text-ink-muted">({items.length})</Text>}
            <ChevronDownIcon />
          </Pressable>
        </View>

        {items.length === 0 ? (
          <Pressable
            role="button"
            onPress={() => pickerRef.current?.open()}
            className="mx-4 mt-2 h-[260px] items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface-sunken"
          >
            <Text className="text-center font-sans-semibold text-button text-ink">Pick photos & videos</Text>
            <Text className="max-w-[240px] text-center font-sans text-caption leading-[18px] text-ink-muted">
              Choose the moments from your trip, celebration, or everyday life.
            </Text>
          </Pressable>
        ) : (
          <View className="flex-row flex-wrap gap-0.5">
            {items.map((item) => (
              <MomentTile
                key={item.id}
                label={item.file.name}
                role="checkbox"
                selected={item.selected}
                clip={item.isVideo}
                duration={item.duration}
                showCaption={false}
                onPress={() => toggle(item.id)}
                className="w-[calc((100%-4px)/3)] max-w-none"
              >
                <View className="absolute inset-0">
                  <MediaThumb file={item.file} isVideo={item.isVideo} onDuration={(seconds) => setDuration(item.id, seconds)} />
                </View>
                {!item.selected ? <View className="absolute inset-0 bg-surface/40" /> : null}
                {item.isVideo ? <View className="absolute bottom-1.5 left-1.5 rounded-pill bg-scrim/60 p-1"><PlayIcon /></View> : null}
              </MomentTile>
            ))}
          </View>
        )}
      </ScrollView>

      <View className="absolute inset-x-0 bottom-8 z-30 px-4">
        <View className="flex-row items-center justify-between rounded-full border border-line bg-surface/90 p-[11px] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.1)] backdrop-blur-md">
          <View className="min-w-0 flex-1 pl-3 pr-2">
            <Text numberOfLines={1} className="font-sans-semibold text-caption text-ink">
              {status}
            </Text>
            <Text numberOfLines={1} className="font-sans text-caption leading-[18px] text-ink-muted">
              {photoCount} {photoCount === 1 ? "photo" : "photos"}, {videoCount} {videoCount === 1 ? "video" : "videos"}
            </Text>
          </View>
          <Pressable
            role="button"
            disabled={!anySelected || uploading}
            onPress={handleNext}
            className="flex-row items-center gap-1.5 rounded-full bg-action px-6 py-3 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] disabled:opacity-50"
          >
            <Text className="font-sans-semibold text-button text-on-action">Next</Text>
            <ArrowRightIcon />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
