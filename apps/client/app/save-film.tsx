import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Asset } from "expo-asset";
import Svg, { Circle, Path } from "react-native-svg";
import { useStoryFlow, useStoryScreenGuard } from "@/lib/storyFlow";
import { type Film, type StoryRepository } from "@mosae/core";
import { FilmPlayer } from "@/components/FilmPlayer";
import { downloadFilm } from "@/lib/downloadFilm";
import { storyImage } from "@/lib/storyImage";

function PinIcon() { return <Svg width={13} height={13} viewBox="0 0 13 13"><Path d="M6.5 11.5s4-3.13 4-6.1a4 4 0 1 0-8 0c0 2.97 4 6.1 4 6.1Z" fill="none" stroke="rgb(var(--color-accent))" strokeWidth={1.3} /><Circle cx={6.5} cy={5.25} r={1.2} fill="rgb(var(--color-accent))" /></Svg>; }

export default function SaveFilmScreen() {
  const params = useLocalSearchParams<{ filmId: string; directorChat?: string }>();
  const story = useStoryFlow();
  return <SaveFilmScreenContent key={`${story.identityKey}:film:${params.filmId}`} filmId={params.filmId} directorChat={params.directorChat === "true"} storyFlow={story.flow} repository={story.repository} route={story.route} />;
}

function SaveFilmScreenContent({ filmId, directorChat, storyFlow, repository, route }: {
  filmId: string;
  directorChat: boolean;
  storyFlow: ReturnType<typeof useStoryFlow>["flow"];
  repository: StoryRepository;
  route: (path: string, id?: { planId?: string; filmId?: string }) => string;
}) {
  const router = useRouter();
  const isCurrent = useStoryScreenGuard();
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [preparingDownload, setPreparingDownload] = useState(false);
  useEffect(() => { void repository.getFilm(filmId)
    .then((value) => { if (isCurrent()) setFilm(value); })
    .catch((cause: Error) => { if (isCurrent()) setError(cause.message); }); }, [filmId, isCurrent, repository]);

  const onDownload = async () => {
    if (!film || preparingDownload) return;
    setDownloadError(null);
    try { await downloadFilm(film.videoUrl ?? Asset.fromModule(require("../assets/demo/film.mp4")).uri, film.title, setPreparingDownload); }
    catch { setDownloadError("Could not prepare the film download. Try again."); }
  };
  const poster = film ? storyImage(film.posterKey || film.savePosterKey) : {};
  const projectId = storyFlow.repository === "api" ? storyFlow.projectId : "fixture";

  if (error) return <View className="flex-1 items-center justify-center bg-surface px-6"><Text accessibilityRole="alert" className="font-sans text-body text-critical">{error}</Text></View>;
  if (!film) return <View className="flex-1 items-center justify-center bg-surface"><Text className="font-sans text-body text-ink-muted">Opening saved film…</Text></View>;

  return <View className="flex-1 bg-surface px-5 pt-4">
    <View className="mb-3 flex-row items-center justify-between"><Pressable role="button" aria-label="Back to your films" onPress={() => router.navigate(route("/") as never)} className="min-h-11 min-w-11 justify-center"><Text className="font-sans text-[28px] text-ink">‹</Text></Pressable><Text className="font-sans-semibold text-heading text-ink">Saved film</Text><View className="min-w-11" /></View>
    {directorChat ? <Text className="mb-3 self-center font-sans-semibold text-button text-positive">✓ Saved to your films</Text> : null}
    <ScrollView className="flex-1" contentContainerClassName="gap-4 pb-5" showsVerticalScrollIndicator={false}>
      <FilmPlayer source={film.videoUrl ?? require("../assets/demo/film.mp4")} poster={poster} durationSec={film.durationSec} aspect="landscape" compact />
      <View className="gap-1"><Text className="font-title text-title text-ink">{film.title}</Text><View className="flex-row items-center gap-1"><PinIcon /><Text className="font-sans text-caption text-ink-muted">{film.dateLabel}</Text></View><Text className="font-sans text-caption text-ink-muted">{film.momentCount} moments · Still editable anytime</Text></View>
      <View accessibilityLabel="Film actions" className="flex-row gap-3">
        <Pressable role="button" aria-label="Download" disabled={preparingDownload} onPress={() => void onDownload()} className="min-h-12 flex-1 items-center justify-center rounded-full bg-accent px-4"><Text className="font-sans-semibold text-button text-on-accent">{preparingDownload ? "Preparing download…" : "Download"}</Text></Pressable>
        <Pressable role="button" aria-label="Share" onPress={() => void Share.share({ message: film.videoUrl ?? film.title })} className="min-h-12 flex-1 items-center justify-center rounded-full border border-line-strong px-4"><Text className="font-sans-semibold text-button text-ink">Share</Text></Pressable>
      </View>
      {preparingDownload ? <Text accessibilityRole="progressbar" className="font-sans text-caption text-ink-muted">Preparing your MP4…</Text> : null}
      {downloadError ? <Text accessibilityRole="alert" className="font-sans text-caption text-critical">{downloadError}</Text> : null}
      <Pressable role="button" aria-label="Edit film" onPress={() => router.push({ pathname: "/editor", params: { projectId, planId: film.planId, generationId: film.filmId, request: "", ...storyFlow } } as never)} className="min-h-12 items-center justify-center rounded-full border border-line-strong"><Text className="font-sans-semibold text-button text-ink">Edit film</Text></Pressable>
      <Pressable role="button" aria-label="Back to your films" onPress={() => router.navigate(route("/") as never)} className="min-h-12 items-center justify-center"><Text className="font-sans-medium text-button text-ink-muted">Back to your films</Text></Pressable>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("https://www.openstreetmap.org/copyright")} className="items-center py-2"><Text className="font-sans text-[11px] text-ink-muted">© OpenStreetMap contributors</Text></Pressable>
    </ScrollView>
  </View>;
}
