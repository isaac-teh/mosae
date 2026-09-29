import { Pressable, ScrollView, Text, View } from "react-native";
import type { EditOp } from "@mosae/contracts";
import type { Soundtrack } from "@mosae/core";

export function SoundtrackSheet({ visible, soundtracks, onApply, onClose }: { visible: boolean; soundtracks: Soundtrack[]; onApply: (op: EditOp) => void; onClose: () => void }) {
  if (!visible) return null;
  return <View className="absolute inset-0 z-20 justify-end bg-black/55"><View className="max-h-[72%] rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
    <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Soundtrack</Text><Pressable accessibilityLabel="Close soundtrack" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
    <ScrollView>{soundtracks.map((track) => <Pressable key={track.id} role="button" accessibilityLabel={`Choose ${track.name}`} onPress={() => { onApply({ op: "setSoundtrack", soundtrackId: track.id }); onClose(); }} className="mb-2 min-h-[68px] justify-center rounded-xl bg-[#1a2c38] px-4"><Text className="font-sans-semibold text-button text-on-screen">{track.name}</Text><Text className="font-sans text-caption text-on-screen-muted">{track.description}</Text></Pressable>)}</ScrollView>
  </View></View>;
}
