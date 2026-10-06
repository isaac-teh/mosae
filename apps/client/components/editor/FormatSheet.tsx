import { Pressable, Text, View } from "react-native";
import type { EditOp, Timeline } from "@mosae/contracts";

export function FormatSheet({ visible, aspect, onApply, onClose }: { visible: boolean; aspect: Timeline["aspect"]; onApply: (op: EditOp) => void; onClose: () => void }) {
  if (!visible) return null;
  const choose = (next: Timeline["aspect"]) => { if (next !== aspect) onApply({ op: "setAspect", aspect: next }); onClose(); };
  return <View className="absolute inset-0 z-20 justify-end bg-black/55">
    <View className="rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
      <View className="mb-5 h-1 w-10 self-center rounded-full bg-[#60717c]" />
      <View className="mb-5 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Format</Text><Pressable accessibilityRole="button" accessibilityLabel="Close format" onPress={onClose}><Text className="text-[22px] text-on-screen-muted">×</Text></Pressable></View>
      {([ ["9:16", "📱 TikTok / Reels style (vertical)"], ["16:9", "🖥️ YouTube style (horizontal)"] ] as const).map(([value, label]) => <Pressable key={value} role="button" accessibilityLabel={label} accessibilityState={{ selected: aspect === value }} onPress={() => choose(value)} className={`mb-3 rounded-full p-4 ${aspect === value ? "bg-[#315c50]" : "bg-[#1c2c36]"}`}><Text className="text-center font-sans-medium text-button text-on-screen">{label}{aspect === value ? " (current)" : ""}</Text></Pressable>)}
    </View>
  </View>;
}
