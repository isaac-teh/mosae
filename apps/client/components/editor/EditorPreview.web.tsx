import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { Player, type PlayerRef } from "@remotion/player";
import { MosaeTimeline } from "@mosae/video/timeline";
import type { Timeline } from "@mosae/contracts";

export function EditorPreview({ timeline, sources, onTimeChange, seekRequest, playheadSec = 0, pauseRequest = 0, togglePlayRequest = 0, onPlayingChange, poster, onError, selectedClipId, onSelectClip, onCommitPhotoCrop, selectedCollageCellId, onSelectCollageCell, onCommitCollageCrop }: {
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
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string) => void;
  onCommitPhotoCrop?: (clipId: string, crop: { x: number; y: number; scale: number; rotationDeg?: number }) => void;
  selectedCollageCellId?: string | null;
  onSelectCollageCell?: (clipId: string, slotId: string) => void;
  onCommitCollageCrop?: (clipId: string, slotId: string, crop: { x: number; y: number; scale: number; rotationDeg?: number }) => void;
}) {
  const player = useRef<PlayerRef>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(playheadSec);
  const currentTimeRef = useRef(playheadSec);
  const lastToggleRequest = useRef(togglePlayRequest);
  const inputProps = useMemo(() => ({ timeline, sources, selectedClipId, onSelectClip, onCommitPhotoCrop, selectedCollageCellId, onSelectCollageCell, onCommitCollageCrop }), [timeline, sources, selectedClipId, onSelectClip, onCommitPhotoCrop, selectedCollageCellId, onSelectCollageCell, onCommitCollageCrop]);
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const time = ({ detail }: { detail: { frame: number } }) => {
      const seconds = detail.frame / timeline.fps;
      currentTimeRef.current = seconds;
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
    const seconds = Math.max(0, Math.min(timeline.durationSec, seekRequest.seconds));
    currentTimeRef.current = seconds;
    setCurrentTime(seconds);
    player.current.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(seconds * timeline.fps))));
  }, [seekRequest, timeline.durationSec, timeline.fps]);

  useEffect(() => {
    if (pauseRequest > 0) player.current?.pause();
  }, [pauseRequest]);

  const playFromPlayhead = () => {
    player.current?.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(currentTimeRef.current * timeline.fps))));
    player.current?.play();
  };
  useEffect(() => {
    if (togglePlayRequest === lastToggleRequest.current) return;
    lastToggleRequest.current = togglePlayRequest;
    if (playing) player.current?.pause();
    else playFromPlayhead();
  }, [togglePlayRequest, playing]);
  const togglePlayback = () => {
    if (playing) {
      player.current?.pause();
      setPlaying(false);
      onPlayingChange?.(false);
    } else {
      playFromPlayhead();
      setPlaying(true);
      onPlayingChange?.(true);
    }
  };

  const first = timeline.videoClips[0];
  const firstShotId = first && ("kind" in first ? first.spec.slots[0]?.shotId : first.source.shotId);
  const loadingPoster = (poster ?? (firstShotId ? sources[firstShotId] : undefined));
  return <View className="mosae-editor-preview relative size-full overflow-hidden rounded-[14px] bg-[#18211d]">
    <style>{`.mosae-editor-preview [data-collage-cell][aria-pressed="true"] { border-color: #168dff !important; border-width: 12px !important; }`}</style>
    <div role="button" aria-label={playing ? "Pause preview" : "Play preview"} data-current-time={currentTime} tabIndex={0} onClick={togglePlayback} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); togglePlayback(); } }} style={{ position: "absolute", inset: 0 }}>
    <Player ref={player} component={MosaeTimeline} inputProps={inputProps} durationInFrames={Math.max(1, Math.ceil(timeline.durationSec * timeline.fps))}
      compositionWidth={timeline.aspect === "9:16" ? 1080 : 1920} compositionHeight={timeline.aspect === "9:16" ? 1920 : 1080}
      fps={timeline.fps} style={{ width: "100%", height: "100%" }} controls={false}
      renderLoading={() => <View className="absolute inset-0 items-center justify-center bg-[#18211d]">{loadingPoster ? <Image source={{ uri: loadingPoster }} resizeMode="cover" className="size-full opacity-70" /> : <Text className="font-sans text-body text-on-screen">Loading your film…</Text>}</View>}
      errorFallback={({ error }) => <PlayerError error={error} onError={onError} poster={loadingPoster} />} />
    </div>
  </View>;
}

function PlayerError({ error, onError, poster }: { error: Error; onError?: (error: Error) => void; poster?: string }) {
  useEffect(() => onError?.(error), [error, onError]);
  return <View className="absolute inset-0 items-center justify-center bg-[#18211d]">{poster ? <Image source={{ uri: poster }} resizeMode="cover" className="size-full opacity-70" /> : <Text className="font-sans text-body text-on-screen">Your film preview is unavailable.</Text>}</View>;
}
