import { Pressable, Text, View } from "react-native";

type State = "saved" | "saving" | "retrying" | "conflict" | "rendering" | "ready";

export function SaveState({ save, onReload, renderProgress, renderEtaMinutes }: { save: { state: State }; onReload: () => void; renderProgress?: number | null; renderEtaMinutes?: number | null }) {
  if (save.state === "conflict") return <View className="flex-row items-center justify-between rounded-md bg-critical/20 px-3 py-2">
    <Text className="font-sans text-caption text-on-screen">This film changed on another device</Text>
    <Pressable role="button" accessibilityLabel="Reload" onPress={onReload} className="ml-2 rounded-md border border-on-screen-muted px-2 py-1"><Text className="font-sans-semibold text-caption text-on-screen">Reload</Text></Pressable>
  </View>;
  const label = {
    saved: "Saved", saving: "Saving…", retrying: "Not saved yet — retrying", rendering: "Rendering…", ready: "Ready",
  }[save.state];
  const progressLabel = save.state === "rendering" && renderProgress !== null && renderProgress !== undefined
    ? `${label} ${Math.round(renderProgress * 100)}%${renderEtaMinutes ? ` · about ${renderEtaMinutes} min left` : ""}`
    : label;
  return <Text accessibilityLiveRegion="polite" className="font-sans text-caption text-on-screen-muted">{progressLabel}</Text>;
}
