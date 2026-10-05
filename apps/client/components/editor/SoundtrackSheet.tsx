import { useEffect, useMemo, useRef, useState, createElement } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { EditOp } from "@mosae/contracts";
import type { Soundtrack } from "@mosae/core";

function mood(track: Soundtrack) { return track.mood?.trim() ?? ""; }
function moodLabel(value: string) { return value ? value[0]!.toLocaleUpperCase() + value.slice(1) : value; }
function durationLabel(track: Soundtrack) {
  if (track.durationSec !== undefined && Number.isFinite(track.durationSec) && track.durationSec > 0) {
    const seconds = Math.round(track.durationSec);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return track.description.match(/\b(\d{1,2}:\d{2})\b/)?.[1] ?? null;
}
function stopElement(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

export function SoundtrackSheet({ visible, soundtracks, loading = false, currentSoundtrackId, previewSourceForTrack, onApply, onClose }: {
  visible: boolean;
  soundtracks: Soundtrack[];
  loading?: boolean;
  currentSoundtrackId?: string | null;
  previewSourceForTrack?: (track: Soundtrack) => string | null;
  onApply: (op: EditOp) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Suggested");
  const [previewId, setPreviewId] = useState<string | null>(currentSoundtrackId ?? null);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopPreview = () => {
    stopElement(audioRef.current);
    setPlaying(false);
    setProgress(0);
  };
  const dismiss = () => { stopPreview(); onClose(); };
  useEffect(() => {
    if (!visible) { stopElement(audioRef.current); setPlaying(false); return; }
    setPreviewId(currentSoundtrackId ?? null);
    setQuery("");
    setCategory("Suggested");
    setPreviewRequested(false);
    setPlaybackError(false);
    setProgress(0);
  }, [visible, currentSoundtrackId]);

  useEffect(() => {
    if (visible && !previewId && soundtracks.length) {
      setPreviewId(soundtracks.find((track) => track.suggested)?.id ?? soundtracks[0]!.id);
    }
  }, [visible, previewId, soundtracks]);

  const categories = useMemo(() => ["Suggested", ...new Set(soundtracks.map(mood).filter(Boolean))], [soundtracks]);
  const hasSuggestionMetadata = soundtracks.some((track) => track.suggested !== undefined);
  const filtered = useMemo(() => soundtracks.filter((track) => {
    const matchesQuery = `${track.name} ${track.description}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesCategory = category === "Suggested"
      ? !hasSuggestionMetadata || track.suggested === true
      : mood(track) === category;
    return matchesQuery && matchesCategory;
  }), [soundtracks, query, category, hasSuggestionMetadata]);
  const previewTrack = soundtracks.find((track) => track.id === previewId) ?? null;
  const previewSource = previewTrack ? previewSourceForTrack?.(previewTrack) ?? null : null;

  useEffect(() => {
    if (Platform.OS !== "web" || !visible || !previewRequested || !previewSource) return;
    let active = true;
    const media = audioRef.current;
    if (!media) return;
    void media.play().then(() => { if (active) { setPlaying(true); setPlaybackError(false); } }).catch(() => {
      if (active) { setPlaying(false); setPlaybackError(true); }
    });
    return () => { active = false; };
  }, [visible, previewRequested, previewSource]);
  useEffect(() => () => stopElement(audioRef.current), []);

  const selectTrack = (id: string) => {
    stopPreview();
    setPlaybackError(false);
    setDuration(0);
    setPreviewId(id);
    setPreviewRequested(true);
  };
  const togglePreview = () => {
    if (!previewSource || Platform.OS !== "web") return;
    if (playing) { audioRef.current?.pause(); setPlaying(false); return; }
    setPlaybackError(false);
    setPreviewRequested(false);
    void audioRef.current?.play().then(() => setPlaying(true)).catch(() => { setPlaying(false); setPlaybackError(true); });
  };
  const progressPercent = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;
  const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

  if (!visible) return null;
  return <View className="absolute inset-0 z-20 justify-end bg-black/55">
    <View className="max-h-[86%] rounded-t-[24px] bg-[#111d26] px-5 pb-7 pt-3">
      <View className="mb-4 h-1 w-9 self-center rounded-full bg-[#60717c]" />
      <View className="mb-4 flex-row items-center justify-between"><Text className="font-sans-semibold text-[18px] text-on-screen">Replace music</Text><Pressable accessibilityRole="button" accessibilityLabel="Close soundtrack" onPress={dismiss}><Text className="text-[24px] text-on-screen">×</Text></Pressable></View>
      <TextInput accessibilityLabel="Search soundtracks" placeholder="Search music" placeholderTextColor="#91a2ad" value={query} onChangeText={setQuery} className="mb-3 rounded-xl bg-[#1a2c38] px-4 py-3 font-sans text-body text-on-screen" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3 h-11 shrink-0 grow-0 items-center border-b border-[#344651]" style={{ flexShrink: 0, flexGrow: 0 }}>
          {categories.map((name) => <Pressable accessibilityRole="button" key={name} accessibilityLabel={`Soundtrack mood ${moodLabel(name)}`} onPress={() => setCategory(name)} className={`mr-6 h-11 justify-center border-b-2 px-1 ${category === name ? "border-[#d5eee5]" : "border-transparent"}`}><Text className={`font-sans-medium text-caption ${category === name ? "text-[#d5eee5]" : "text-on-screen-muted"}`}>{moodLabel(name)}</Text></Pressable>)}
        </ScrollView>
        <ScrollView className="min-h-[110px] flex-1">
        {loading ? <View className="items-center py-8"><Text className="font-sans text-body text-on-screen-muted">Loading soundtracks…</Text></View> : filtered.length ? filtered.map((track) => {
          const selected = track.id === previewId;
          const seconds = durationLabel(track);
          return <Pressable accessibilityRole="button" key={track.id} accessibilityLabel={`Preview ${track.name}`} onPress={() => selectTrack(track.id)} className={`mb-1 min-h-[64px] flex-row items-center rounded-xl px-2 ${selected ? "bg-[#1a2c38]" : ""}`}>
            <View className="mr-3 size-11 items-center justify-center rounded-lg bg-[#29443f]"><Text className="text-[18px] text-[#d5eee5]">♫</Text></View>
            <View className="flex-1"><View className="flex-row items-center"><Text numberOfLines={1} className="font-sans-semibold text-button text-on-screen">{track.name}</Text>{track.id === currentSoundtrackId ? <Text className="ml-2 font-sans-medium text-[10px] text-[#b7dfce]">CURRENT</Text> : null}</View><Text numberOfLines={1} className="font-sans text-caption text-on-screen-muted">{mood(track) || track.description}{seconds ? ` · ${seconds}` : ""}</Text></View>
            <Text className="ml-3 text-[18px] text-on-screen">{selected && playing ? "Ⅱ" : "▶"}</Text>
          </Pressable>;
        }) : <View className="items-center py-8"><Text className="font-sans text-body text-on-screen-muted">No soundtracks found</Text><Text className="mt-1 font-sans text-caption text-on-screen-muted">Try another search or mood.</Text></View>}
      </ScrollView>
      {Platform.OS === "web" && previewSource ? createElement("audio", {
        ref: audioRef,
        key: `${previewTrack?.id}:${previewSource}`,
        src: previewSource,
        "data-soundtrack-preview": "true",
        preload: "none",
        hidden: true,
        onTimeUpdate: (event: { currentTarget: HTMLAudioElement }) => setProgress(event.currentTarget.currentTime),
        onLoadedMetadata: (event: { currentTarget: HTMLAudioElement }) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0),
        onEnded: () => { setPlaying(false); setProgress(0); },
        onError: () => { setPlaying(false); setPlaybackError(true); },
      }) : null}
      <View className="mt-3 rounded-2xl bg-[#1a2c38] px-4 py-3">
        <View className="flex-row items-center">
          <Pressable accessibilityRole="button" accessibilityLabel={playing ? "Pause soundtrack preview" : "Play soundtrack preview"} disabled={!previewSource || Platform.OS !== "web"} onPress={togglePreview} className="mr-3 size-10 items-center justify-center rounded-full bg-[#315c50]"><Text className="text-[16px] text-on-screen">{playing ? "Ⅱ" : "▶"}</Text></Pressable>
          <View className="flex-1"><Text numberOfLines={1} className="font-sans-semibold text-caption text-on-screen">{previewTrack?.name ?? "Select a soundtrack"}</Text><Text accessibilityRole="alert" className="font-sans text-[11px] text-on-screen-muted">{playbackError ? "Preview couldn’t play. Tap play to retry." : Platform.OS !== "web" ? "Preview unavailable on this device" : !previewSource ? "Preview unavailable" : `${timeLabel(progress)} / ${timeLabel(duration)}`}</Text><View accessibilityLabel="Soundtrack preview progress" className="relative mt-1 h-11 justify-center"><View pointerEvents="none" className="h-1 overflow-hidden rounded-full bg-[#52636d]"><View className="h-full rounded-full bg-[#d5eee5]" style={{ width: `${progressPercent}%` }} /></View>{createElement("input", { type: "range", min: 0, max: duration || 1, step: 0.1, value: Math.min(progress, duration || 1), disabled: !previewSource || duration <= 0, "aria-label": "Seek soundtrack preview", onInput: (event: { currentTarget: HTMLInputElement }) => { const time = Number(event.currentTarget.value); if (audioRef.current) audioRef.current.currentTime = time; setProgress(time); }, onChange: (event: { currentTarget: HTMLInputElement }) => { const time = Number(event.currentTarget.value); if (audioRef.current) audioRef.current.currentTime = time; setProgress(time); }, style: { position: "absolute", inset: 0, width: "100%", height: 44, margin: 0, opacity: 0, cursor: "pointer", touchAction: "pan-x" } })}</View></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Confirm soundtrack" disabled={!previewTrack} onPress={() => { if (!previewTrack) return; stopPreview(); onApply({ op: "setSoundtrack", soundtrackId: previewTrack.id }); onClose(); }} className="ml-3 size-10 items-center justify-center rounded-full bg-[#d5eee5]"><Text className="text-[20px] text-[#10251f]">✓</Text></Pressable>
        </View>
        {previewSource && Platform.OS === "web" ? null : <Text className="mt-1 text-center font-sans text-[10px] text-on-screen-muted">Selection applies when confirmed</Text>}
      </View>
    </View>
  </View>;
}
