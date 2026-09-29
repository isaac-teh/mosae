import "../global.css";
import "@/lib/core";
import { Stack, usePathname } from "expo-router";
import Head from "expo-router/head";
import { View } from "react-native";
import { useFonts } from "expo-font";
import { Literata_600SemiBold } from "@expo-google-fonts/literata";
import { Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold } from "@expo-google-fonts/figtree";

export default function RootLayout() {
  const [loaded] = useFonts({ Literata_600SemiBold, Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold });
  const editor = usePathname() === "/editor";
  return <View className={`flex-1 ${editor ? "bg-screen" : "bg-surface"}`}><Head><title>Mosaé</title><meta name="theme-color" content={editor ? "rgb(11, 14, 18)" : "rgb(250, 250, 247)"} /><link rel="icon" href="/favicon.svg" type="image/svg+xml" /></Head>{loaded && <View className={`w-full flex-1 self-center ${editor ? "max-w-[520px] bg-screen" : "max-w-[430px] bg-surface"}`}><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" }, animation: "none" }} /></View>}</View>;
}
