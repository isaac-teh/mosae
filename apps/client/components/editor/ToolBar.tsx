import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { contextToolbar, type ContextToolbarAction, type EditorSelection } from "@mosae/core";

export function RatioIcon({ size = 24 }: { size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
    <Path d="M9 3H4v5M15 3h5v5M20 16v5h-5M9 21H4v-5" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

function VolumeIcon() {
  return <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
    <Path d="M3 9v6h4l5 4V5L7 9H3Z" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M16 9a5 5 0 0 1 0 6" stroke="white" strokeWidth={1.8} strokeLinecap="round" />
    <Path d="M18.5 6.5a9 9 0 0 1 0 11" stroke="white" strokeWidth={1.8} strokeLinecap="round" />
  </Svg>;
}

const icons: Record<Exclude<ContextToolbarAction, "Volume">, string> = {
  Deselect: "‹", Music: "♫", Add: "+", Ask: "✦", Replace: "⇄", Duplicate: "⧉", Delete: "⌫", Layout: "▦", Motion: "◌",
  Format: "▣", Back: "‹", ReplaceCell: "⇄", AddCell: "+", Remove: "⌫",
};

export function ToolBar({ selection = "none", onTool, disabledActions = {}, emptyCollageCell = false, hasEmptyCollageSlot = false }: { selection?: EditorSelection; onTool?: (tool: ContextToolbarAction) => void; disabledActions?: Partial<Record<ContextToolbarAction, string>>; emptyCollageCell?: boolean; hasEmptyCollageSlot?: boolean }) {
  const disabledHint = [...new Set(Object.values(disabledActions).filter(Boolean))].join(" · ");
  return <View className="border-t border-on-screen-muted/25 bg-screen pb-2 pt-2">
    <View className="flex-row items-center px-2" accessibilityLabel="Editor tools">
      {selection === "none" ? <View className="min-h-[55px] flex-1 items-center justify-center px-2"><Text className="font-sans text-[12px] text-on-screen-muted">Tap on a clip to edit it</Text></View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1" contentContainerClassName="flex-grow items-center justify-center">
      {contextToolbar(selection, { hasEmptyCollageSlot }).filter((name) => name !== "Ask").map((name) => <Pressable key={name} role="button" accessibilityLabel={(name === "ReplaceCell" && emptyCollageCell) || (name === "AddCell" && hasEmptyCollageSlot) ? "Add photo" : name === "ReplaceCell" ? "Replace" : name} accessibilityHint={disabledActions[name]} disabled={Boolean(disabledActions[name])} onPress={() => onTool?.(name)} className="min-h-[55px] min-w-[64px] items-center justify-center px-1">
        {name === "Volume" ? <View className="h-[30px] items-center justify-center"><VolumeIcon /></View> : <Text className="font-sans text-[27px] leading-[30px] text-on-screen">{(emptyCollageCell && name === "ReplaceCell") || (hasEmptyCollageSlot && name === "AddCell") ? "+" : icons[name]}</Text>}
        <Text className="mt-0.5 font-sans text-[11px] text-on-screen">{name === "Deselect" ? "Done" : (emptyCollageCell && name === "ReplaceCell") || (hasEmptyCollageSlot && name === "AddCell") ? "Add photo" : name === "AddCell" ? "Add cell" : name === "ReplaceCell" ? "Replace" : name}</Text>
      </Pressable>)}
    </ScrollView>}
    </View>
    {disabledHint ? <Text accessibilityLiveRegion="polite" className="px-4 pt-1 text-center font-sans text-[10px] text-on-screen-muted">{disabledHint}</Text> : null}
  </View>;
}
