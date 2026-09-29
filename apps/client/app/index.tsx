import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { getStoryRepository, isMedia, setPendingMedia, type FilmListItem } from "@mosae/core";
import { Button, FilmCard } from "@/components/ds";
import { SettingsIcon } from "@/components/icons";
import { MediaPicker, type MediaPickerHandle } from "@/components/MediaPicker";

export default function Home() {
  const [films, setFilms] = useState<FilmListItem[] | null>(null);
  const router = useRouter();
  const pickerRef = useRef<MediaPickerHandle>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    void getStoryRepository().listFilms().then((result) => { if (active) setFilms(result); }).catch(() => { if (active) setFilms([]); });
    return () => { active = false; };
  }, []));

  function createFilm() { pickerRef.current?.open(); }
  function startWithMedia(files: File[]) {
    const media = files.filter(isMedia);
    if (media.length === 0) return;
    setPendingMedia(media);
    router.push("/pick-memory" as Href);
  }

  const hasFilms = films !== null && films.length > 0;
  const mosaicColors = [
    "deep-tide", "tide-tile", "surface-sunken", "tide-tile",
    "surface-sunken", "persimmon", "tide-tile", "deep-tide",
    "tide-tile", "deep-tide", "surface-sunken", "tide-tile",
  ];
  const tileClasses: Record<string, string> = {
    "deep-tide": "bg-deep-tide",
    "tide-tile": "bg-tide-tile",
    "surface-sunken": "bg-surface-sunken",
    persimmon: "bg-persimmon",
  };

  return (
    <View className="flex-1 bg-surface">
      <MediaPicker ref={pickerRef} onFiles={startWithMedia} />
      <ScrollView className="flex-1" contentContainerClassName={`px-6 pt-4 ${hasFilms ? "pb-32" : "pb-8"}`}>
        <View className="flex-row items-center justify-between">
          <Text accessibilityLabel="Mosaé" className="font-title text-[27px] text-ink">mosaé</Text>
          <Pressable role="button" accessibilityLabel="Settings" aria-label="Settings" className="min-h-11 min-w-11 items-center justify-center"><SettingsIcon /></Pressable>
        </View>
        {hasFilms ? (
          <View className="mt-8">
            <View className="mb-4 flex-row items-center justify-between">
              <Text role="heading" aria-level={1} className="font-title text-title text-ink">Your films</Text>
              <Text className="font-sans text-caption text-ink-muted">{films.length} films</Text>
            </View>
            <View data-film-grid="true" className="flex-row flex-wrap justify-between gap-y-3">
              {films.map((film) => <View key={film.projectId + "/" + film.filmId} className="w-[48%]">
                <FilmCard title={film.title} meta={film.month} status="Ready to watch" duration={film.duration} posterSource={film.posterUrl ? { uri: film.posterUrl } : undefined} badge={film.justSaved ? "Just saved" : undefined} onPress={() => router.push(("/review-film?repository=api&projectId=" + encodeURIComponent(film.projectId) + "&filmId=" + encodeURIComponent(film.filmId)) as Href)} />
              </View>)}
            </View>
          </View>
        ) : (
          <>
            <View accessibilityLabel="Mosaé tile mosaic" data-testid="home-mosaic" className="mt-[112px] w-[248px] flex-row flex-wrap gap-2">
              {mosaicColors.map((color, index) => <View key={index} data-mosaic-tile={color} className={`h-14 w-14 rounded-md ${tileClasses[color]}`} />)}
            </View>
            <View className="mt-6">
              <Text role="heading" aria-level={1} className="font-title text-title text-ink">Many moments.{"\n"}One story.</Text>
              <Text className="mt-3 font-sans text-body leading-6 text-ink-muted">Bring in the photos and clips from a trip or celebration. You say what mattered. Mosaé shapes it into a film you can change at every step.</Text>
              <View className="mt-5"><Button label="＋  Create a new film" onPress={createFilm} /></View>
            </View>
            <View className="mt-[60px] border-t border-line pt-5">
              <Text role="heading" aria-level={2} className="mb-3 font-title text-heading text-ink">Your films</Text>
              {films === null ? <Text accessibilityRole="progressbar" className="font-sans text-caption text-ink-muted">Loading your films…</Text> : (
                <View className="flex-row items-center gap-4 rounded-md bg-surface-sunken p-3">
                  <View data-testid="empty-films-icon" accessibilityLabel="Four tiles" className="w-[26px] flex-row flex-wrap gap-0.5">
                    {["tide-tile", "tide-tile", "tide-tile", "deep-tide"].map((color, index) => <View key={index} className={`size-3 rounded-[2px] ${tileClasses[color]}`} />)}
                  </View>
                  <Text className="flex-1 font-sans text-caption leading-[18px] text-ink-muted">No films yet. Your first one will live here, and it stays editable.</Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
      {hasFilms ? <View className="absolute inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-6 pb-8 pt-4"><Button label="＋  Create a new film" onPress={createFilm} /></View> : null}
    </View>
  );
}
