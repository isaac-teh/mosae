import { createElement } from "react";
import { Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Asset } from "expo-asset";
import { demoImage } from "@/lib/demoAssets";
import { COLLAGE_LAYOUTS, type EditOp, type Timeline } from "@mosae/contracts";
import type { Moment } from "@mosae/core";

type Collage = Extract<Timeline["videoClips"][number], { kind: "collage" }>;
function thumbnailSource(value: string) {
  const key = value.startsWith("demo:") ? value.slice(5) : value;
  if (/^(https?:|data:)/.test(value)) return { uri: value };
  try { return { uri: Asset.fromModule(demoImage(key)).uri }; } catch { return { uri: value }; }
}
export function CollageCellSheet({ mode, clip, slotId, moments, sources = {}, uploading = false, uploadProgress, uploadError = null, onUploadFile, onSource, onApply, onClose }: {
  mode: "add" | "replace"; clip: Collage; slotId?: string; moments: Moment[]; sources?: Record<string, string>;
  uploading?: boolean; uploadProgress?: { totalFiles: number; finishedFiles: number; failedFiles: number } | null; uploadError?: string | null;
  onUploadFile?: (file: File, clipId: string, slotId: string) => void; onSource?: (shotId: string, source: string) => void;
  onApply: (op: EditOp) => void; onClose: () => void;
}) {
  const layout = COLLAGE_LAYOUTS.find((candidate) => candidate.id === clip.spec.layoutId)!;
  const activeSlot = clip.spec.slots.find((slot) => slot.slotId === slotId);
  const count = clip.spec.slots.length;
  const videoCount = clip.spec.slots.filter((slot) => slot.kind === "video").length;
  const full = mode === "add" && count >= layout.maxSlots;
  const canVideo = mode === "add" ? videoCount < layout.maxVideoCells : videoCount - Number(activeSlot?.kind === "video") < layout.maxVideoCells;
  const candidates = moments.filter((moment) => moment.shotId);
  const applyChoice = (moment: Moment) => {
    const kind = moment.kind === "video" ? "video" : "photo";
    if (mode === "add") {
      const ordinal = count + 1;
      onApply({ op: "addCollageSlot", clipId: clip.clipId, slotId: `cell:${moment.shotId}:${ordinal}`, shotId: moment.shotId!, kind });
    } else if (slotId) {
      const source = sources[moment.shotId!] ?? moment.imageKey;
      onSource?.(moment.shotId!, source);
      onApply({ op: "replaceCollageSlot", clipId: clip.clipId, slotId, shotId: moment.shotId!, kind });
    }
    onClose();
  };
  return <View className="absolute inset-0 z-30 justify-end bg-black/60"><View className="max-h-[72%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
    <View className="mb-3 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">{mode === "add" ? "Add cell" : "Replace cell"}</Text><Pressable accessibilityLabel="Close cell picker" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    {mode === "replace" && clip.spec.slots.find((slot) => slot.slotId === slotId)?.kind !== "video" && Platform.OS === "web" && onUploadFile && slotId ? <View className="mb-3 rounded-xl bg-[#1a2c38] p-3">
      <Text className="mb-2 font-sans-medium text-caption text-on-screen">Add a photo from this device</Text>
      {createElement("input", { type: "file", accept: "image/*", disabled: uploading, "aria-label": "Choose replacement cell photo", onChange: (event: { currentTarget: HTMLInputElement }) => { const file = event.currentTarget.files?.[0]; if (file) onUploadFile(file, clip.clipId, slotId); }, style: { maxWidth: "100%", color: "#e7edf0" } })}
      {uploading ? <Text accessibilityRole="progressbar" className="mt-2 font-sans text-caption text-on-screen-muted">{uploadProgress ? `Uploading ${uploadProgress.finishedFiles + uploadProgress.failedFiles} of ${uploadProgress.totalFiles}` : "Uploading and preparing photo…"}</Text> : null}
      {uploadError ? <Text accessibilityRole="alert" className="mt-2 font-sans text-caption text-critical">{uploadError}</Text> : null}
    </View> : null}
    {full ? <Text className="mb-3 font-sans text-caption text-on-screen-muted">This layout holds up to {layout.maxSlots} photos.</Text> : null}
    {candidates.length ? <ScrollView>{candidates.map((moment) => {
      const isVideo = moment.kind === "video";
      const disabled = full || (isVideo && !canVideo);
      const label = `${mode === "add" ? "Add cell" : "Replace with"} ${moment.title}`;
      return <Pressable key={`${moment.shotId}-${moment.id}`} role="button" accessibilityLabel={label} accessibilityHint={disabled && isVideo ? "This layout allows one video cell" : undefined} disabled={disabled} onPress={() => applyChoice(moment)} className={`mb-2 min-h-[68px] flex-row items-center gap-3 rounded-xl bg-[#1a2c38] px-3 ${disabled ? "opacity-40" : ""}`}>
        <Image source={thumbnailSource(moment.imageKey)} accessibilityLabel={`${moment.title} thumbnail`} className="h-12 w-12 rounded-lg" resizeMode="cover" />
        <View className="min-w-0 flex-1"><Text numberOfLines={1} className="font-sans-semibold text-button text-on-screen">{moment.title}</Text><Text className="font-sans text-caption text-on-screen-muted">{isVideo ? "Video" : "Photo"} · {moment.meta}</Text></View>
      </Pressable>;
    })}</ScrollView> : <Text className="font-sans text-caption text-on-screen-muted">No photos or videos from this trip are available.</Text>}
  </View></View>;
}
