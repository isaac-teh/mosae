import "../global.css";
import "@/lib/core";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import { View } from "react-native";
import { useFonts } from "expo-font";
import { PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans";
import { Newsreader_400Regular, Newsreader_400Regular_Italic } from "@expo-google-fonts/newsreader";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { Literata_600SemiBold } from "@expo-google-fonts/literata";
import { Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold } from "@expo-google-fonts/figtree";

export default function RootLayout() {
  const [loaded] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, Newsreader_400Regular, Newsreader_400Regular_Italic, Fraunces_600SemiBold, Literata_600SemiBold, Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold });
  return <View className="flex-1 bg-canvas"><Head><title>Mosaé</title><meta name="theme-color" content="#fcf9f4" /><link rel="icon" href="/favicon.svg" type="image/svg+xml" /></Head>{loaded && <View className="w-full max-w-[430px] flex-1 self-center bg-canvas"><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#fcf9f4" }, animation: "none" }} /></View>}</View>;
}
