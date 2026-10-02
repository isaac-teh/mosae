import { useEffect, useState, createElement } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { EditOp } from "@mosae/contracts";
import { gainDbToVolumePercent, volumePercentToGainDb } from "./musicVolume";

export function AudioVolumeSheet({ visible, audioClipId, gainDb, onApply, onClose }: {
  visible: boolean;
  audioClipId: string;
  gainDb: number;
  onApply: (op: EditOp) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(() => gainDbToVolumePercent(gainDb));
  useEffect(() => { if (visible) setValue(gainDbToVolumePercent(gainDb)); }, [visible, gainDb]);
  if (!visible) return null;
  return <View className="absolute inset-0 z-20 justify-end bg-black/55">
    <View className="rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
      <View className="mb-5 h-1 w-10 self-center rounded-full bg-[#60717c]" />
      <View className="mb-8 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Audio volume</Text><Pressable accessibilityRole="button" accessibilityLabel="Apply audio volume" onPress={() => { onApply({ op: "setMusicVolume", audioClipId, gainDb: volumePercentToGainDb(value) }); onClose(); }}><Text className="text-[22px] text-[#d5eee5]">✓</Text></Pressable></View>
      <View className="mb-5 flex-row items-center justify-between"><Text className="font-sans text-body text-on-screen-muted">Music</Text><Text accessibilityLabel={`Volume ${value} percent`} className="font-sans-semibold text-body text-on-screen">{value}%</Text></View>
      {Platform.OS === "web" ? createElement("input", { type: "range", min: 0, max: 100, step: 1, value, "aria-label": "Music volume", onInput: (event: { currentTarget: { value: string } }) => setValue(Number(event.currentTarget.value)), style: { width: "100%", accentColor: "#d5eee5" } }) : <View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Decrease music volume" onPress={() => setValue((current) => Math.max(0, current - 5))}><Text className="px-2 text-[20px] text-on-screen">−</Text></Pressable><View accessibilityLabel="Music volume slider fallback" className="h-2 flex-1 rounded-full bg-[#315c50]" /><Pressable accessibilityRole="button" accessibilityLabel="Increase music volume" onPress={() => setValue((current) => Math.min(100, current + 5))}><Text className="px-2 text-[20px] text-on-screen">+</Text></Pressable></View>}
      <View className="mt-3 flex-row items-center justify-between"><Text className="font-sans text-caption text-on-screen-muted">0%</Text><Text className="font-sans text-caption text-on-screen-muted">100%</Text></View>
    </View>
  </View>;
}
