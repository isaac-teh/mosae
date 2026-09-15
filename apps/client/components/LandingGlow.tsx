import { View } from "react-native";

export function LandingGlow() {
  return (
    <>
      <View className="absolute -right-24 -top-24 size-72 rounded-full bg-brand-tint/60" pointerEvents="none" />
      <View className="absolute -left-28 top-72 size-64 rounded-full bg-honey-tint" pointerEvents="none" />
    </>
  );
}
