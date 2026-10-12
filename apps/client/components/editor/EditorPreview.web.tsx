import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { Player, type PlayerRef } from "@remotion/player";
import { createPortal } from "react-dom";
import { MosaeTimeline } from "@mosae/video/timeline";
import type { Timeline } from "@mosae/contracts";
import { formatFilmTime, fullscreenMode, seekTimeAtPosition } from "../player-controls";

export function EditorPreview({ timeline, sources, onTimeChange, seekRequest, playheadSec = 0, pauseRequest = 0, togglePlayRequest = 0, onPlayingChange, poster, onError, selectedClipId, onSelectClip, onCommitPhotoCrop, selectedCollageCellId, onSelectCollageCell, onCommitCollageCrop, controls }: {
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
  controls?: "chat";
}) {
  const player = useRef<PlayerRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const portalAnchor = useRef<HTMLDivElement>(null);
  const [portalHost] = useState<HTMLDivElement | null>(() => typeof document === "undefined" ? null : document.createElement("div"));
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(playheadSec);
  const [fullscreen, setFullscreen] = useState(false);
  const [overlayFullscreen, setOverlayFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const currentTimeRef = useRef(playheadSec);
  const lastToggleRequest = useRef(togglePlayRequest);
  const inputProps = useMemo(() => ({ timeline, sources, selectedClipId, onSelectClip, onCommitPhotoCrop, selectedCollageCellId, onSelectCollageCell, onCommitCollageCrop }), [timeline, sources, selectedClipId, onSelectClip, onCommitPhotoCrop, selectedCollageCellId, onSelectCollageCell, onCommitCollageCrop]);
  useLayoutEffect(() => {
    if (controls === "chat") return;
    player.current?.seekTo(0);
  }, [controls]);
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

  useLayoutEffect(() => {
    if (controls !== "chat" || !portalHost) return;
    const anchor = portalAnchor.current;
    if (!anchor?.parentNode) return;
    anchor.parentNode.insertBefore(portalHost, anchor);
    return () => portalHost.remove();
  }, [controls, portalHost]);

  useLayoutEffect(() => {
    if (controls !== "chat" || !portalHost) return;
    const anchor = portalAnchor.current;
    if (!anchor?.parentNode) return;
    if (overlayFullscreen) document.body.appendChild(portalHost);
    else anchor.parentNode.insertBefore(portalHost, anchor);
  }, [controls, overlayFullscreen, portalHost]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [fullscreen]);

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
  const seekTo = (seconds: number) => {
    const clamped = Math.max(0, Math.min(timeline.durationSec, seconds));
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
    player.current?.seekTo(Math.max(0, Math.min(Math.ceil(timeline.durationSec * timeline.fps) - 1, Math.round(clamped * timeline.fps))));
    onTimeChange?.(clamped);
  };
  const seekAt = (clientX: number, bar: HTMLDivElement) => {
    const bounds = bar.getBoundingClientRect();
    seekTo(seekTimeAtPosition(clientX, bounds.left, bounds.width, timeline.durationSec));
  };
  const seekKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    seekTo(currentTimeRef.current + (event.key === "ArrowRight" ? 5 : -5));
  };
  const enterFullscreen = async () => {
    const element = container.current;
    const mode = fullscreenMode(element, null);
    if (mode === "native" && element?.requestFullscreen) {
      try {
        await element.requestFullscreen();
        setFullscreen(true);
        return;
      } catch {
        // Safari may expose requestFullscreen without supporting it for this element.
      }
    }
    setOverlayFullscreen(controls === "chat");
    setFullscreen(true);
  };
  const closeFullscreen = () => {
    if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen();
    setOverlayFullscreen(false);
    setFullscreen(false);
  };

  const first = timeline.videoClips[0];
  const firstShotId = first && ("kind" in first ? first.spec.slots[0]?.shotId : first.source.shotId);
  const loadingPoster = (poster ?? (firstShotId ? sources[firstShotId] : undefined));
  const previewContent = <>
    <style>{`.mosae-editor-preview [data-collage-cell][aria-pressed="true"] { border-color: #168dff !important; border-width: 12px !important; }`}</style>
    <div role="button" aria-label={playing ? "Pause preview" : "Play preview"} data-current-time={currentTime} tabIndex={0} onClick={togglePlayback} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); togglePlayback(); } }} style={{ position: "absolute", top: fullscreen && controls === "chat" ? "env(safe-area-inset-top)" : 0, right: 0, bottom: fullscreen && controls === "chat" ? "env(safe-area-inset-bottom)" : 0, left: 0 }}>
    <Player ref={player} component={MosaeTimeline} inputProps={inputProps} initialFrame={0} durationInFrames={Math.max(1, Math.ceil(timeline.durationSec * timeline.fps))}
      compositionWidth={timeline.aspect === "9:16" ? 1080 : 1920} compositionHeight={timeline.aspect === "9:16" ? 1920 : 1080}
      fps={timeline.fps} style={{ width: "100%", height: "100%" }} controls={false}
      renderLoading={() => <View className="absolute inset-0 items-center justify-center bg-[#18211d]">{loadingPoster ? <Image source={{ uri: loadingPoster }} resizeMode="cover" className="size-full opacity-70" /> : <Text className="font-sans text-body text-on-screen">Loading your film…</Text>}</View>}
      errorFallback={({ error }) => <PlayerError error={error} onError={onError} poster={loadingPoster} />} />
    </div>
    {controls === "chat" && <div className={`absolute inset-x-0 z-10 h-auto px-4 pb-3 pt-2 ${fullscreen ? "bottom-[env(safe-area-inset-bottom)]" : "bottom-0"}`} style={{ backgroundImage: "linear-gradient(transparent, rgba(0,0,0,.68))" }} onClick={(event) => event.stopPropagation()}>
      <div role="slider" aria-label="Film progress" aria-valuemin={0} aria-valuemax={timeline.durationSec} aria-valuenow={currentTime} tabIndex={0} onPointerDown={(event) => { setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); seekAt(event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (dragging) seekAt(event.clientX, event.currentTarget); }} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)} onTouchStart={(event) => { setDragging(true); seekAt(event.touches[0].clientX, event.currentTarget); }} onTouchMove={(event) => { if (dragging) seekAt(event.touches[0].clientX, event.currentTarget); }} onTouchEnd={() => setDragging(false)} onKeyDown={seekKey} className="flex h-11 cursor-pointer items-center rounded-full" style={{ touchAction: "none" }}><View className="relative h-[5px] w-full rounded-full bg-white/40"><View className="h-full rounded-full bg-accent" style={{ width: `${(currentTime / timeline.durationSec) * 100}%` }} /><View pointerEvents="none" className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${(currentTime / timeline.durationSec) * 100}%` }} /></View></div>
      <div className="flex items-center justify-between"><span data-testid="film-current-time" className="font-sans text-[11px] leading-4 text-white">{formatFilmTime(currentTime)}</span><div className="flex items-center"><button type="button" aria-label="Fullscreen" onClick={() => void enterFullscreen()} className="flex size-11 items-center justify-center text-white"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg></button><span data-testid="film-duration" className="font-sans text-[11px] leading-4 text-white">{formatFilmTime(timeline.durationSec)}</span></div></div>
    </div>}
    {fullscreen && <button type="button" aria-label="Close fullscreen" onClick={(event) => { event.stopPropagation(); closeFullscreen(); }} className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-20 flex size-11 items-center justify-center rounded-full bg-black/60 text-3xl text-white">×</button>}
  </>;
  if (controls === "chat") {
    if (portalHost) {
      container.current = portalHost;
      portalHost.className = `mosae-editor-preview overflow-hidden bg-[#18211d] ${fullscreen ? "fixed inset-0 z-[9999] h-[100dvh] w-screen rounded-none" : "relative size-full rounded-[14px]"}`;
      portalHost.style.paddingTop = fullscreen ? "env(safe-area-inset-top)" : "";
      portalHost.style.paddingBottom = fullscreen ? "env(safe-area-inset-bottom)" : "";
    }
    return <View className="relative size-full"><div ref={portalAnchor as never} className="absolute inset-0 pointer-events-none" />{portalHost && createPortal(previewContent, portalHost)}</View>;
  }
  return <View ref={container as never} className={`mosae-editor-preview overflow-hidden bg-[#18211d] ${fullscreen ? "fixed inset-0 z-[9999] h-[100dvh] w-screen rounded-none" : "relative size-full rounded-[14px]"}`}>{previewContent}</View>;
}

function PlayerError({ error, onError, poster }: { error: Error; onError?: (error: Error) => void; poster?: string }) {
  useEffect(() => onError?.(error), [error, onError]);
  return <View className="absolute inset-0 items-center justify-center bg-[#18211d]">{poster ? <Image source={{ uri: poster }} resizeMode="cover" className="size-full opacity-70" /> : <Text className="font-sans text-body text-on-screen">Your film preview is unavailable.</Text>}</View>;
}
