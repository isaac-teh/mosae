import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Player, type PlayerRef } from "@remotion/player";
import { createPortal } from "react-dom";
import { MosaeTimeline } from "@mosae/video/timeline";
import type { Timeline } from "@mosae/contracts";
import { fullscreenMode, seekTimeAtPosition } from "../player-controls";

export function EditorPreview({ timeline, sources, onTimeChange, seekRequest, playheadSec = 0, pauseRequest = 0, poster, onError }: {
  timeline: Timeline;
  sources: Record<string, string>;
  onTimeChange?: (seconds: number) => void;
  seekRequest?: { seconds: number } | null;
  playheadSec?: number;
  pauseRequest?: number;
  poster?: string;
  onError?: (error: Error) => void;
}) {
  const player = useRef<PlayerRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(playheadSec);
  const [fullscreen, setFullscreen] = useState(false);
  const overlayFullscreen = useRef(false);
  const [dragging, setDragging] = useState(false);
  const touchStart = useRef<number | null>(null);
  const inputProps = useMemo(() => ({ timeline, sources }), [timeline, sources]);
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const time = ({ detail }: { detail: { frame: number } }) => {
      const seconds = detail.frame / timeline.fps;
      setCurrentTime(seconds);
      onTimeChange?.(seconds);
    };
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    current.addEventListener("timeupdate", time);
    current.addEventListener("frameupdate", time);
    current.addEventListener("play", play);
    current.addEventListener("pause", pause);
    current.addEventListener("ended", pause);
    return () => {
      current.removeEventListener("timeupdate", time);
      current.removeEventListener("frameupdate", time);
      current.removeEventListener("play", play);
      current.removeEventListener("pause", pause);
      current.removeEventListener("ended", pause);
    };
  }, [timeline.fps, onTimeChange]);

  useEffect(() => {
    if (!seekRequest || !player.current) return;
    player.current.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(seekRequest.seconds * timeline.fps))));
  }, [seekRequest, timeline.durationSec, timeline.fps]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [fullscreen]);

  useEffect(() => {
    const changed = () => {
      const nativeFullscreen = document.fullscreenElement === container.current;
      if (nativeFullscreen) overlayFullscreen.current = false;
      if (!overlayFullscreen.current) setFullscreen(nativeFullscreen);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  useEffect(() => {
    if (pauseRequest > 0) player.current?.pause();
  }, [pauseRequest]);

  const playFromPlayhead = () => {
    player.current?.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(currentTime * timeline.fps))));
    player.current?.play();
  };
  const seekAt = (clientX: number, bar: HTMLDivElement) => {
    const bounds = bar.getBoundingClientRect();
    const seconds = seekTimeAtPosition(clientX, bounds.left, bounds.width, timeline.durationSec);
    setCurrentTime(seconds);
    player.current?.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(seconds * timeline.fps))));
    onTimeChange?.(seconds);
  };
  const enterFullscreen = async () => {
    const element = container.current;
    if (fullscreenMode(element, null) === "native" && element?.requestFullscreen) {
      try {
        await element.requestFullscreen();
        return;
      } catch {
        // Safari may expose a fullscreen method without supporting it here.
      }
    }
    overlayFullscreen.current = true;
    setFullscreen(true);
  };
  const closeFullscreen = () => {
    if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen();
    overlayFullscreen.current = false;
    setFullscreen(false);
  };
  const seekKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const seconds = Math.max(0, Math.min(timeline.durationSec, currentTime + (event.key === "ArrowRight" ? 5 : -5)));
    setCurrentTime(seconds);
    player.current?.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(seconds * timeline.fps))));
    onTimeChange?.(seconds);
  };

  const first = timeline.videoClips[0];
  const firstShotId = first && ("kind" in first ? first.spec.slots[0]?.shotId : first.source.shotId);
  const loadingPoster = (poster ?? (firstShotId ? sources[firstShotId] : undefined));


  const playerRatio = timeline.aspect === "9:16" ? 9 / 16 : 16 / 9;
  const preview = <View ref={container as never} className={`size-full overflow-hidden ${fullscreen ? "fixed inset-0 z-[9999] flex h-[100dvh] w-screen items-center justify-center bg-black" : "relative rounded-[14px] bg-[#18211d]"}`} style={fullscreen ? { paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" } as never : undefined}
    onTouchStart={(event: any) => { touchStart.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={(event: any) => { const start = touchStart.current; const end = event.changedTouches[0]?.clientY; if (fullscreen && start !== null && end !== undefined && end - start > 90) closeFullscreen(); touchStart.current = null; }}>
    <div style={fullscreen ? { position: "absolute", top: "env(safe-area-inset-top)", right: 0, bottom: "env(safe-area-inset-bottom)", left: 0, display: "flex", alignItems: "center", justifyContent: "center" } : { position: "absolute", inset: 0 }}>
    <Player ref={player} component={MosaeTimeline} inputProps={inputProps} durationInFrames={Math.max(1, Math.ceil(timeline.durationSec * timeline.fps))}
      compositionWidth={timeline.aspect === "9:16" ? 1080 : 1920} compositionHeight={timeline.aspect === "9:16" ? 1920 : 1080}
      fps={timeline.fps} style={fullscreen ? { width: timeline.aspect === "9:16" ? "min(100vw, 56.25dvh)" : "min(100vw, 177.78dvh)", height: "auto", aspectRatio: playerRatio } : { width: "100%", height: "100%" }} controls={false} clickToPlay
      renderLoading={() => <View className="absolute inset-0 items-center justify-center bg-[#18211d]">{loadingPoster ? <Image source={{ uri: loadingPoster }} resizeMode="cover" className="size-full opacity-70" /> : <Text className="font-sans text-body text-on-screen">Loading your film…</Text>}</View>}
      errorFallback={({ error }) => <PlayerError error={error} onError={onError} poster={loadingPoster} />} />
    </div>
    {!playing && <Pressable role="button" accessibilityLabel="Play preview" onPress={playFromPlayhead}
      className="absolute left-1/2 top-1/2 size-[62px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60">
      <Text className="ml-1 font-sans text-[28px] text-on-screen">▶</Text>
    </Pressable>}
    <View className={`absolute left-0 right-0 ${fullscreen ? "bottom-[env(safe-area-inset-bottom)] z-10 px-5 pb-3" : "bottom-0 px-3 pb-2"}`}>
      <div role="slider" aria-label="Film progress" aria-valuemin={0} aria-valuemax={timeline.durationSec} aria-valuenow={currentTime} tabIndex={0} onPointerDown={(event) => { setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); seekAt(event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (dragging) seekAt(event.clientX, event.currentTarget); }} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)} onClick={(event) => seekAt(event.clientX, event.currentTarget)} onKeyDown={seekKey} className="flex h-11 cursor-pointer items-center rounded-full" style={{ touchAction: "none" }}><View className="relative h-[5px] w-full rounded-full bg-white/40"><View className="h-full rounded-full bg-accent" style={{ width: `${(currentTime / timeline.durationSec) * 100}%` }} /><View pointerEvents="none" className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${(currentTime / timeline.durationSec) * 100}%` }} /></View></div>
      <View className="flex-row items-center justify-between"><Text className="font-sans text-caption text-on-screen">{formatTime(currentTime)}</Text><div className="flex items-center gap-2"><Text className="font-sans text-caption text-on-screen">{formatTime(timeline.durationSec)}</Text><button type="button" aria-label="Fullscreen" onClick={() => void enterFullscreen()} className="flex size-11 items-center justify-center rounded-full bg-black/45 text-2xl text-white">⛶</button></div></View>
    </View>
    {fullscreen && <button type="button" aria-label="Close fullscreen" onClick={closeFullscreen} className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-20 flex size-11 items-center justify-center rounded-full bg-black/60 text-3xl text-white">×</button>}
  </View>;
  return overlayFullscreen.current ? createPortal(preview, document.body) : preview;
}

function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`; }

function PlayerError({ error, onError, poster }: { error: Error; onError?: (error: Error) => void; poster?: string }) {
  useEffect(() => onError?.(error), [error, onError]);
  return <View className="absolute inset-0 items-center justify-center bg-[#18211d]">{poster ? <Image source={{ uri: poster }} resizeMode="cover" className="size-full opacity-70" /> : <Text className="font-sans text-body text-on-screen">Your film preview is unavailable.</Text>}</View>;
}
