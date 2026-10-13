import { Image, Pressable, Text, View } from "react-native";

type FilmCardProps = {
  title: string;
  meta: string;
  status: "Ready to watch" | "Shaping…" | "Draft" | string;
  duration?: string;
  posterSource?: { uri: string };
  chapters?: number;
  badge?: string;
  onPress?: () => void;
  onMenu?: () => void;
  selected?: boolean;
  selectionMode?: boolean;
  onSelect?: () => void;
};

export function FilmCard({ title, meta, status, duration, posterSource, chapters = 0, badge, onPress, onMenu, selected = false, selectionMode = false, onSelect }: FilmCardProps) {
  const content = <>
    <View className="relative aspect-video w-full overflow-hidden rounded-md bg-surface-sunken">
      {posterSource ? <Image source={posterSource} accessibilityLabel={`${title} poster`} resizeMode="cover" className="absolute inset-0 h-full w-full" /> : null}
      {duration ? <Text className="absolute right-2 top-2 rounded-sm bg-scrim/60 px-1.5 py-0.5 text-caption font-sans-medium text-on-screen">{duration}</Text> : null}
      {badge ? <Text className="absolute left-2 top-2 rounded-pill bg-surface-raised px-2 py-1 text-caption font-sans-semibold text-ink">{badge}</Text> : null}
      {chapters > 0 ? <View className="absolute bottom-2 left-2 flex-row gap-1">{Array.from({ length: chapters }, (_, index) => <View key={index} className="h-2.5 w-2.5 rounded-sm bg-surface-raised" />)}</View> : null}
    </View>
    <View className="gap-1 p-4">
      <Text className="text-heading font-title text-ink">{title}</Text>
      <Text className="text-caption font-sans text-ink-muted">{meta}</Text>
      <View className={`mt-2 flex-row items-center gap-2 self-start rounded-pill border px-2.5 py-0.5 ${status === "Ready to watch" ? "border-positive" : "border-line-strong"}`}>
        <View className={`h-1.5 w-1.5 rounded-pill ${status === "Ready to watch" ? "bg-positive" : "bg-ink-muted"}`} />
        <Text className={`text-caption font-sans-medium ${status === "Ready to watch" ? "text-positive" : "text-ink-muted"}`}>{status}</Text>
      </View>
    </View>
  </>;
  const className = "min-h-11 w-full max-w-[300px] overflow-hidden rounded-md border border-line bg-surface-raised";
  return <View className="relative">
    {selectionMode ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${selected ? "Deselect" : "Select"} ${title}`} aria-label={`${selected ? "Deselect" : "Select"} ${title}`} role="checkbox" aria-checked={selected} onPress={onSelect} className="absolute left-2 top-2 z-10 size-9 items-center justify-center rounded-pill bg-surface-raised"><Text className="text-heading text-ink">{selected ? "✓" : "○"}</Text></Pressable> : onMenu ? <Pressable accessibilityRole="button" accessibilityLabel={`More options for ${title}`} aria-label={`More options for ${title}`} role="button" onPress={onMenu} className="absolute right-2 top-2 z-10 size-9 items-center justify-center rounded-pill bg-surface-raised"><Text className="text-heading text-ink">⋯</Text></Pressable> : null}
    {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${meta}, ${status}`} aria-label={`${title}, ${meta}, ${status}`} role="button" onPress={selectionMode ? onSelect : onPress} className={className}>{content}</Pressable> : <View className={className}>{content}</View>}
  </View>;
}
