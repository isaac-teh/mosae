import { Image, Pressable, ScrollView, Text, View } from "react-native";
import type { Moment } from "@mosae/core";
import { Asset } from "expo-asset";
import { demoImage } from "@/lib/demoAssets";

export function MediaGridPicker({ moments, selectedShotId, inFilmShotIds = new Set(), disabled = () => false, labelFor, tagsFor, onSelect }: {
  moments: Moment[]; selectedShotId?: string | null; inFilmShotIds?: ReadonlySet<string>; disabled?: (moment: Moment) => boolean;
  labelFor: (moment: Moment) => string; tagsFor?: (moment: Moment) => string[]; onSelect: (moment: Moment) => void;
}) {
  const source = (value: string) => {
    if (!value.startsWith("demo:")) return { uri: value };
    try { return { uri: Asset.fromModule(demoImage(value.slice(5))).uri }; } catch { return { uri: value }; }
  };
  return <ScrollView><View className="flex-row flex-wrap gap-2">{moments.map(moment => {
    const selected = moment.shotId === selectedShotId;
    return <Pressable key={`${moment.shotId}-${moment.id}`} role="button" accessibilityLabel={labelFor(moment)} accessibilityState={{ selected, disabled: disabled(moment) }} disabled={disabled(moment)} onPress={() => onSelect(moment)} style={{ width: "31%", aspectRatio: 1 }} className={`overflow-hidden rounded-xl border-2 ${selected ? "border-[#d5eee5]" : "border-transparent"} ${disabled(moment) ? "opacity-40" : ""}`}>
      <Image source={source(moment.imageKey)} accessibilityLabel={`${moment.title} thumbnail`} className="h-full w-full" resizeMode="cover" />
      {moment.shotId && inFilmShotIds.has(moment.shotId) ? <View pointerEvents="none" accessibilityLabel="In film" className="absolute right-1 top-1 rounded-full bg-black/75 px-1.5 py-0.5"><Text className="font-sans-medium text-[8px] text-white">in film</Text></View> : null}
      {tagsFor?.(moment).length ? <View pointerEvents="none" className="absolute bottom-1 left-1 right-1 flex-row flex-wrap gap-1">{tagsFor(moment).slice(0, 2).map(tag => <View key={tag} className="max-w-full rounded-full bg-black/75 px-1.5 py-0.5"><Text numberOfLines={1} className="font-sans-medium text-[8px] text-white">{tag}</Text></View>)}</View> : null}
      {selected ? <View pointerEvents="none" className="absolute inset-0 border-2 border-[#d5eee5] bg-white/10" /> : null}
    </Pressable>;
  })}</View></ScrollView>;
}
