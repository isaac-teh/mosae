import { Pressable, ScrollView, Text, View } from "react-native";
import { contextToolbar, type ContextToolbarAction, type EditorSelection } from "@mosae/core";

const icons: Record<ContextToolbarAction, string> = {
  Deselect: "‹", Music: "♫", Add: "+", Ask: "✦", Replace: "⇄", Duplicate: "⧉", Delete: "⌫", Layout: "▦", Motion: "◌",
  Back: "‹", ReplaceCell: "⇄", RemoveCell: "⌫", AddCell: "+",
};

export function ToolBar({ selection = "none", onTool, disabledActions = {} }: { selection?: EditorSelection; onTool?: (tool: ContextToolbarAction) => void; disabledActions?: Partial<Record<ContextToolbarAction, string>> }) {
  const disabledHint = [...new Set(Object.values(disabledActions).filter(Boolean))].join(" · ");
  return <View className="border-t border-on-screen-muted/25 bg-screen pb-2 pt-2">
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-2" accessibilityLabel="Editor tools">
      {contextToolbar(selection).map((name) => <Pressable key={name} role="button" accessibilityLabel={name === "AddCell" ? "Add cell" : name === "ReplaceCell" ? "Replace" : name === "RemoveCell" ? "Remove cell" : name === "Back" ? "Back" : name} accessibilityHint={disabledActions[name]} disabled={Boolean(disabledActions[name])} onPress={() => onTool?.(name)} className="min-h-[55px] min-w-[64px] items-center justify-center px-1">
        <Text className="font-sans text-[27px] leading-[30px] text-on-screen">{icons[name]}</Text>
        <Text className="mt-0.5 font-sans text-[11px] text-on-screen">{name === "Deselect" ? "Done" : name === "AddCell" ? "Add cell" : name === "ReplaceCell" ? "Replace" : name === "RemoveCell" ? "Remove cell" : name}</Text>
      </Pressable>)}
    </ScrollView>
    {disabledHint ? <Text accessibilityLiveRegion="polite" className="px-4 pt-1 text-center font-sans text-[10px] text-on-screen-muted">{disabledHint}</Text> : null}
  </View>;
}
