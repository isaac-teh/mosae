import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { EditOp, Timeline } from "@mosae/contracts";

type Clip = Timeline["videoClips"][number];
export function TrimControl({ clip, onApply, onClose }: { clip: Clip; onApply: (op: EditOp) => boolean | void; onClose: () => void }) {
  const photo = "source" in clip && clip.source.kind === "photo";
  const videoSource = "source" in clip && clip.source.kind === "video" ? clip.source : null;
  const video = videoSource !== null;
  const [duration, setDuration] = useState(clip.durationSec);
  const [inSec, setInSec] = useState(videoSource?.sourceInSec ?? 0);
  const [outSec, setOutSec] = useState(videoSource?.sourceOutSec ?? clip.durationSec);
  const [message, setMessage] = useState<string | null>(null);
  const id = "kind" in clip ? clip.clipId : clip.id;
  return <View className="absolute inset-0 z-20 justify-end bg-black/55">
    <View className="rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
      <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Trim clip</Text><Pressable accessibilityLabel="Close trim" onPress={onClose}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
      {photo ? <><Text className="mb-3 font-sans text-caption text-on-screen-muted">Photo length · 2–6 seconds</Text><View className="flex-row justify-between">{[2, 3, 4, 5, 6].map((sec) => <Pressable key={sec} role="button" accessibilityLabel={`Photo duration ${sec} seconds`} aria-pressed={duration === sec} accessibilityState={{ selected: duration === sec }} onPress={() => { if (onApply({ op: "setPhotoDuration", clipId: id, sec }) === false) { setMessage("That change couldn’t be applied. Try another edit."); return; } setMessage(null); setDuration(sec); }} className={`min-h-12 min-w-12 items-center justify-center rounded-full ${duration === sec ? "bg-accent" : "bg-[#203542]"}`}><Text className="font-sans text-button text-on-screen">{sec}s</Text></Pressable>)}</View>{message ? <Text accessibilityRole="alert" className="mt-3 font-sans text-caption text-on-screen">{message}</Text> : null}</> 
        : video ? <><Text className="mb-3 font-sans text-caption text-on-screen-muted">Source time · keep at least one second</Text><View className="mb-4 flex-row gap-3"><View className="flex-1"><Text className="mb-1 font-sans text-caption text-on-screen-muted">In</Text><TextInput accessibilityLabel="Source in" keyboardType="numeric" value={String(inSec)} onChangeText={(value) => setInSec(Number(value))} className="h-12 rounded-lg bg-[#203542] px-3 text-on-screen" /></View><View className="flex-1"><Text className="mb-1 font-sans text-caption text-on-screen-muted">Out</Text><TextInput accessibilityLabel="Source out" keyboardType="numeric" value={String(outSec)} onChangeText={(value) => setOutSec(Number(value))} className="h-12 rounded-lg bg-[#203542] px-3 text-on-screen" /></View></View><Pressable role="button" accessibilityLabel="Apply trim" disabled={outSec - inSec < 1} onPress={() => { if (onApply({ op: "trim", clipId: id, inSec, outSec }) !== false) onClose(); }} className="min-h-12 items-center justify-center rounded-full bg-accent"><Text className="font-sans-semibold text-button text-on-screen">Apply trim</Text></Pressable>{message ? <Text accessibilityRole="alert" className="mt-3 font-sans text-caption text-on-screen">{message}</Text> : null}</>
        : <Text className="font-sans text-caption text-on-screen-muted">Only photos and video clips can be trimmed.</Text>}
    </View>
  </View>;
}
