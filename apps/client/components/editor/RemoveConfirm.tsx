import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { EditOp } from "@mosae/contracts";

export function RemoveConfirm({ clipId, onApply, onUndo }: { clipId: string; onApply: (op: EditOp) => void; onUndo: () => void }) {
  const [removed, setRemoved] = useState(false);
  return <View className="absolute inset-x-4 bottom-24 z-20 rounded-xl bg-[#1a2c38] px-4 py-3">
    {removed ? <View className="flex-row items-center justify-between"><Text className="font-sans text-caption text-on-screen">Moment removed</Text><Pressable role="button" accessibilityLabel="Undo remove" onPress={onUndo} className="rounded-full bg-accent px-3 py-2"><Text className="font-sans-semibold text-caption text-on-screen">Undo</Text></Pressable></View>
      : <View className="flex-row items-center justify-between"><Text className="flex-1 font-sans text-caption text-on-screen">Remove this moment from the film?</Text><Pressable role="button" accessibilityLabel="Remove clip" onPress={() => { onApply({ op: "remove", clipId }); setRemoved(true); }} className="ml-3 rounded-full bg-critical px-3 py-2"><Text className="font-sans-semibold text-caption text-on-screen">Remove</Text></Pressable></View>}
  </View>;
}
