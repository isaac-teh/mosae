import { Pressable, ScrollView, Text, View } from "react-native";
import { contextToolbar, type ContextToolbarAction, type EditorSelection } from "@mosae/core";

const icons: Record<ContextToolbarAction, string> = {
  Deselect: "‹", Music: "♫", Add: "+", Ask: "✦", Replace: "⇄", Duplicate: "⧉", Delete: "⌫", Layout: "▦", Motion: "◌",
  Back: "‹", ReplaceCell: "⇄", AddCell: "+", Remove: "⌫", Volume: "◖",
};

export function ToolBar({ selection = "none", onTool, disabledActions = {} }: { selection?: EditorSelection; onTool?: (tool: ContextToolbarAction) => void; disabledActions?: Partial<Record<ContextToolbarAction, string>> }) {
  const disabledHint = [...new Set(Object.values(disabledActions).filter(Boolean))].join(" · ");
  return <View className="border-t border-on-screen-muted/25 bg-screen pb-2 pt-2">
    <View className="flex-row items-center px-2" accessibilityLabel="Editor tools">
      <Pressable role="button" accessibilityLabel="Ask AI" onPress={() => onTool?.("Ask")} className="min-h-[55px] min-w-[64px] items-center justify-center px-1">
        <Text className="font-sans text-[27px] leading-[30px] text-on-screen">{icons.Ask}</Text>
        <Text className="mt-0.5 font-sans text-[11px] text-on-screen">Ask AI</Text>
      </Pressable>
      {selection === "none" ? <View className="flex-1 items-center justify-center px-2"><Text className="font-sans text-[12px] text-on-screen-muted">Tap on a clip to edit it</Text></View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1" contentContainerClassName="flex-grow items-center justify-center">
      {contextToolbar(selection).filter((name) => name !== "Ask").map((name) => <Pressable key={name} role="button" accessibilityLabel={name === "AddCell" ? "Add cell" : name === "ReplaceCell" ? "Replace" : name === "Back" ? "Back" : name} accessibilityHint={disabledActions[name]} disabled={Boolean(disabledActions[name])} onPress={() => onTool?.(name)} className="min-h-[55px] min-w-[64px] items-center justify-center px-1">
        <Text className="font-sans text-[27px] leading-[30px] text-on-screen">{icons[name]}</Text>
        <Text className="mt-0.5 font-sans text-[11px] text-on-screen">{name === "Deselect" ? "Done" : name === "AddCell" ? "Add cell" : name === "ReplaceCell" ? "Replace" : name}</Text>
      </Pressable>)}
    </ScrollView>}
    </View>
    {disabledHint ? <Text accessibilityLiveRegion="polite" className="px-4 pt-1 text-center font-sans text-[10px] text-on-screen-muted">{disabledHint}</Text> : null}
  </View>;
}
