import { Platform, Pressable, Text, View } from "react-native";
import { MediaGridPicker } from "./MediaGridPicker";
import { DeviceUploadControl } from "./DeviceUploadControl";
import { COLLAGE_LAYOUTS, type EditOp, type Timeline } from "@mosae/contracts";
import type { Moment } from "@mosae/core";

type Collage = Extract<Timeline["videoClips"][number], { kind: "collage" }>;
export function CollageCellSheet({ mode, clip, slotId, moments, inFilmShotIds = new Set(), sources = {}, uploading = false, uploadProgress, uploadError = null, onUploadFile, onSource, onApply, onClose }: {
  mode: "add" | "replace"; clip: Collage; slotId?: string; moments: Moment[]; inFilmShotIds?: ReadonlySet<string>; sources?: Record<string, string>;
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
    {mode === "replace" && clip.spec.slots.find((slot) => slot.slotId === slotId)?.kind !== "video" && Platform.OS === "web" && onUploadFile && slotId ? <DeviceUploadControl uploading={uploading} uploadProgress={uploadProgress} uploadError={uploadError} onFiles={(files) => { if (files[0]) onUploadFile(files[0], clip.clipId, slotId); }} /> : null}
    {full ? <Text className="mb-3 font-sans text-caption text-on-screen-muted">This layout holds up to {layout.maxSlots} photos.</Text> : null}
    {candidates.length ? <MediaGridPicker moments={candidates} inFilmShotIds={inFilmShotIds} labelFor={(moment) => `${mode === "add" ? "Add cell" : "Replace with"} ${moment.title}`} disabled={(moment) => full || (moment.kind === "video" && !canVideo)} onSelect={applyChoice} /> : <Text className="font-sans text-caption text-on-screen-muted">No photos or videos from this trip are available.</Text>}
  </View></View>;
}
