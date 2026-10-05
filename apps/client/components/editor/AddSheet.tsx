import { Platform, Pressable, Text, View } from "react-native";
import { MediaGridPicker } from "./MediaGridPicker";
import { DeviceUploadControl } from "./DeviceUploadControl";
import type { EditOp } from "@mosae/contracts";
import type { Moment } from "@mosae/core";

export function AddSheet({ visible, moments, selectedClipId, playheadSec = 0, timeline, uploading = false, uploadProgress, uploadError = null, onUploadFiles, onApply, onClose }: { visible: boolean; moments: Moment[]; selectedClipId: string | null; playheadSec?: number; timeline?: import("@mosae/contracts").Timeline; uploading?: boolean; uploadProgress?: { totalFiles: number; finishedFiles: number; failedFiles: number } | null; uploadError?: string | null; onUploadFiles?: (files: File[]) => Promise<Moment[]>; onApply: (op: EditOp | EditOp[]) => void; onClose: () => void }) {
  if (!visible) return null;
  const candidates = moments.filter((moment) => moment.shotId).slice().sort((a, b) => Number(a.selected) - Number(b.selected));
  const insertTarget = () => {
    const playheadClip = timeline?.videoClips.find((clip) => playheadSec >= clip.startSec && playheadSec < clip.startSec + clip.durationSec);
    return selectedClipId ?? (playheadClip ? ("kind" in playheadClip ? playheadClip.clipId : playheadClip.id) : undefined) ?? (() => { const last = timeline?.videoClips.at(-1); return last ? ("kind" in last ? last.clipId : last.id) : null; })();
  };
  const addOps = (toAdd: Moment[]) => {
    let afterClipId = insertTarget();
    const shotCounts = new Map<string, number>();
    const ops = toAdd.map((moment): EditOp => {
      const shotId = moment.shotId!;
      const count = (shotCounts.get(shotId) ?? 0) + 1;
      shotCounts.set(shotId, count);
      const sourceInSec = moment.sourceInSec;
      const sourceOutSec = moment.sourceOutSec;
      const durationSec = moment.kind === "video" && sourceInSec !== undefined && sourceOutSec !== undefined ? Math.min(6, sourceOutSec - sourceInSec) : 3;
      const op: EditOp = { op: "add", shotId, kind: moment.kind, afterClipId, durationSec,
        ...(moment.kind === "video" && sourceInSec !== undefined && sourceOutSec !== undefined ? { sourceInSec, sourceOutSec, ...(moment.sourceDurationSec !== undefined ? { sourceDurationSec: moment.sourceDurationSec } : {}) } : {}) };
      afterClipId = `add:${shotId}:${count}`;
      return op;
    });
    onApply(ops.length === 1 ? ops[0]! : ops);
    onClose();
  };
  return <View className="absolute inset-0 z-20 justify-end bg-black/55"><View className="max-h-[72%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
    <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Add a moment</Text><Pressable accessibilityLabel="Close add" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    {Platform.OS === "web" && onUploadFiles ? <DeviceUploadControl multiple accept="image/*,video/*" uploading={uploading} uploadProgress={uploadProgress} uploadError={uploadError} onFiles={(files) => { void onUploadFiles(files).then(addOps).catch(() => undefined); }} /> : null}
    {candidates.length ? <MediaGridPicker moments={candidates} labelFor={(moment) => `Add ${moment.title}`} onSelect={(moment) => addOps([moment])} /> : <Text className="font-sans text-caption text-on-screen-muted">No photos or videos from this trip are available.</Text>}
  </View></View>;
}
