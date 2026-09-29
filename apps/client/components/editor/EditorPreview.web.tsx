import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Player, type PlayerRef } from "@remotion/player";
import { MosaeTimeline } from "@mosae/video/timeline";
import type { Timeline } from "@mosae/contracts";

export function EditorPreview({ timeline, sources, onTimeChange }: {
  timeline: Timeline;
  sources: Record<string, string>;
  onTimeChange?: (seconds: number) => void;
}) {
  const player = useRef<PlayerRef>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const current = player.current;
    if (!current) return;
    const time = ({ detail }: { detail: { frame: number } }) => onTimeChange?.(detail.frame / timeline.fps);
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    current.addEventListener("timeupdate", time);
    current.addEventListener("play", play);
    current.addEventListener("pause", pause);
    current.addEventListener("ended", pause);
    return () => {
      current.removeEventListener("timeupdate", time);
      current.removeEventListener("play", play);
      current.removeEventListener("pause", pause);
      current.removeEventListener("ended", pause);
    };
  }, [timeline.fps, onTimeChange]);

  return <View className="relative size-full overflow-hidden rounded-[14px] bg-[#18211d]">
    <Player ref={player} component={MosaeTimeline} inputProps={{ timeline, sources }} durationInFrames={Math.max(1, Math.ceil(timeline.durationSec * timeline.fps))}
      compositionWidth={timeline.aspect === "9:16" ? 1080 : 1920} compositionHeight={timeline.aspect === "9:16" ? 1920 : 1080}
      fps={timeline.fps} style={{ width: "100%", height: "100%" }} controls={false} clickToPlay />
    {!playing && <Pressable role="button" accessibilityLabel="Play preview" onPress={() => player.current?.play()}
      className="absolute left-1/2 top-1/2 size-[62px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60">
      <Text className="ml-1 font-sans text-[28px] text-on-screen">▶</Text>
    </Pressable>}
  </View>;
}
