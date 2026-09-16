import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Asset } from "expo-asset";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { getStoryRepository, type Film } from "@mosae/core";
import { FilmPlayer } from "@/components/FilmPlayer";
import { StepHeader } from "@/components/StepHeader";
import { demoImage } from "@/lib/demoAssets";

function PinIcon() { return <Svg width={13} height={13} viewBox="0 0 13 13"><Path d="M6.5 11.5s4-3.13 4-6.1a4 4 0 1 0-8 0c0 2.97 4 6.1 4 6.1Z" fill="none" stroke="#A56808" strokeWidth={1.3} /><Circle cx={6.5} cy={5.25} r={1.2} fill="#A56808" /></Svg>; }
function DownloadIcon() { return <Svg width={21} height={21} viewBox="0 0 21 21"><Path d="M10.5 3v10m0 0 3.5-3.5M10.5 13 7 9.5M4 14.5v2.2c0 .72.58 1.3 1.3 1.3h10.4c.72 0 1.3-.58 1.3-1.3v-2.2" fill="none" stroke="#B63315" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /></Svg>; }
function WhatsAppIcon() { return <Svg width={22} height={22} viewBox="0 0 22 22"><Path d="M18 10.4a7 7 0 0 1-10.33 6.16L4 17.5l1.05-3.48A7 7 0 1 1 18 10.4Z" fill="none" stroke="#1BC65B" strokeWidth={1.8} strokeLinejoin="round" /><Path d="M8.2 7.5c.25 2 1.48 3.2 3.45 3.55l.8-1.02 1.35.65c-.18.9-.72 1.35-1.35 1.35-2.8-.26-4.35-1.8-4.65-4.55 0-.68.45-1.17 1.35-1.4l.68 1.42-1 .7Z" fill="#1BC65B" /></Svg>; }
function InstagramIcon() { return <Svg width={22} height={22} viewBox="0 0 22 22"><Rect x={3.2} y={3.2} width={15.6} height={15.6} rx={4.2} fill="none" stroke="#BD3518" strokeWidth={1.8} /><Circle cx={11} cy={11} r={3.55} fill="none" stroke="#BD3518" strokeWidth={1.8} /><Circle cx={16.25} cy={5.9} r={1} fill="#BD3518" /></Svg>; }
function FacebookIcon() { return <Svg width={22} height={22} viewBox="0 0 22 22"><Circle cx={11} cy={11} r={9} fill="#08798C" /><Path d="M12.15 17v-5.1h1.72l.26-2h-1.98V8.62c0-.58.16-.97.99-.97h1.05V5.86c-.18-.02-.8-.08-1.53-.08-1.51 0-2.55.92-2.55 2.62V9.9H8.4v2h1.7V17h2.05Z" fill="white" /></Svg>; }
function GalleryIcon() { return <Svg width={20} height={20} viewBox="0 0 20 20"><Rect x={2.5} y={3} width={12.5} height={12.5} rx={1.2} fill="none" stroke="#1C1C19" strokeWidth={1.5} /><Path d="m4.5 13 3.1-3.1 2.25 2.25 1.7-1.7 2.45 2.55M10.5 3V1.8h6.8v12.6h-2.3" fill="none" stroke="#1C1C19" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></Svg>; }

