import { Image, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function PhotoViewerScreen() {
  const router = useRouter();
  const { uri } = useLocalSearchParams<{ uri: string }>();
  return <View className="flex-1 items-center justify-center bg-ink">
    <Pressable role="button" accessibilityLabel="Close photo" onPress={() => router.back()} className="absolute left-4 top-12 z-10 h-11 w-11 items-center justify-center rounded-full bg-black/60"><Text className="text-2xl text-on-screen">×</Text></Pressable>
    <Image source={{ uri }} resizeMode="contain" className="h-full w-full" accessibilityLabel="Set-aside photo" />
  </View>;
}
