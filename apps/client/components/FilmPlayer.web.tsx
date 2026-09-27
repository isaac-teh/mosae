import type { ImageSourcePropType } from "react-native";
type Props = { source: number | string; poster: ImageSourcePropType; durationSec: number; initialTimeSec?: number; aspect: "portrait" | "landscape"; compact?: boolean };
export function FilmPlayer({ source, aspect, compact = false }: Props) {
  const ratio = compact ? "1.323" : aspect === "portrait" ? "0.8" : "16/9";
  return <video src={typeof source === "string" ? source : undefined} controls playsInline
    style={{ width: "100%", aspectRatio: ratio, borderRadius: 23, background: "#000" }} />;
}
