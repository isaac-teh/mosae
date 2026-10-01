import { Pressable, Text, View } from "react-native";

const tools = [
  { name: "Remove", icon: "⌫" },
  { name: "Add", icon: "+" },
  { name: "Ask", icon: "◯" },
] as const;

export function ToolBar({ onTool }: { onTool?: (tool: (typeof tools)[number]["name"]) => void }) {
  return <View className="flex-row border-t border-on-screen-muted/25 bg-screen px-2 pb-3 pt-2">
    {tools.map(({ name, icon }) => <Pressable key={name} role="button" accessibilityLabel={name} onPress={() => onTool?.(name)} className="min-h-[55px] flex-1 items-center justify-center">
      <Text className="font-sans text-[27px] leading-[30px] text-on-screen">{icon}</Text>
      <Text className="mt-0.5 font-sans text-[11px] text-on-screen">{name}</Text>
    </Pressable>)}
  </View>;
}
