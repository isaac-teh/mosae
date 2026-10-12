// Figma: "Direct Your Film" (1:827)
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useStepBack } from "@/lib/useStepBack";
import Svg, { Path } from "react-native-svg";
import { useStoryFlow, useStoryScreenGuard } from "@/lib/storyFlow";
import { type DirectionOptions, type StoryRepository } from "@mosae/core";
import { Button } from "@/components/ds";
import { StepHeader } from "@/components/StepHeader";
import { ArchivalSparkleIcon, CreateMusicIcon, CreateTimerIcon } from "@/components/sceneIcons";

function DirectorNoteIcon() {
  return <Svg width={15} height={15} viewBox="0 0 15 15" fill="none"><Path d="M2.25 2.25h4.5v4.5h-4.5v-4.5Zm6-1.5h4.5v4.5h-4.5v-4.5ZM2.25 8.25h4.5v4.5h-4.5v-4.5Zm6 1.5h4.5M10.5 7.5v4.5" stroke="rgb(var(--color-accent))" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function ChevronIcon() {
  return <Svg width={12} height={12} viewBox="0 0 12 12" fill="none"><Path d="m4.5 2.25 3.75 3.75-3.75 3.75" stroke="rgb(var(--color-line-strong))" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function SwapIcon() {
  return <Svg width={12} height={12} viewBox="0 0 12 12" fill="none"><Path d="M2 3.5h6.5m0 0L6.75 1.75M8.5 3.5 6.75 5.25M10 8.5H3.5m0 0 1.75-1.75M3.5 8.5l1.75 1.75" stroke="rgb(var(--color-accent))" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function CtaSparkleIcon() {
  return <Svg width={18} height={18} viewBox="0 0 18 18" fill="none"><Path d="m9 0 1.25 4.75L15 6l-4.75 1.25L9 12l-1.25-4.75L3 6l4.75-1.25L9 0Zm5.25 11.25.625 2.125L17 14l-2.125.625L14.25 16.75l-.625-2.125L11.5 14l2.125-.625.625-2.125ZM3.75 12.5l.5 1.75 1.75.5-1.75.5-.5 1.75-.5-1.75-1.75-.5 1.75-.5.5-1.75Z" fill="white" /></Svg>;
}

function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return <View className="flex-1 items-center justify-center bg-surface"><Text className="text-action">{error}</Text><Pressable role="button" aria-label="Retry" onPress={retry} className="mt-4 rounded-full bg-action px-4 py-3"><Text className="font-sans-semibold text-on-action">Retry</Text></Pressable></View>;
}

export default function DirectFilmScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const story = useStoryFlow();
  return <DirectFilmScreenContent key={`${story.identityKey}:plan:${planId}`} planId={planId} repository={story.repository} route={story.route} />;
}

function DirectFilmScreenContent({ planId, repository, route }: {
  planId: string;
  repository: StoryRepository;
  route: (path: string, id?: { planId?: string; filmId?: string }) => string;
}) {
  const router = useRouter();
  const isCurrent = useStoryScreenGuard();
  const goBack = useStepBack(route("/create", { planId: planId }) as Href);
  const [options, setOptions] = useState<DirectionOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [cadenceIndex, setCadenceIndex] = useState(0);
  const [soundtrackIndex, setSoundtrackIndex] = useState(0);
  const [durationId, setDurationId] = useState<DirectionOptions["recommendedDuration"] | null>(null);
  const [rewriteIndex, setRewriteIndex] = useState(0);
  const [directing, setDirecting] = useState(false);

  const load = useCallback(() => {
    void repository.getDirectionOptions(planId).then((value) => {
      if (!isCurrent()) return;
      setOptions(value);
      setNote(value.note);
      setDurationId(value.recommendedDuration);
      // Start on the tone the planner read from the photos, not the first in the list.
      setCadenceIndex(Math.max(0, value.cadences.findIndex((cadence) => cadence.id === value.recommendedCadence)));
    }).catch(() => { if (isCurrent()) setError("Something went wrong while making your film. Try again."); });
  }, [isCurrent, planId, repository]);
  useEffect(load, [load]);

  if (error) return <ErrorState error={error} retry={() => { setError(null); load(); }} />;
  if (!options) return <View className="flex-1 bg-surface"><StepHeader step="STEP 4 OF 6" label="DIRECTING" progress={0.67} onBack={() => goBack()} backLabel="Go back to create" /></View>;

  const cadence = options.cadences[cadenceIndex];
  const soundtrack = options.soundtracks[soundtrackIndex];
  const nextCadence = () => setCadenceIndex((index) => (index + 1) % options.cadences.length);
  // No soundtrack catalog yet: the film is made without music rather than
  // the screen crashing on an empty list.
  const rewrite = () => {
    if (options.rewrites.length === 0) return;
    setNote(options.rewrites[rewriteIndex % options.rewrites.length]);
    setRewriteIndex((index) => index + 1);
  };
  const submit = async () => {
    if (directing) return;
    setDirecting(true);
    try {
      const { filmId } = await repository.directFilm(planId, { note, cadenceId: cadence.id, soundtrackId: soundtrack?.id ?? null, durationId });
      if (!isCurrent()) return;
      router.navigate(route("/review-film", { filmId: filmId }) as never);
    } catch (cause) {
      if (isCurrent()) setError("Something went wrong while making your film. Try again.");
    } finally {
      if (isCurrent()) setDirecting(false);
    }
  };

  return <View className="flex-1 bg-surface"><StepHeader step="STEP 4 OF 6" label="DIRECTING" progress={0.67} onBack={() => goBack()} backLabel="Go back to create" />
    <ScrollView className="flex-1" contentContainerClassName="min-h-[986px] px-4 pb-3" keyboardShouldPersistTaps="handled">
      <View className="pt-[23px]"><Text className="font-sans-semibold text-[16px] leading-[22px] text-ink">How should we tell your story?</Text><Text className="mt-1 font-sans text-body leading-[23px] text-ink-muted">Set the emotional tone and rhythm. Mosaé will weave{`\n`}natural pacing, organic transitions, and an heirloom{`\n`}soundtrack.</Text></View>

      <View className="mt-[27px] h-[280px] rounded-[16px] bg-surface-raised p-6 shadow-[0px_2px_4px_rgba(0,0,0,0.12)]"><View className="flex-row items-center justify-between"><View className="flex-row items-center gap-1.5"><DirectorNoteIcon /><Text className="font-sans-medium text-caption leading-4 text-action">Director Note</Text></View><Pressable role="button" aria-label="Rewrite director note" onPress={rewrite} className="flex-row items-center gap-1"><Text className="text-[13px] text-ink-muted">≡</Text><Text className="font-sans-medium text-caption leading-4 text-ink">Rewrite</Text></Pressable></View><TextInput multiline value={note} onChangeText={setNote} textAlignVertical="top" className="mt-3 flex-1 p-0 font-sans text-body leading-[22px] text-ink" /></View>

      <View className="mt-6 rounded-[16px] bg-surface-raised p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><View className="flex-row items-center justify-between"><View className="flex-row items-center gap-1.5"><ArchivalSparkleIcon /><Text className="font-sans-semibold text-button leading-5 text-ink">Emotional Cadence</Text></View><Pressable role="button" aria-label="Change cadence" onPress={nextCadence} className="flex-row items-center gap-0.5"><SwapIcon /><Text className="font-sans-medium text-caption leading-4 text-action">Change cadence</Text></Pressable></View><Pressable role="button" aria-label="Select cadence" onPress={nextCadence} className="mt-3 flex-row items-center rounded-full bg-surface-sunken p-2"><View className="size-10 items-center justify-center rounded-full bg-accent/20"><Text className="text-lg text-action">✦</Text></View><View className="ml-3 flex-1"><Text className="font-sans text-[16px] leading-[21px] text-ink">{cadence.name}</Text><Text numberOfLines={1} className="mt-0.5 font-sans text-caption leading-4 text-ink-muted">{cadence.description}</Text></View><ChevronIcon /></Pressable>{cadence.id === options.recommendedCadence && options.cadenceReason ? <Text className="mt-2 px-2 font-sans text-caption leading-4 text-ink-muted">Suggested for your photos: {options.cadenceReason}</Text> : null}</View>

      <View className="mt-6 rounded-[16px] bg-surface-raised p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><View className="flex-row items-center gap-1.5"><CreateMusicIcon /><Text className="font-sans-semibold text-button leading-5 text-ink">Soundtrack &amp; Audio</Text><Text className="font-sans text-caption leading-4 text-ink-muted">(Optional)</Text></View><Text className="mt-2 font-sans text-caption text-ink-muted">Suggested soundtrack first</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2" contentContainerClassName="gap-2">{options.soundtracks.map((track, index) => <Pressable key={track.id} role="button" aria-label={`Pick soundtrack ${track.name}`} aria-pressed={index === soundtrackIndex} onPress={() => setSoundtrackIndex(index)} className={`rounded-full px-4 py-2 ${index === soundtrackIndex ? "bg-action" : "bg-surface-sunken"}`}><Text className={`font-sans-medium text-caption ${index === soundtrackIndex ? "text-white" : "text-ink"}`}>{track.name}</Text></Pressable>)}</ScrollView><View className="mt-3 flex-row items-center rounded-full bg-surface-sunken p-2"><View className="size-10 items-center justify-center rounded-full bg-accent/20"><CreateMusicIcon /></View><View className="ml-3 flex-1"><Text className="font-sans-medium text-label leading-5 text-ink">{soundtrack?.name ?? "No music yet"}</Text><Text className="mt-0.5 font-sans text-caption leading-4 text-ink-muted">{soundtrack?.description ?? "Your film is made without a soundtrack for now."}</Text></View></View></View>

      <View className="mt-6 rounded-[16px] bg-surface-raised p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><View className="flex-row items-center justify-between"><View className="flex-row items-center gap-1.5"><CreateTimerIcon /><Text className="font-sans-semibold text-button leading-5 text-ink">Set a duration</Text><Text className="font-sans text-caption leading-4 text-ink-muted">(Optional)</Text></View><Text className="font-sans text-[11px] leading-4 text-ink-muted/80">Auto if unset</Text></View><View role="radiogroup" className="mt-3 h-[64px] flex-row items-center justify-between rounded-full bg-surface-sunken px-1">{options.durations.map((duration) => { const selected = durationId === duration.id; return <Pressable key={duration.id} role="radio" aria-label={duration.label} aria-checked={selected} onPress={() => setDurationId(selected ? null : duration.id)} className={`h-[56px] min-w-[56px] items-center justify-center rounded-full px-1 ${selected ? "bg-surface-raised shadow-[0px_1px_2px_rgba(0,0,0,0.12)]" : ""}`}><Text className={`font-sans-medium text-caption leading-4 ${selected ? "text-action" : "text-ink-muted"}`}>{duration.label}</Text><Text className={`mt-0.5 font-sans text-[10px] leading-3 ${selected ? "text-action" : "text-ink-muted"}`}>{duration.caption}</Text></Pressable>; })}</View></View>
      <Button label={directing ? "Directing your film..." : "Direct my film"} loading={directing} onPress={() => void submit()} leadingIcon={<CtaSparkleIcon />} />
    </ScrollView>
  </View>;
}
