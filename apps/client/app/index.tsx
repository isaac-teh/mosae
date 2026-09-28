import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { type Href, useRouter } from "expo-router";
import { getStoryRepository, isMedia, setPendingMedia, type FilmListItem } from "@mosae/core";
import { FilmCard } from "@/components/ds";
import { MediaPicker, type MediaPickerHandle } from "@/components/MediaPicker";

export default function Home() {
  const [films, setFilms] = useState<FilmListItem[] | null>(null);
  const router = useRouter();
  const pickerRef = useRef<MediaPickerHandle>(null);

  useEffect(() => {
    let active = true;
    void getStoryRepository().listFilms().then((result) => { if (active) setFilms(result); }).catch(() => { if (active) setFilms([]); });
    return () => { active = false; };
  }, []);

  function createFilm() { pickerRef.current?.open(); }
  function startWithMedia(files: File[]) {
    const media = files.filter(isMedia);
    if (media.length === 0) return;
    setPendingMedia(media);
    router.push("/pick-memory" as Href);
  }

  return (
    <View className="flex-1 bg-surface">
      <MediaPicker ref={pickerRef} onFiles={startWithMedia} />
      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-32 pt-4">
        <View className="mb-16 flex-row items-center justify-between">
          <Text className="font-title text-[27px] text-ink">mosaé</Text>
          <Pressable role="button" accessibilityLabel="Settings" className="min-h-11 min-w-11 items-center justify-center rounded-pill bg-surface-sunken"><Text className="text-heading text-ink">⚙</Text></Pressable>
        </View>
        <View>
          <Text role="heading" aria-level={1} className="font-title text-[36px] leading-[42px] text-ink">Many moments. One story.</Text>
          <Text className="mt-4 font-sans text-body leading-[23px] text-ink-muted">Bring in the photos and clips from a trip or celebration. You say what mattered. Mosaé shapes it into a film you can change at every step.</Text>
          <Pressable role="button" onPress={createFilm} className="mt-6 min-h-[56px] flex-row items-center justify-center gap-2 rounded-md bg-action px-5">
            <Text className="font-sans-semibold text-button text-on-action">＋</Text>
            <Text className="font-sans-semibold text-button text-on-action">Create a new film</Text>
          </Pressable>
        </View>
        <View className="mt-10 border-t border-line pt-8">
          <View className="mb-4 flex-row items-center justify-between">
            <Text role="heading" aria-level={2} className="font-title text-[25px] text-ink">Your films</Text>
            {films && films.length > 0 ? <Text className="font-sans text-caption text-ink-muted">{films.length} films</Text> : null}
          </View>
          {films === null ? <Text accessibilityRole="progressbar" className="font-sans text-caption text-ink-muted">Loading your films…</Text> : films.length === 0 ? (
            <View className="rounded-md bg-surface-sunken p-4"><Text className="font-sans text-caption leading-5 text-ink-muted">No films yet. Your first one will live here, and it stays editable.</Text></View>
          ) : (
            <View data-film-grid="true" className="flex-row flex-wrap justify-between gap-y-3">
              {films.map((film) => <View key={film.projectId + "/" + film.filmId} className="w-[48%]">
                <FilmCard title={film.title} meta={film.month} status="Ready to watch" duration={film.duration} posterSource={film.posterUrl ? { uri: film.posterUrl } : undefined} badge={film.justSaved ? "Just saved" : undefined} onPress={() => router.push(("/review-film?repository=api&projectId=" + encodeURIComponent(film.projectId) + "&filmId=" + encodeURIComponent(film.filmId)) as Href)} />
              </View>)}
            </View>
          )}
        </View>
      </ScrollView>
      <View className="absolute inset-x-0 bottom-0 z-20 bg-surface px-4 pb-8 pt-4">
        <Pressable role="button" onPress={createFilm} className="min-h-14 flex-row items-center justify-center gap-2 rounded-pill bg-action px-5">
          <Text className="font-sans-semibold text-button text-on-action">＋</Text>
          <Text className="font-sans-semibold text-button text-on-action">Create a new film</Text>
        </Pressable>
      </View>
    </View>
  );
}
