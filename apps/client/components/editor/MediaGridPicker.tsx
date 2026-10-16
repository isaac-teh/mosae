import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useState } from "react";
import type { Moment } from "@mosae/core";
import { Asset } from "expo-asset";
import { demoImage } from "@/lib/demoAssets";

export function MediaGridPicker({ moments, selectedShotId, currentShotId, inCollageShotIds = new Set(), inFilmShotIds = new Set(), disabled = () => false, labelFor, tagsFor, onSelect }: {
  moments: Moment[]; selectedShotId?: string | null; currentShotId?: string | null; inCollageShotIds?: ReadonlySet<string>; inFilmShotIds?: ReadonlySet<string>; disabled?: (moment: Moment) => boolean;
  labelFor: (moment: Moment) => string; tagsFor?: (moment: Moment) => string[]; onSelect: (moment: Moment) => void;
}) {
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const source = (value: string) => {
    if (!value.startsWith("demo:")) return { uri: value };
    try { return { uri: Asset.fromModule(demoImage(value.slice(5))).uri }; } catch { return { uri: value }; }
  };
  const unique = currentShotId ? [...new Map(moments.map(moment => [moment.shotId ?? moment.id, moment])).values()] : moments;
  const ordered = [...unique.filter(moment => moment.shotId === currentShotId), ...unique.filter(moment => moment.shotId !== currentShotId)];
  return <ScrollView><View className="flex-row flex-wrap gap-2">{ordered.map(moment => {
    const current = Boolean(currentShotId && moment.shotId === currentShotId);
    const selected = current || moment.shotId === selectedShotId;
    const imageFailed = failedImages.has(`${moment.shotId ?? moment.id}:${moment.imageKey}`);
    const video = moment.kind === "video";
    return <Pressable key={`${moment.shotId}-${moment.id}`} role="button" accessibilityLabel={labelFor(moment)} accessibilityState={{ selected, disabled: disabled(moment) }} disabled={disabled(moment)} onPress={() => { if (!current) onSelect(moment); }} style={{ width: "31%", aspectRatio: 1 }} className={`overflow-hidden rounded-xl border-2 ${selected ? "border-[#d5eee5]" : "border-transparent"} ${disabled(moment) ? "opacity-40" : ""}`}>
      <View pointerEvents="none" accessibilityLabel={`${video ? "Video" : "Photo"} preview fallback`} className="absolute inset-0 items-center justify-center bg-[#263642]"><Text className="text-[28px] text-white">{video ? "▶" : "▧"}</Text>{video ? <Text className="mt-1 font-sans-medium text-[9px] text-white/80">VIDEO</Text> : null}</View>
      {!imageFailed && moment.imageKey ? <Image source={source(moment.imageKey)} accessibilityLabel={`${moment.title} thumbnail`} className="h-full w-full" resizeMode="cover" onError={() => setFailedImages(previous => new Set(previous).add(`${moment.shotId ?? moment.id}:${moment.imageKey}`))} /> : null}
      {current ? <View pointerEvents="none" accessibilityLabel="Current" className="absolute left-1 top-1 rounded-full bg-[#d5eee5] px-2 py-0.5"><Text className="font-sans-semibold text-[10px] text-[#111d26]">Current</Text></View> : null}
      {!current && moment.shotId && (inFilmShotIds.has(moment.shotId) || inCollageShotIds.has(moment.shotId)) ? <View pointerEvents="none" accessibilityLabel={inCollageShotIds.has(moment.shotId!) ? "In collage" : "In film"} className="absolute right-1 top-1 rounded-full bg-black/75 px-1.5 py-0.5"><Text className="font-sans-medium text-[8px] text-white">{inCollageShotIds.has(moment.shotId!) ? "In collage" : "In film"}</Text></View> : null}
      {tagsFor?.(moment).length ? <View pointerEvents="none" className="absolute bottom-1 left-1 right-1 flex-row flex-wrap gap-1">{tagsFor(moment).slice(0, 2).map(tag => <View key={tag} className="max-w-full rounded-full bg-black/75 px-1.5 py-0.5"><Text numberOfLines={1} className="font-sans-medium text-[8px] text-white">{tag}</Text></View>)}</View> : null}
      {selected ? <View pointerEvents="none" className="absolute inset-0 border-2 border-[#d5eee5] bg-white/10" /> : null}
    </Pressable>;
  })}</View></ScrollView>;
}
