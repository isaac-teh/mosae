import { Text } from "react-native";

/** Mosaé wordmark: Fraunces SemiBold, tight tracking (matches the marketing site). */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Text
      className={`font-display text-2xl tracking-[-0.6px] text-ink ${className}`}
    >
      Mosaé
    </Text>
  );
}
