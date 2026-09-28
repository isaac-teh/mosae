import { Text } from "react-native";

/** Mosaé wordmark in Literata SemiBold. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Text
      className={`font-title text-2xl tracking-[-0.6px] text-ink ${className}`}
    >
      Mosaé
    </Text>
  );
}
