import { Pressable, Text, View } from "react-native";
import { MediaGridPicker } from "./MediaGridPicker";
import type { EditOp } from "@mosae/contracts";
import type { Moment } from "@mosae/core";

export function AddSheet({ visible, moments, selectedClipId, playheadSec = 0, timeline, onApply, onClose }: { visible: boolean; moments: Moment[]; selectedClipId: string | null; playheadSec?: number; timeline?: import("@mosae/contracts").Timeline; onApply: (op: EditOp) => void; onClose: () => void }) {
  if (!visible) return null;
  const candidates = moments.filter((moment) => moment.shotId).slice().sort((a, b) => Number(a.selected) - Number(b.selected));
  return <View className="absolute inset-0 z-20 justify-end bg-black/55"><View className="max-h-[72%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
    <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Add a moment</Text><Pressable accessibilityLabel="Close add" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    {candidates.length ? <MediaGridPicker moments={candidates} labelFor={(moment) => `Add ${moment.title}`} onSelect={(moment) => {
      const playheadClip = timeline?.videoClips.find((clip) => playheadSec >= clip.startSec && playheadSec < clip.startSec + clip.durationSec);
      const insertTarget = selectedClipId ?? (playheadClip ? ("kind" in playheadClip ? playheadClip.clipId : playheadClip.id) : undefined) ?? (() => { const last = timeline?.videoClips.at(-1); return last ? ("kind" in last ? last.clipId : last.id) : null; })();
      const afterClipId = insertTarget;
      const sourceInSec = moment.sourceInSec;
      const sourceOutSec = moment.sourceOutSec;
      const durationSec = moment.kind === "video" && sourceInSec !== undefined && sourceOutSec !== undefined ? Math.min(6, sourceOutSec - sourceInSec) : 3;
      onApply({ op: "add", shotId: moment.shotId!, kind: moment.kind, afterClipId, durationSec,
        ...(moment.kind === "video" && sourceInSec !== undefined && sourceOutSec !== undefined ? { sourceInSec, sourceOutSec, ...(moment.sourceDurationSec !== undefined ? { sourceDurationSec: moment.sourceDurationSec } : {}) } : {}) });
      onClose();
    }} /> : <Text className="font-sans text-caption text-on-screen-muted">No photos or videos from this trip are available.</Text>}
  </View></View>;
}