export default function SaveFilmScreen() {
  const router = useRouter();
  const { filmId } = useLocalSearchParams<{ filmId: string }>();
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comingSoon, setComingSoon] = useState(false);
  useEffect(() => { void getStoryRepository().getFilm(filmId).then(setFilm).catch((cause: Error) => setError(cause.message)); }, [filmId]);
  const download = () => {
    const anchor = document.createElement("a");
    anchor.href = Asset.fromModule(require("../assets/demo/film.mp4")).uri;
    anchor.download = "Mei's 7th Birthday in Japan.mp4";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  if (error) return <View className="flex-1 items-center justify-center bg-canvas"><Text className="text-brand">{error}</Text></View>;
  if (!film) return <View className="flex-1 bg-canvas"><StepHeader step="STEP 6 OF 6" label="COMPLETE" progress={1} onBack={() => router.back()} backLabel="Go back to your film" /></View>;
  const share = (name: string, icon: React.ReactNode, onPress: () => void) => <Pressable key={name} role="button" aria-label={name} onPress={onPress} className="w-[72px] items-center"><View className="size-12 items-center justify-center rounded-full bg-white shadow-[0_2px_10px_rgba(66,50,40,0.06)]">{icon}</View><Text className="mt-1.5 font-sans-medium text-[11px] text-ink">{name}</Text></Pressable>;
  return <View className="flex-1 bg-canvas"><StepHeader step="STEP 6 OF 6" label="COMPLETE" progress={1} onBack={() => router.back()} backLabel="Go back to your film" />
    <ScrollView className="flex-1" contentContainerClassName="min-h-[845px] px-5 pb-3" showsVerticalScrollIndicator={false}>
      <View className="pt-[23px]"><Text className="font-sans-semibold text-[15px] leading-5 text-ink">Your memory is ready</Text><Text className="mt-1 font-sans text-sm leading-[22px] text-ink-soft">Crafted with love and safeguarded in your memory{`\n`}gallery.</Text></View>
      <View className="mt-[14px] rounded-[38px] bg-white px-4 pb-[18px] pt-3 shadow-[0_8px_24px_rgba(66,50,40,0.07)]"><View><FilmPlayer source={require("../assets/demo/film.mp4")} poster={demoImage(film.savePosterKey)} durationSec={film.durationSec} aspect="landscape" compact /><View className="absolute bottom-2.5 left-2.5 flex-row items-center rounded-full bg-black/75 px-2 py-1"><Text className="mr-1 text-[10px] text-white">▣</Text><Text className="font-sans-medium text-[11px] text-white">4K Master Audio • 2:10</Text></View></View><Text className="mt-4 font-serif text-[19px] leading-6 text-ink">Mei’s 7th Birthday in Japan</Text><View className="mt-1 flex-row items-center"><PinIcon /><Text className="ml-1 font-sans text-xs text-ink-soft">Tokyo & Kyoto • March 2026</Text></View></View>
      <Text className="mt-[23px] px-1 font-sans-medium text-[11px] tracking-[.35px] text-ink-soft">CHOOSE WHERE TO SHARE</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4 -mr-5"><View className="flex-row gap-2 pr-2">{share("Download", <DownloadIcon />, download)}{share("WhatsApp", <WhatsAppIcon />, () => setComingSoon(true))}{share("Instagram", <InstagramIcon />, () => setComingSoon(true))}{share("Facebook", <FacebookIcon />, () => setComingSoon(true))}{share("More", <Text className="text-lg text-ink-soft">•••</Text>, () => setComingSoon(true))}</View></ScrollView>
      {comingSoon && <Text className="mt-2 px-1 font-sans text-xs text-ink-soft">Coming soon</Text>}
      <View className="box-border mt-[37px] h-[142px] flex-row overflow-hidden rounded-[26px] bg-[#f0eeeb] p-4"><View className="h-24 w-20 self-center overflow-hidden rounded-sm bg-[#d9b898]"><img src={Asset.fromModule(demoImage("archive-print")).uri} alt="Linen Bound keepsake folio" style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.55)" }} /><View className="absolute bottom-1 left-0 right-0 items-center"><Text className="rounded bg-black/80 px-1 font-sans-medium text-[8px] text-white">Linen Bound</Text></View></View><View className="flex-1 px-4 py-1"><Text className="font-sans-medium text-[11px] text-honey">▰ ARTISANAL ARCHIVE</Text><Text className="font-serif text-[18px] leading-5 text-ink">Fine-Art Print Edition</Text><Text numberOfLines={2} className="mt-2 font-sans text-xs leading-[17px] text-ink-soft">Hand-crafted Japanese mulberry{`\n`}paper booklet of Mei’s birthday...</Text><Pressable role="button" aria-label="Order keepsake folio" onPress={() => setComingSoon(true)} className="mt-2"><Text className="font-sans-medium text-[11px] text-brand">Order keepsake folio →</Text></Pressable></View></View>
      <Pressable role="button" aria-label="Go back to memory gallery" onPress={() => router.navigate("/" as never)} className="mt-[47px] h-12 flex-row items-center justify-center gap-2 rounded-full bg-[#e9e6e2]"><GalleryIcon /><Text className="font-sans-medium text-[15px] text-ink">Go back to memory gallery</Text></Pressable>
    </ScrollView>
  </View>;
}
