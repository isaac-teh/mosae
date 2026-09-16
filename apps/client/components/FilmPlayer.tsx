import { Image, Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";

type FilmPlayerProps = {
  source: number;
  poster: number;
  durationSec: number;
  initialTimeSec?: number;
  aspect: "portrait" | "landscape";
};

export function FilmPlayer({ poster, aspect }: FilmPlayerProps) {
  return <View className={`relative overflow-hidden rounded-[23px] bg-ink ${aspect === "portrait" ? "aspect-[0.8]" : "aspect-video"}`}>
    <Image source={poster} resizeMode="cover" className="size-full" />
    <View className="absolute inset-0 items-center justify-center bg-black/25"><Pressable role="button" aria-label="Play" className="size-16 items-center justify-center rounded-full bg-white"><Svg width={22} height={24} viewBox="0 0 22 24"><Path d="M21.15 10.5a2 2 0 0 1 0 3L3.4 23.2A2 2 0 0 1 .3 21.5V2.5A2 2 0 0 1 3.4.8l17.75 9.7Z" fill="#B63315" /></Svg></Pressable></View>
  </View>;
}
