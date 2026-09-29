import { useRef } from "react";
import { Text, View, type GestureResponderEvent } from "react-native";
import { Button, MomentTile } from "../ds";

type Tile = { shotId: string; uri: string };
type Day = { label: string; tiles: Tile[] };
type MomentPickerSheetProps = { days: Day[]; selected: string[]; onToggle: (shotId: string) => void; onCancel: () => void; onConfirm: () => void };

export function MomentPickerSheet({ days, selected, onToggle, onCancel, onConfirm }: MomentPickerSheetProps) {
  const count = selected.length;
  const touchStartY = useRef<number | null>(null);
  const onHeaderTouchStart = (event: GestureResponderEvent) => { touchStartY.current = event.nativeEvent.pageY; };
  const onHeaderTouchEnd = (event: GestureResponderEvent) => {
    const startY = touchStartY.current;
    touchStartY.current = null;
    if (startY !== null && event.nativeEvent.pageY - startY > 72) onCancel();
  };

  return <View role={"dialog" as never} aria-modal={true} accessibilityLabel="Must-include moments" className="absolute inset-0 z-50 flex-col bg-scrim/60">
    <View className="mt-3 min-h-0 flex-1 flex-col overflow-hidden rounded-t-lg bg-surface">
      <View accessibilityLabel="Moment picker header" onTouchStart={onHeaderTouchStart} onTouchEnd={onHeaderTouchEnd} className="shrink-0 flex-row items-center justify-between border-b border-line px-4 py-3"><View className="flex-col gap-1"><Text className="text-heading font-sans-semibold text-ink">Must-include moments</Text><Text className="text-label font-sans text-ink-muted">{count} selected</Text></View><Button label="Cancel" variant="quiet" size="sm" onPress={onCancel} /></View>
      <View className="min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{days.map((day) => <View key={day.label} className="flex-col gap-2"><Text className="text-label font-sans-semibold text-ink">{day.label}</Text><View className="flex-row flex-wrap gap-1">{day.tiles.map((tile) => {
        const isSelected = selected.includes(tile.shotId);
        return <View key={tile.shotId} className="w-[32%]"><MomentTile label={`Moment ${tile.shotId}`} source={{ uri: tile.uri }} selected={isSelected} role="checkbox" onPress={() => onToggle(tile.shotId)} showCaption={false} className="max-w-none" /></View>;
      })}</View></View>)}</View>
      <View className="shrink-0 flex-row justify-end border-t border-line px-4 pb-4 pt-3"><Button label={`Add ${count} moments`} onPress={onConfirm} /></View>
    </View>
  </View>;
}
