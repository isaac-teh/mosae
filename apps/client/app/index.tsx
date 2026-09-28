import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { isMedia, setPendingMedia } from "@mosae/core";
import { Logo } from "@/components/Logo";
import { LandingGlow } from "@/components/LandingGlow";
import { DropZone } from "@/components/DropZone";
import { MediaPicker, type MediaPickerHandle } from "@/components/MediaPicker";
import { ShieldIcon, SparklesIcon } from "@/components/icons";

const STEPS = [
  { emoji: "🖼️", title: "Pick your moments", body: "Photos and videos from a trip, a birthday, or an ordinary Sunday." },
  { emoji: "✍️", title: "Tell the story", body: "Say what matters. Mosaé finds the moments that match." },
  { emoji: "🎬", title: "Get your film", body: "Gemini directs pacing, music, and cuts into a keepsake film." },
];

export default function Home() {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<MediaPickerHandle>(null);
  const router = useRouter();

  function start(list: File[]) {
    const files = list.filter(isMedia);
    if (files.length === 0) {
      setError("Please choose photos or videos.");
      return;
    }
    setPendingMedia(files);
    router.push("/pick-memory" as Href);
  }

  return (
    <View className="flex-1 bg-surface">
      <MediaPicker ref={pickerRef} onFiles={start} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="relative overflow-hidden pb-32"
        style={{ overflow: "visible" }}
      >
        <LandingGlow />
        <View className="relative h-14 flex-row items-center justify-between px-4"><Logo /><View className="rounded-full bg-surface-sunken px-3 py-1"><Text className="font-sans-semibold text-[11px] uppercase leading-[14px] tracking-[0.55px] text-ink-muted">Beta</Text></View></View>
        <View className="relative px-4 pt-6">
          <Text className="font-sans-semibold text-[11px] uppercase leading-[14px] tracking-[0.55px] text-accent">Your memories, directed</Text>
          <Text role="heading" aria-level={1} className="mt-3 font-title text-[36px] leading-[40px] tracking-[-0.5px] text-ink">Turn your photos into a film <Text className="font-sans text-action">worth keeping.</Text></Text>
          <Text className="mt-3 font-sans text-body leading-[22.75px] text-ink-muted">Upload the moments you love, tell Mosaé what they mean, and get an heirloom-quality short film made from your own photos and videos.</Text>
        </View>
        <View className="relative px-4 pt-7">
          <DropZone onFiles={start} onDraggingChange={setDragging}>
            <Pressable role="button" onPress={() => pickerRef.current?.open()} className={`group w-full items-center rounded-3xl border-2 border-dashed px-6 pb-7 pt-8 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] ${dragging ? "border-action bg-ink-tint/40" : "border-line-strong bg-surface"}`}>
              <View aria-hidden className="relative mb-5 h-[92px] w-[150px] items-center justify-center"><View className="absolute left-1 top-3 h-[72px] w-[58px] -rotate-12 rounded-xl bg-accent/20 shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]" /><View className="absolute right-1 top-3 h-[72px] w-[58px] rotate-12 rounded-xl bg-ink-tint shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]" /><View className="relative h-[84px] w-[66px] items-center justify-center rounded-xl bg-action shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1),0_4px_6px_-4px_rgba(0,0,0,0.1)] group-hover:-translate-y-1"><Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 16V4" /><Path d="m6 10 6-6 6 6" /><Path d="M4 20h16" /></Svg></View></View>
              <Text className="text-center font-title text-[22px] leading-[28px] text-ink">{dragging ? "Drop to start" : "Upload photos & videos"}</Text><Text className="mt-1 text-center font-sans text-caption leading-[18px] text-ink-muted">Drag them here, or tap to browse your library</Text><View className="mt-4 rounded-full bg-surface-sunken px-3 py-1"><Text className="font-sans-medium text-[11px] leading-[14px] text-ink-muted">JPG · PNG · HEIC · MP4 · MOV</Text></View>
            </Pressable>
          </DropZone>
          {error && <Text role="alert" className="mt-3 text-center font-sans text-caption text-action">{error}</Text>}
        </View>
        <View className="relative px-4 pt-9"><Text role="heading" aria-level={2} className="font-sans-medium text-caption text-ink-muted">How it works</Text><View role="list" className="mt-3 flex-col gap-2">{STEPS.map((step, i) => <View role="listitem" key={step.title} className="flex-row items-start gap-3 rounded-2xl bg-surface-sunken p-4"><View className="size-10 shrink-0 items-center justify-center rounded-full bg-surface shadow-sm"><Text className="text-lg">{step.emoji}</Text></View><View className="min-w-0 flex-1"><Text className="font-sans-semibold text-[11px] uppercase leading-[14px] tracking-[0.55px] text-ink-muted">Step {i + 1}</Text><Text className="mt-0.5 font-sans text-[17px] leading-[22px] text-ink">{step.title}</Text><Text className="mt-0.5 font-sans text-caption leading-[18px] text-ink-muted">{step.body}</Text></View></View>)}</View></View>
        <View className="relative mt-6 flex-row items-center justify-center gap-1 px-4"><ShieldIcon /><Text className="font-sans text-caption leading-[18px] text-ink-muted/80">Your memories stay private to your account.</Text></View>
      </ScrollView>
      <View className="absolute inset-x-0 bottom-0 z-30 px-4 pb-8 pt-6">
        <LinearGradient
          colors={["rgba(252,249,244,0)", "rgba(252,249,244,0.95)", "rgb(var(--color-surface))"]}
          locations={[0, 0.5, 1]}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none" }}
        />
        <Pressable role="button" onPress={() => pickerRef.current?.open()} className="h-14 w-full flex-row items-center justify-center gap-1.5 rounded-full bg-action shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.1)]"><SparklesIcon /><Text className="font-sans-medium text-label tracking-[0.35px] text-on-action">Start with your memories</Text></Pressable>
      </View>
    </View>
  );
}
