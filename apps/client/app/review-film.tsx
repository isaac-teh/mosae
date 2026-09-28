// Figma: "Review the Film" (1:1052)
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useStepBack } from "@/lib/useStepBack";
import Svg, { Path } from "react-native-svg";
import { useStoryFlow, useStoryScreenGuard } from "@/lib/storyFlow";
import { type Film, type StoryRepository } from "@mosae/core";
import { FilmPlayer } from "@/components/FilmPlayer";
import { Button } from "@/components/ds";
import { StepHeader } from "@/components/StepHeader";
import { storyImage } from "@/lib/storyImage";

function SparklesIcon() { return <Svg width={15} height={15} viewBox="0 0 15 15"><Path d="m7.5 0 .8 3.2 3.2.8-3.2.8-.8 3.2-.8-3.2-3.2-.8 3.2-.8L7.5 0Zm4.4 8.8.4 1.4 1.4.4-1.4.4-.4 1.4-.4-1.4-1.4-.4 1.4-.4.4-1.4ZM2.7 9.6l.3 1 .9.3-.9.3-.3 1-.3-1-.9-.3.9-.3.3-1Z" fill="rgb(var(--color-accent))" /></Svg>; }
function SendIcon() { return <Svg width={17} height={17} viewBox="0 0 17 17"><Path d="M2 8.5h12m-4-4 4 4-4 4" fill="none" stroke="white" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" /></Svg>; }
function CheckCircleIcon() { return <Svg width={18} height={18} viewBox="0 0 18 18"><Path d="M9 16.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm-3.2-7.3 2.1 2.1 4.3-4.4" fill="none" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></Svg>; }
function TimerIcon() { return <Svg width={12} height={12} viewBox="0 0 12 12"><Path d="M4.5 1h3M6 1v1.2m3.1.9.8-.8m-.4 3.7A3.5 3.5 0 1 1 6 2.5a3.5 3.5 0 0 1 3.5 3.5ZM6 4v2l1.25.75" fill="none" stroke="rgb(var(--color-ink-muted))" strokeWidth={.9} strokeLinecap="round" strokeLinejoin="round" /></Svg>; }
function MusicNoteIcon() { return <Svg width={12} height={12} viewBox="0 0 12 12"><Path d="M8.7 1.5v6.2a1.8 1.8 0 1 1-.9-1.55V3.1l3-1v5.2a1.8 1.8 0 1 1-.9-1.55V1.5l-1.2.4Z" fill="rgb(var(--color-ink-muted))" /></Svg>; }

function ErrorState({ error, retry }: { error: string; retry: () => void }) { return <View className="flex-1 items-center justify-center bg-surface"><Text className="text-action">{error}</Text><Pressable role="button" aria-label="Retry" onPress={retry} className="mt-4 rounded-full bg-action px-4 py-3"><Text className="font-sans-semibold text-on-action">Retry</Text></Pressable></View>; }

export default function ReviewFilmScreen() {
  const { filmId } = useLocalSearchParams<{ filmId: string }>();
  const story = useStoryFlow();
  return <ReviewFilmScreenContent key={`${story.identityKey}:film:${filmId}`} filmId={filmId} repository={story.repository} route={story.route} />;
}

function ReviewFilmScreenContent({ filmId, repository, route }: {
  filmId: string;
  repository: StoryRepository;
  route: (path: string, id?: { planId?: string; filmId?: string }) => string;
}) {
  const router = useRouter();
  const isCurrent = useStoryScreenGuard();
  const [film, setFilm] = useState<Film | null>(null);
  const goBack = useStepBack((film ? route("/direct-film", { planId: film.planId }) : "/") as Href);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [adjustment, setAdjustment] = useState("");
  const [revising, setRevising] = useState(false);
  const [versionReady, setVersionReady] = useState(false);
  const load = useCallback(() => { void repository.getFilm(filmId)
    .then((value) => { if (isCurrent()) setFilm(value); })
    .catch((cause: Error) => { if (isCurrent()) setError(cause.message); }); }, [filmId, isCurrent, repository]);
  useEffect(load, [load]);
  // While the MP4 is still being made, ask again every 2s. A demo film is never
  // rendering, so it never polls.
  const rendering = Boolean(film?.rendering);
  useEffect(() => { if (!rendering) return; const id = setInterval(load, 2000); return () => clearInterval(id); }, [rendering, load]);
  if (error) return <ErrorState error={error} retry={() => { setError(null); load(); }} />;
  if (!film) return <View className="flex-1 bg-surface"><StepHeader step="STEP 5 OF 6" label="YOUR STORY" progress={0.83} onBack={() => goBack()} backLabel="Go back to directing" /></View>;
  const revise = async () => { if (!adjustment || revising) return; setRevising(true); setVersionReady(false); try { await repository.reviseFilm(film.filmId, adjustment); if (!isCurrent()) return; setVersionReady(true); setAdjustment(""); } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to revise your film"); } finally { if (isCurrent()) setRevising(false); } };
  const save = async () => { try { await repository.saveFilm(film.filmId); if (!isCurrent()) return; router.navigate(route("/save-film", { filmId: film.filmId }) as never); } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to save your film"); } };
  return <View className="flex-1 bg-surface"><StepHeader step="STEP 5 OF 6" label="YOUR STORY" progress={0.83} onBack={() => goBack()} backLabel="Go back to directing" />
    <ScrollView className="flex-1" contentContainerClassName="min-h-[841px] px-4 pb-2" keyboardShouldPersistTaps="handled"><View className="pt-[22px]"><Text className="font-sans-semibold text-[15px] leading-5 text-ink">Review Your Film</Text><Text className="mt-1 font-sans text-body leading-5 text-ink-muted">{film.subtitle}</Text></View>
      <View className="mt-[27px]"><FilmPlayer source={film.videoUrl ?? require("../assets/demo/film.mp4")} poster={storyImage(film.posterKey)} durationSec={film.durationSec} aspect="portrait" />{rendering ? <View className="absolute inset-0 items-center justify-center rounded-[23px] bg-black/55"><Text className="font-sans-semibold text-button text-on-screen">Rendering your film…</Text></View> : revising && <View className="absolute inset-0 items-center justify-center rounded-[23px] bg-black/55"><Text className="font-sans-semibold text-button text-on-screen">Revising your film...</Text></View>}</View>
      <View className="mt-[17px] rounded-[21px] border border-line bg-surface-raised p-2.5 shadow-[0_1px_4px_rgba(65,43,35,0.06)]"><View className="h-[33px] flex-row rounded-full bg-surface-sunken p-0.5"><Pressable role="button" aria-label="AI Director" onPress={() => setManual(false)} className={`flex-1 flex-row items-center justify-center gap-1 rounded-full ${!manual ? "bg-surface-raised shadow-[0_1px_2px_rgba(0,0,0,0.1)]" : ""}`}><SparklesIcon /><Text className={`font-sans-medium text-caption ${!manual ? "text-action" : "text-ink-muted"}`}>AI Director</Text></Pressable><Pressable role="button" aria-label="Manual Editor" onPress={() => setManual(true)} className="flex-1 items-center justify-center"><Text className="font-sans-medium text-caption text-ink-muted">☷ &nbsp;Manual Editor</Text></Pressable></View>
        {manual ? <Text className="h-[117px] px-1 pt-5 font-sans text-body text-ink-muted">Coming soon</Text> : <><View className="mt-3 flex-row items-center justify-between px-0.5"><Text className="font-sans text-caption leading-4 text-ink-muted">{versionReady ? "Version 2 ready" : "Describe any adjustment or tap a shortcut:"}</Text><Text className="font-sans-medium text-[11px] text-accent">Instant AI</Text></View><View className="mt-1.5 h-[83px] flex-row items-center rounded-[15px] border border-line bg-surface-raised px-3"><TextInput value={adjustment} onChangeText={setAdjustment} placeholder="e.g., More upbeat music, longer birthday scene..." placeholderTextColor="rgb(var(--color-ink-muted))" className="flex-1 self-stretch p-0 font-sans text-[13px] leading-[18px] text-ink" multiline /><Pressable role="button" aria-label="Send adjustment" onPress={() => void revise()} className="ml-2 size-8 items-center justify-center rounded-full bg-action"><SendIcon /></Pressable></View><ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2"><View className="flex-row gap-1.5">{film.shortcuts.map((shortcut) => <Pressable key={shortcut.label} role="button" aria-label={shortcut.label} onPress={() => setAdjustment(shortcut.label)} className="h-6 flex-row items-center rounded-full border border-line bg-surface-raised px-2"><View className="mr-0.5">{shortcut.label === "Shorter cut" ? <TimerIcon /> : shortcut.label === "Upbeat music" ? <MusicNoteIcon /> : <Text className="text-[11px]">🎂</Text>}</View><Text className="font-sans text-[11px] text-ink">{shortcut.label}</Text></Pressable>)}</View></ScrollView></>}</View>
      <View className="mt-1"><Button size="sm" label="Looks good! Save film" onPress={() => void save()} leadingIcon={<CheckCircleIcon />} /></View>
    </ScrollView>
  </View>;
}
