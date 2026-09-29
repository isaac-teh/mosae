import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { EditOp } from "@mosae/contracts";

export function EditorMenu({ onReset }: { onReset: (ops: EditOp[]) => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return <View className="relative">
    <Pressable role="button" accessibilityLabel="More editor actions" onPress={() => setOpen((value) => !value)} className="min-h-11 min-w-11 items-end justify-center"><Text className="text-[24px] text-on-screen">…</Text></Pressable>
    {open ? <View className="absolute right-0 top-12 z-30 min-w-48 rounded-xl bg-[#1a2c38] p-2">{confirm ? <><Text className="px-2 py-2 font-sans text-caption text-on-screen">Discard edits and return to the first cut?</Text><Pressable role="button" accessibilityLabel="Confirm back to first cut" onPress={() => { onReset([]); setConfirm(false); setOpen(false); }} className="rounded-lg bg-critical px-3 py-2"><Text className="font-sans-semibold text-caption text-on-screen">Back to first cut</Text></Pressable></> : <Pressable role="button" accessibilityLabel="Back to first cut" onPress={() => setConfirm(true)} className="rounded-lg px-3 py-2"><Text className="font-sans text-caption text-on-screen">Back to first cut</Text></Pressable>}</View> : null}
  </View>;
}
