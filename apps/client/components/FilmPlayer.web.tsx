import { Asset } from "expo-asset";
import { useEffect, useRef, useState } from "react";
import { Pressable, View, type ImageSourcePropType } from "react-native";
import Svg, { Path } from "react-native-svg";
import { fullscreenMode, seekTimeAtPosition } from "./player-controls";

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
  const container = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTimeSec);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sourceUri = typeof source === "string" ? source : Asset.fromModule(source).uri;
  const posterUri = uriOf(poster);
  const ratio = compact ? "75.6%" : aspect === "portrait" ? "125%" : "56.25%";

  useEffect(() => () => { video.current?.pause(); }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [fullscreen]);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  const toggle = async () => {
    const element = video.current;
    if (!element) return;
    if (playing) { element.pause(); setPlaying(false); return; }
    try { await element.play(); setPlaying(true); } catch { setPlaying(false); }
  };
  const seekAt = (clientX: number, bar: HTMLDivElement) => {
    const bounds = bar.getBoundingClientRect();
    const time = seekTimeAtPosition(clientX, bounds.left, bounds.width, durationSec);
    setCurrentTime(time);
    seekVideoTo(time);
  };
  const seekVideoTo = (time: number) => {
    if (!video.current) return;
    if (video.current.readyState >= 1) { video.current.currentTime = (time / durationSec) * video.current.duration; pendingSeek.current = null; }
    else pendingSeek.current = time;
  };
  const enterFullscreen = async () => {
    const element = container.current;
    const media = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    const mode = fullscreenMode(element, media);
    if (mode === "native" && element?.requestFullscreen) {
      try { await element.requestFullscreen(); } catch { setFullscreen(true); }
    } else if (mode === "webkit") media?.webkitEnterFullscreen?.();
    else setFullscreen(true);
  };
  const closeFullscreen = () => {
    if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen();
    setFullscreen(false);
  };
  const seekKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const time = Math.max(0, Math.min(durationSec, currentTime + (event.key === "ArrowRight" ? 5 : -5)));
    setCurrentTime(time);
    seekVideoTo(time);
  };
  const touchStart = useRef<number | null>(null);

  return <View ref={container as never} className={`overflow-hidden ${fullscreen ? "fixed inset-0 z-[9999] h-[100dvh] w-screen bg-black" : "relative w-full rounded-[23px] bg-ink"}`} style={fullscreen ? { paddingTop: 0, paddingBottom: "env(safe-area-inset-bottom)", aspectRatio: undefined, backgroundColor: "black" } as never : { paddingTop: ratio }} onTouchStart={(event: any) => { touchStart.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={(event: any) => { const start = touchStart.current; const end = event.changedTouches[0]?.clientY; if (fullscreen && start !== null && end !== undefined && end - start > 90) closeFullscreen(); touchStart.current = null; }}>
    <video ref={video} src={sourceUri} preload="metadata" playsInline onLoadedMetadata={(event) => { if (pendingSeek.current !== null) { event.currentTarget.currentTime = (pendingSeek.current / durationSec) * event.currentTarget.duration; pendingSeek.current = null; } else if (initialTimeSec > 0) event.currentTarget.currentTime = (initialTimeSec / durationSec) * event.currentTarget.duration; }} onTimeUpdate={(event) => setCurrentTime((event.currentTarget.currentTime / (event.currentTarget.duration || durationSec)) * durationSec)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fullscreen ? "contain" : "cover" }} />
    {!playing && <img src={posterUri} alt="Film poster" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: compact ? "center" : "53% 54%", transform: compact ? undefined : "scale(1.2)" }} />}
    <View className="absolute inset-0 bg-black/20" pointerEvents="none" />
    <Pressable role="button" accessibilityLabel={playing ? "Pause" : "Play"} onPress={() => void toggle()} className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-raised ${compact ? "size-[52px]" : "size-16"}`}>
      {playing ? <Svg width={18} height={22} viewBox="0 0 18 22"><Path d="M2 1h4v20H2V1Zm10 0h4v20h-4V1Z" fill="rgb(var(--color-accent))" /></Svg> : <Svg width={22} height={24} viewBox="0 0 22 24"><Path d="M21.15 10.5a2 2 0 0 1 0 3L3.4 23.2A2 2 0 0 1 .3 21.5V2.5A2 2 0 0 1 3.4.8l17.75 9.7Z" fill="rgb(var(--color-accent))" /></Svg>}
    </Pressable>
    <View className={`absolute bottom-0 left-0 right-0 ${compact ? "h-[82px]" : "h-[96px]"} justify-end px-4 pb-3`} style={{ backgroundImage: "linear-gradient(transparent, rgba(0,0,0,.63))" } as never}>
      <div role="slider" aria-label="Film progress" aria-valuemin={0} aria-valuemax={durationSec} aria-valuenow={currentTime} tabIndex={0} onPointerDown={(event) => { setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); seekAt(event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (dragging) seekAt(event.clientX, event.currentTarget); }} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)} onClick={(event) => seekAt(event.clientX, event.currentTarget)} onKeyDown={seekKey} className="flex h-11 cursor-pointer items-center rounded-full" style={{ touchAction: "none" }}><View className="relative h-[5px] w-full rounded-full bg-surface-raised/40"><View className="h-full rounded-full bg-accent" style={{ width: `${(currentTime / durationSec) * 100}%` }} /><View pointerEvents="none" className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${(currentTime / durationSec) * 100}%` }} /></View></div>
      <View className="flex-row items-center justify-between"><span className="font-sans text-[11px] leading-4 text-on-screen">{formatTime(currentTime)}</span><View className="flex-row items-center gap-2"><VolumeIcon /><button type="button" aria-label="Fullscreen" onClick={() => void enterFullscreen()} className="flex size-11 items-center justify-center"><FullscreenIcon /></button><span className="font-sans text-[11px] leading-4 text-on-screen">{formatTime(durationSec)}</span></View></View>
      </View>
    {fullscreen && <button type="button" aria-label="Close fullscreen" onClick={closeFullscreen} className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex size-11 items-center justify-center rounded-full bg-black/60 text-3xl text-white">×</button>}
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
