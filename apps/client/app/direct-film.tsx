// Figma: "Direct Your Film" (1:827)
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { getStoryRepository, type DirectionOptions } from "@mosae/core";
import { PrimaryButton } from "@/components/PrimaryButton";
import { StepHeader } from "@/components/StepHeader";
import { ArchivalSparkleIcon, CreateMusicIcon, CreateTimerIcon } from "@/components/sceneIcons";

function DirectorNoteIcon() {
  return <Svg width={15} height={15} viewBox="0 0 15 15" fill="none"><Path d="M2.25 2.25h4.5v4.5h-4.5v-4.5Zm6-1.5h4.5v4.5h-4.5v-4.5ZM2.25 8.25h4.5v4.5h-4.5v-4.5Zm6 1.5h4.5M10.5 7.5v4.5" stroke="#A83212" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function ChevronIcon() {
  return <Svg width={12} height={12} viewBox="0 0 12 12" fill="none"><Path d="m4.5 2.25 3.75 3.75-3.75 3.75" stroke="#D9AAA0" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function SwapIcon() {
  return <Svg width={12} height={12} viewBox="0 0 12 12" fill="none"><Path d="M2 3.5h6.5m0 0L6.75 1.75M8.5 3.5 6.75 5.25M10 8.5H3.5m0 0 1.75-1.75M3.5 8.5l1.75 1.75" stroke="#A83212" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return <View className="flex-1 items-center justify-center bg-canvas"><Text className="text-brand">{error}</Text><Pressable role="button" aria-label="Retry" onPress={retry} className="mt-4 rounded-full bg-brand px-5 py-3"><Text className="font-sans-semibold text-white">Retry</Text></Pressable></View>;
}

export default function DirectFilmScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const [options, setOptions] = useState<DirectionOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [cadenceIndex, setCadenceIndex] = useState(0);
  const [soundtrackIndex, setSoundtrackIndex] = useState(0);
  const [durationId, setDurationId] = useState<DirectionOptions["recommendedDuration"] | null>(null);
  const [rewriteIndex, setRewriteIndex] = useState(0);
  const [directing, setDirecting] = useState(false);

  const load = () => {
    void getStoryRepository().getDirectionOptions(planId).then((value) => {
      setOptions(value);
      setNote(value.note);
      setDurationId(value.recommendedDuration);
    }).catch((cause: Error) => setError(cause.message));
  };
  useEffect(load, [planId]);

  if (error) return <ErrorState error={error} retry={() => { setError(null); load(); }} />;
  if (!options) return <View className="flex-1 bg-canvas"><StepHeader step="STEP 4 OF 6" label="DIRECTING" progress={0.67} onBack={() => router.back()} backLabel="Go back to create" /></View>;

  const cadence = options.cadences[cadenceIndex];
  const soundtrack = options.soundtracks[soundtrackIndex];
  const nextCadence = () => setCadenceIndex((index) => (index + 1) % options.cadences.length);
  const nextSoundtrack = () => setSoundtrackIndex((index) => (index + 1) % options.soundtracks.length);
  const rewrite = () => {
    if (options.rewrites.length === 0) return;
    setNote(options.rewrites[rewriteIndex % options.rewrites.length]);
    setRewriteIndex((index) => index + 1);
  };
  const submit = async () => {
    if (directing) return;
    setDirecting(true);
    try {
      const { filmId } = await getStoryRepository().directFilm(planId, { note, cadenceId: cadence.id, soundtrackId: soundtrack?.id ?? null, durationId });
      router.navigate(`/review-film?filmId=${filmId}` as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to direct your film");
      setDirecting(false);
    }
  };

  return <View className="flex-1 bg-canvas"><StepHeader step="STEP 4 OF 6" label="DIRECTING" progress={0.67} onBack={() => router.back()} backLabel="Go back to create" />
    <ScrollView className="flex-1" contentContainerClassName="min-h-[986px] px-5 pb-3" keyboardShouldPersistTaps="handled">
      <View className="pt-[23px]"><Text className="font-sans-semibold text-[16px] leading-[22px] text-ink">How should we tell your story?</Text><Text className="mt-1 font-sans text-sm leading-[23px] text-ink-soft">Set the emotional tone and rhythm. Mosaé will weave{`\n`}natural pacing, organic transitions, and an heirloom{`\n`}soundtrack.</Text></View>

      <View className="mt-[27px] h-[280px] rounded-[16px] bg-white p-6 shadow-[0px_2px_4px_rgba(0,0,0,0.12)]"><View className="flex-row items-center justify-between"><View className="flex-row items-center gap-1.5"><DirectorNoteIcon /><Text className="font-sans-medium text-xs leading-4 text-brand">Director Note</Text></View><Pressable role="button" aria-label="Rewrite director note" onPress={rewrite} className="flex-row items-center gap-1"><Text className="text-[13px] text-ink-soft">≡</Text><Text className="font-sans-medium text-xs leading-4 text-ink">Rewrite</Text></Pressable></View><TextInput multiline value={note} onChangeText={setNote} textAlignVertical="top" className="mt-3 flex-1 p-0 font-sans text-sm leading-[22px] text-ink" /></View>

      <View className="mt-6 rounded-[16px] bg-white p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><View className="flex-row items-center justify-between"><View className="flex-row items-center gap-1.5"><ArchivalSparkleIcon /><Text className="font-sans-semibold text-sm leading-5 text-ink">Emotional Cadence</Text></View><Pressable role="button" aria-label="Change cadence" onPress={nextCadence} className="flex-row items-center gap-0.5"><SwapIcon /><Text className="font-sans-medium text-xs leading-4 text-brand">Change cadence</Text></Pressable></View><Pressable role="button" aria-label="Select cadence" onPress={nextCadence} className="mt-3 flex-row items-center rounded-full bg-surface-sunken p-2"><View className="size-10 items-center justify-center rounded-full bg-[#fed8d1]"><Text className="text-lg text-brand">✦</Text></View><View className="ml-3 flex-1"><Text className="font-serif text-[16px] leading-[21px] text-ink">{cadence.name}</Text><Text className="mt-0.5 font-sans text-xs leading-4 text-ink-soft">{cadence.description}</Text></View><ChevronIcon /></Pressable></View>

      <View className="mt-6 rounded-[16px] bg-white p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><View className="flex-row items-center justify-between"><View className="flex-row items-center gap-1.5"><CreateMusicIcon /><Text className="font-sans-semibold text-sm leading-5 text-ink">Soundtrack &amp; Audio</Text><Text className="font-sans text-xs leading-4 text-ink-soft">(Optional)</Text></View><Pressable role="button" aria-label="Pick song" onPress={nextSoundtrack}><Text className="font-sans-medium text-xs leading-4 text-brand">Pick song</Text></Pressable></View><Pressable role="button" aria-label="Select soundtrack" onPress={nextSoundtrack} className="mt-3 flex-row items-center rounded-full bg-surface-sunken p-2"><View className="size-10 items-center justify-center rounded-full bg-[#f8e1da]"><CreateMusicIcon /></View><View className="ml-3 flex-1"><Text className="font-sans-medium text-sm leading-5 text-ink">{soundtrack.name}</Text><Text className="mt-0.5 font-sans text-xs leading-4 text-ink-soft">{soundtrack.description}</Text></View><ChevronIcon /></Pressable></View>

      <View className="mt-6 rounded-[16px] bg-white p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><View className="flex-row items-center justify-between"><View className="flex-row items-center gap-1.5"><CreateTimerIcon /><Text className="font-sans-semibold text-sm leading-5 text-ink">Set a duration</Text><Text className="font-sans text-xs leading-4 text-ink-soft">(Optional)</Text></View><Text className="font-sans text-[11px] leading-4 text-[rgba(89,65,59,0.65)]">Auto if unset</Text></View><View role="radiogroup" className="mt-3 h-[64px] flex-row items-center justify-between rounded-full bg-surface-sunken px-1">{options.durations.map((duration) => { const selected = durationId === duration.id; return <Pressable key={duration.id} role="radio" aria-label={duration.label} aria-checked={selected} onPress={() => setDurationId(selected ? null : duration.id)} className={`h-[56px] min-w-[56px] items-center justify-center rounded-full px-1 ${selected ? "bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.12)]" : ""}`}><Text className={`font-sans-medium text-xs leading-4 ${selected ? "text-brand" : "text-ink-soft"}`}>{duration.label}</Text><Text className={`mt-0.5 font-sans text-[10px] leading-3 ${selected ? "text-brand" : "text-ink-soft"}`}>{duration.caption}</Text></Pressable>; })}</View></View>
      <PrimaryButton label="Direct my film" busyLabel="Directing your film..." busy={directing} onPress={() => void submit()} icon={<ArchivalSparkleIcon />} />
    </ScrollView>
  </View>;
}
