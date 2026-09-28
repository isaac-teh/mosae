import { Asset } from "expo-asset";
import { useEffect, useRef, useState } from "react";
import { Pressable, View, type ImageSourcePropType } from "react-native";
import Svg, { Path } from "react-native-svg";

type FilmPlayerProps = {
  /** A bundled module, or the URL of the rendered film. */
  source: number | string;
  poster: ImageSourcePropType;
  durationSec: number;
  initialTimeSec?: number;
  aspect: "portrait" | "landscape";
  compact?: boolean;
};

const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

export function FilmPlayer({ source, poster, durationSec, initialTimeSec = 0, aspect, compact = false }: FilmPlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTimeSec);
  const sourceUri = typeof source === "string" ? source : Asset.fromModule(source).uri;
  const posterUri = uriOf(poster);
  const ratio = compact ? "75.6%" : aspect === "portrait" ? "125%" : "56.25%";

  useEffect(() => () => { video.current?.pause(); }, []);

  const toggle = async () => {
    const element = video.current;
    if (!element) return;
    if (playing) { element.pause(); setPlaying(false); return; }
    try { await element.play(); setPlaying(true); } catch { setPlaying(false); }
  };
  const scrub = (event: React.MouseEvent<HTMLDivElement>) => {
    const fraction = Math.max(0, Math.min(1, event.nativeEvent.offsetX / event.currentTarget.clientWidth));
    setCurrentTime(fraction * durationSec);
    if (video.current?.duration) video.current.currentTime = fraction * video.current.duration;
  };

  return <View className="relative w-full overflow-hidden rounded-[23px] bg-ink" style={{ paddingTop: ratio }}>
    <video ref={video} src={sourceUri} preload="metadata" playsInline onTimeUpdate={(event) => setCurrentTime((event.currentTarget.currentTime / (event.currentTarget.duration || durationSec)) * durationSec)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
    {!playing && <img src={posterUri} alt="Film poster" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: compact ? "center" : "53% 54%", transform: compact ? undefined : "scale(1.2)" }} />}
    <View className="absolute inset-0 bg-black/20" pointerEvents="none" />
    <Pressable role="button" aria-label={playing ? "Pause" : "Play"} onPress={() => void toggle()} className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-raised ${compact ? "size-[52px]" : "size-16"}`}>
      {playing ? <Svg width={18} height={22} viewBox="0 0 18 22"><Path d="M2 1h4v20H2V1Zm10 0h4v20h-4V1Z" fill="rgb(var(--color-accent))" /></Svg> : <Svg width={22} height={24} viewBox="0 0 22 24"><Path d="M21.15 10.5a2 2 0 0 1 0 3L3.4 23.2A2 2 0 0 1 .3 21.5V2.5A2 2 0 0 1 3.4.8l17.75 9.7Z" fill="rgb(var(--color-accent))" /></Svg>}
    </Pressable>
    {!compact && <View className="absolute bottom-0 left-0 right-0 h-[76px] justify-end px-4 pb-3" style={{ backgroundImage: "linear-gradient(transparent, rgba(0,0,0,.63))" } as never}>
      <div role="slider" aria-label="Film progress" onClick={scrub} className="h-[5px] overflow-hidden rounded-full bg-surface-raised/40"><View className="h-full rounded-full bg-accent" style={{ width: `${(currentTime / durationSec) * 100}%` }} /></div>
      <View className="mt-1.5 flex-row items-center justify-between"><span className="font-sans text-[11px] leading-4 text-on-screen">{formatTime(currentTime)}</span><View className="flex-row items-center gap-2"><VolumeIcon /><FullscreenIcon /><span className="font-sans text-[11px] leading-4 text-on-screen">{formatTime(durationSec)}</span></View></View>
    </View>}
  </View>;
}

function VolumeIcon() { return <Svg width={13} height={13} viewBox="0 0 13 13"><Path d="M1 5h2.5L7 2v9L3.5 8H1V5Zm8.5.4a2.2 2.2 0 0 1 0 2.2M11 3.8a4.4 4.4 0 0 1 0 5.4" fill="none" stroke="white" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" /></Svg>; }
function FullscreenIcon() { return <Svg width={13} height={13} viewBox="0 0 13 13"><Path d="M1 4V1h3M9 1h3v3M12 9v3H9M4 12H1V9" fill="none" stroke="white" strokeWidth={1} strokeLinecap="round" /></Svg>; }

/** A poster is a bundled module on the demo, and `{ uri }` once it is a real thumbnail. */
function uriOf(image: ImageSourcePropType): string | undefined {
  if (typeof image === "number") return Asset.fromModule(image).uri;
  if (Array.isArray(image)) return image[0]?.uri;
  return image.uri;
}
