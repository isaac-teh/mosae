import { Text, View } from "react-native";
import { Button, MomentTile } from "../ds";

type Tile = { shotId: string; uri: string };
type State = "keep" | "leave" | undefined;
type ChatMomentGridProps = { tiles: Tile[]; state: Record<string, State>; onTap: (shotId: string) => void; total: number; onChooseAll: () => void; onDone: () => void };

export function ChatMomentGrid({ tiles, state, onTap, total, onChooseAll, onDone }: ChatMomentGridProps) {
  const kept = Object.values(state).filter((value) => value === "keep").length;
  const left = Object.values(state).filter((value) => value === "leave").length;
  return <View className="w-full flex-col gap-3">
    <Text className="text-body font-sans text-ink">Any moments that must be in the film, or ones to leave out? Tap once to keep, twice to leave out.</Text>
    <View className="flex-row flex-wrap gap-1">{tiles.slice(0, 6).map(({ shotId, uri }) => {
      const current = state[shotId];
      return <View key={shotId} className="w-[32%]">
        <MomentTile label={`Moment ${shotId}${current === "keep" ? ", Keep" : current === "leave" ? ", Leave out" : ""}`} source={{ uri }} state={current === "keep" ? "selected" : current === "leave" ? "excluded" : "default"} badge={current === "keep" ? "✓ Keep" : current === "leave" ? "× Leave out" : undefined} onPress={() => onTap(shotId)} showCaption={false} className="max-w-none" />
      </View>;
    })}</View>
    <View className="flex-row items-center justify-between gap-2"><Text className="text-caption font-sans text-ink-muted">{kept} kept · {left} left out</Text><Button label="Done" size="sm" onPress={onDone} /></View>
    <Button label={`Choose from all ${total}`} size="sm" variant="quiet" onPress={onChooseAll} />
  </View>;
}
