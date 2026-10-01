import { Pressable, ScrollView, Text, View } from "react-native";
import { contextToolbar, type ContextToolbarAction, type EditorSelection } from "@mosae/core";

const icons: Record<ContextToolbarAction, string> = {
  Deselect: "‹", Music: "♫", Add: "+", Ask: "✦", Replace: "⇄", Duplicate: "⧉", Delete: "⌫", Layout: "▦", Motion: "◌",
};

export function ToolBar({ selection = "none", onTool }: { selection?: EditorSelection; onTool?: (tool: ContextToolbarAction) => void }) {
  return <View className="border-t border-on-screen-muted/25 bg-screen pb-3 pt-2">
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-2" accessibilityLabel="Editor tools">
      {contextToolbar(selection).map((name) => <Pressable key={name} role="button" accessibilityLabel={name} onPress={() => onTool?.(name)} className="min-h-[55px] min-w-[64px] items-center justify-center px-1">
        <Text className="font-sans text-[27px] leading-[30px] text-on-screen">{icons[name]}</Text>
        <Text className="mt-0.5 font-sans text-[11px] text-on-screen">{name === "Deselect" ? "Done" : name}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;
}
