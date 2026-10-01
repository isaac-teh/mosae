import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { Player, type PlayerRef } from "@remotion/player";
import { MosaeTimeline } from "@mosae/video/timeline";
import type { Timeline } from "@mosae/contracts";
import { seekTimeAtPosition } from "../player-controls";

export function EditorPreview({ timeline, sources, onTimeChange, seekRequest, playheadSec = 0, pauseRequest = 0, togglePlayRequest = 0, onPlayingChange, poster, onError }: {
  timeline: Timeline;
  sources: Record<string, string>;
  onTimeChange?: (seconds: number) => void;
  seekRequest?: { seconds: number } | null;
  playheadSec?: number;
  pauseRequest?: number;
  togglePlayRequest?: number;
  onPlayingChange?: (playing: boolean) => void;
  poster?: string;
  onError?: (error: Error) => void;
}) {
  const player = useRef<PlayerRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(playheadSec);
  const [dragging, setDragging] = useState(false);
  const lastToggleRequest = useRef(togglePlayRequest);
  const inputProps = useMemo(() => ({ timeline, sources }), [timeline, sources]);
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const time = ({ detail }: { detail: { frame: number } }) => {
      const seconds = detail.frame / timeline.fps;
      setCurrentTime(seconds);
      onTimeChange?.(seconds);
    };
    const play = () => { setPlaying(true); onPlayingChange?.(true); };
    const pause = () => { setPlaying(false); onPlayingChange?.(false); };
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
  }, [timeline.fps, onTimeChange, onPlayingChange]);

  useEffect(() => {
    if (!seekRequest || !player.current) return;
    player.current.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(seekRequest.seconds * timeline.fps))));
  }, [seekRequest, timeline.durationSec, timeline.fps]);

  useEffect(() => {
    if (pauseRequest > 0) player.current?.pause();
  }, [pauseRequest]);

  const playFromPlayhead = () => {
    player.current?.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(currentTime * timeline.fps))));
    player.current?.play();
  };
  useEffect(() => {
    if (togglePlayRequest === lastToggleRequest.current) return;
    lastToggleRequest.current = togglePlayRequest;
    if (playing) player.current?.pause();
    else playFromPlayhead();
  }, [togglePlayRequest, playing]);
  const seekAt = (clientX: number, bar: HTMLDivElement) => {
    const bounds = bar.getBoundingClientRect();
    const seconds = seekTimeAtPosition(clientX, bounds.left, bounds.width, timeline.durationSec);
    setCurrentTime(seconds);
    player.current?.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(seconds * timeline.fps))));
    onTimeChange?.(seconds);
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
  return <View ref={container as never} className="relative size-full overflow-hidden rounded-[14px] bg-[#18211d]">
    <div style={{ position: "absolute", inset: 0 }}>
    <Player ref={player} component={MosaeTimeline} inputProps={inputProps} durationInFrames={Math.max(1, Math.ceil(timeline.durationSec * timeline.fps))}
      compositionWidth={timeline.aspect === "9:16" ? 1080 : 1920} compositionHeight={timeline.aspect === "9:16" ? 1920 : 1080}
      fps={timeline.fps} style={{ width: "100%", height: "100%" }} controls={false} clickToPlay
      renderLoading={() => <View className="absolute inset-0 items-center justify-center bg-[#18211d]">{loadingPoster ? <Image source={{ uri: loadingPoster }} resizeMode="cover" className="size-full opacity-70" /> : <Text className="font-sans text-body text-on-screen">Loading your film…</Text>}</View>}
      errorFallback={({ error }) => <PlayerError error={error} onError={onError} poster={loadingPoster} />} />
    </div>
    <View className="absolute bottom-0 left-0 right-0 px-3 pb-2">
      <div role="slider" aria-label="Film progress" aria-valuemin={0} aria-valuemax={timeline.durationSec} aria-valuenow={currentTime} tabIndex={0} onPointerDown={(event) => { setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); seekAt(event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (dragging) seekAt(event.clientX, event.currentTarget); }} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)} onClick={(event) => seekAt(event.clientX, event.currentTarget)} onKeyDown={seekKey} className="flex h-11 cursor-pointer items-center rounded-full" style={{ touchAction: "none" }}><View className="relative h-[5px] w-full rounded-full bg-white/40"><View className="h-full rounded-full bg-accent" style={{ width: `${(currentTime / timeline.durationSec) * 100}%` }} /><View pointerEvents="none" className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${(currentTime / timeline.durationSec) * 100}%` }} /></View></div>
      <View className="flex-row items-center justify-between"><Text className="font-sans text-caption text-on-screen">{formatTime(currentTime)}</Text><Text className="font-sans text-caption text-on-screen">{formatTime(timeline.durationSec)}</Text></View>
    </View>
  </View>;
}

function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`; }

function PlayerError({ error, onError, poster }: { error: Error; onError?: (error: Error) => void; poster?: string }) {
  useEffect(() => onError?.(error), [error, onError]);
  return <View className="absolute inset-0 items-center justify-center bg-[#18211d]">{poster ? <Image source={{ uri: poster }} resizeMode="cover" className="size-full opacity-70" /> : <Text className="font-sans text-body text-on-screen">Your film preview is unavailable.</Text>}</View>;
}
