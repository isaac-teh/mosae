import { Pressable, ScrollView, Text, View } from "react-native";
import type { EditOp } from "@mosae/contracts";
import type { Moment } from "@mosae/core";

export function AddSheet({ visible, moments, selectedClipId, onApply, onClose }: { visible: boolean; moments: Moment[]; selectedClipId: string | null; onApply: (op: EditOp) => void; onClose: () => void }) {
  if (!visible) return null;
  const candidates = moments.filter((moment) => !moment.selected && moment.shotId);
  return <View className="absolute inset-0 z-20 justify-end bg-black/55"><View className="max-h-[72%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
    <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Add a moment</Text><Pressable accessibilityLabel="Close add" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    {candidates.length ? <ScrollView>{candidates.map((moment) => <Pressable key={moment.id} role="button" accessibilityLabel={`Add ${moment.title}`} onPress={() => {
      const sourceInSec = moment.sourceInSec;
      const sourceOutSec = moment.sourceOutSec;
      const durationSec = moment.kind === "video" && sourceInSec !== undefined && sourceOutSec !== undefined ? Math.min(6, sourceOutSec - sourceInSec) : 3;
      onApply({ op: "add", shotId: moment.shotId!, kind: moment.kind, afterClipId: selectedClipId, durationSec,
        ...(moment.kind === "video" && sourceInSec !== undefined && sourceOutSec !== undefined ? { sourceInSec, sourceOutSec } : {}) });
      onClose();
    }} className="mb-2 min-h-[60px] justify-center rounded-xl bg-[#1a2c38] px-4"><Text className="font-sans-semibold text-button text-on-screen">{moment.title}</Text><Text className="font-sans text-caption text-on-screen-muted">{moment.meta}</Text></Pressable>)}</ScrollView> : <Text className="font-sans text-caption text-on-screen-muted">No left out moments to add.</Text>}
  </View></View>;
}
