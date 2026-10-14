import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getProjectMoments, savePersonMoments, type ProjectMoment } from "@/lib/projectMoments";
import { useStoryFlow } from "@/lib/storyFlow";
import { setTaggedPersonResult } from "@/lib/taggedPersonResult";

type Row = { key: string; title: string; count: number } | { key: string; moments: ProjectMoment[] };

export default function TagMomentsScreen() {
  const router = useRouter();
  const story = useStoryFlow();
  const { projectId, personId, name, faceUri, source } = useLocalSearchParams<{ projectId: string; personId: string; name?: string; faceUri?: string; source?: string }>();
  const displayName = name?.trim() || "this person";
  const [moments, setMoments] = useState<ProjectMoment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (story.flow.repository === "fixture") {
      setMoments(Array.from({ length: 18 }, (_, index) => ({ shotId: `fixture-${index + 1}`, thumbnailUrl: "", kind: index % 5 === 0 ? "video" as const : "photo" as const, durationSec: index % 5 === 0 ? 12 : null, dayIndex: Math.floor(index / 6) + 1, personIds: [] })));
      return;
    }
    void getProjectMoments(projectId).then((items) => { setMoments(items); setSelected(new Set(items.filter((item) => item.personIds.includes(personId)).map((item) => item.shotId))); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load moments"));
  }, [projectId, personId, story.flow.repository]);
  const rows = useMemo<Row[]>(() => {
    const grouped = new Map<number, ProjectMoment[]>();
    for (const moment of moments) grouped.set(moment.dayIndex, [...(grouped.get(moment.dayIndex) ?? []), moment]);
    return [...grouped].flatMap(([day, items]) => [{ key: `day-${day}`, title: `Day ${day}`, count: items.length } as Row, ...Array.from({ length: Math.ceil(items.length / 3) }, (_, index) => ({ key: `row-${day}-${index}`, moments: items.slice(index * 3, index * 3 + 3) } as Row))]);
  }, [moments]);
  const save = async () => {
    if (source === "missed" && selected.size === 0) { setError("Tag at least one moment to continue."); return; }
    setSaving(true); setError(null);
    try {
      const previous = new Set(moments.filter((item) => item.personIds.includes(personId)).map((item) => item.shotId));
      const personName = source === "missed" ? displayName : name?.trim() || null;
      const selectedMoments = moments.filter((moment) => selected.has(moment.shotId));
      const sampleUris = selectedMoments.map((moment) => moment.thumbnailUrl).filter(Boolean).slice(0, 4);
      const savedPersonId = story.flow.repository !== "fixture" ? await savePersonMoments(projectId, personId, personName, [...selected].filter((id) => !previous.has(id)), [...previous].filter((id) => !selected.has(id)), sampleUris) ?? personId : personId;
      const sampleUri = faceUri || sampleUris[0];
      setTaggedPersonResult({ personId: savedPersonId, name: personName ?? "", momentCount: selected.size, isMissed: source === "missed", ...(sampleUri ? { sampleUri } : {}), ...(sampleUris.length ? { sampleUris } : {}) });
      router.back();
    } catch { setError("We couldn't save these tags. Please try again."); }
    finally { setSaving(false); }
  };
  return <View className="flex-1 bg-ink">
    <View className="flex-row items-center justify-between px-4 pt-12 pb-3"><Pressable role="button" accessibilityLabel="Close" onPress={() => router.back()}><Text className="text-2xl text-on-screen">×</Text></Pressable><Text className="font-sans-semibold text-button text-on-screen">Tag moments</Text><Pressable role="button" onPress={() => void save()} disabled={saving}><Text className="font-sans-semibold text-button text-on-screen">{saving ? "Saving…" : "Done"}</Text></Pressable></View>
    <View className="mx-4 mb-3 rounded-md bg-surface-raised px-3 py-3"><Text className="font-sans text-body text-ink">Tap a moment to tag {displayName.toLocaleLowerCase()}</Text></View>
    {error && <Text className="px-4 pb-2 font-sans text-caption text-on-screen">{error}</Text>}
    {!moments.length && !error ? <ActivityIndicator className="mt-8" /> : <FlatList data={rows} keyExtractor={(row) => row.key} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }} renderItem={({ item }) => "title" in item ? <View className="flex-row items-center justify-between py-3"><Text className="font-sans-semibold text-label text-on-screen">{item.title}</Text><Text className="font-sans text-caption text-on-screen">{item.count} moments</Text></View> : <View className="flex-row gap-1 pb-1">{item.moments.map((moment) => <Pressable key={moment.shotId} role="button" accessibilityLabel={`${selected.has(moment.shotId) ? "Untag" : "Tag"} moment`} onPress={() => setSelected((current) => { const next = new Set(current); next.has(moment.shotId) ? next.delete(moment.shotId) : next.add(moment.shotId); return next; })} className="relative aspect-square flex-1 overflow-hidden bg-surface-sunken">
      <Image source={{ uri: moment.thumbnailUrl }} resizeMode="cover" className="size-full" />{selected.has(moment.shotId) && <View className="absolute left-1 top-1 rounded-pill bg-white px-2 py-1"><Text className="font-sans-medium text-caption text-ink">{displayName}</Text></View>}{moment.kind === "video" && <View className="absolute bottom-1 right-1 rounded-sm bg-black/70 px-1.5 py-1"><Text className="font-sans text-caption text-on-screen">{`${Math.floor((moment.durationSec ?? 0) / 60)}:${String(Math.floor((moment.durationSec ?? 0) % 60)).padStart(2, "0")}`}</Text></View>}</Pressable>)}{Array.from({ length: 3 - item.moments.length }, (_, index) => <View key={`empty-${index}`} className="flex-1" />)}</View>} />}
  </View>;
}
