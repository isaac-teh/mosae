import { Pressable, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import type { EditOp, Timeline } from "@mosae/contracts";

function TikTokGlyph() {
  return <Svg width={25} height={25} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
    <Path d="M14 3v11.1a4.1 4.1 0 1 1-3.2-4V13a1.5 1.5 0 1 0 1.2 1.47V3H14Zm0 0c.3 2.3 1.8 3.8 4 4.2v3.1A8.2 8.2 0 0 1 14 8.7V3Z" fill="white" />
  </Svg>;
}

function YouTubeGlyph() {
  return <Svg width={28} height={22} viewBox="0 0 28 22" fill="none" accessibilityElementsHidden>
    <Rect x={1} y={2} width={26} height={18} rx={5} fill="white" />
    <Path d="m12 7 7 4-7 4V7Z" fill="#2a2f36" />
  </Svg>;
}

export function RatioSheet({ visible, aspect, onApply, onClose }: { visible: boolean; aspect: Timeline["aspect"]; onApply: (op: EditOp) => void; onClose: () => void }) {
  if (!visible) return null;
  const choose = (next: Timeline["aspect"]) => { if (next !== aspect) onApply({ op: "setAspect", aspect: next }); };
  return <View className="absolute inset-0 z-20 justify-end bg-black/55">
    <View className="rounded-t-[24px] bg-[#111d26] px-5 pb-8 pt-4">
      <View className="mb-5 h-1 w-10 self-center rounded-full bg-[#60717c]" />
      <View className="mb-6 flex-row items-end justify-center gap-8">
        {([ ["9:16", "9:16 TikTok / Reels", TikTokGlyph], ["16:9", "16:9 YouTube", YouTubeGlyph] ] as const).map(([value, label, Glyph]) => {
          const selected = aspect === value;
          return <Pressable key={value} role="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => choose(value)} className="items-center">
            <View className={`items-center justify-center rounded-[10px] bg-[#2a2f36] ${value === "9:16" ? "h-[92px] w-[52px]" : "h-[52px] w-[92px]"} ${selected ? "border-2 border-white" : "border-2 border-transparent"}`}><Glyph /></View>
            <Text className="mt-2 font-sans-medium text-[13px] text-on-screen">{value}</Text>
          </Pressable>;
        })}
      </View>
      <View className="relative h-12 items-center justify-center border-t border-on-screen-muted/20">
        <Text className="font-sans-semibold text-[18px] text-on-screen">Ratio</Text>
        <Pressable role="button" accessibilityLabel="Done" onPress={onClose} className="absolute right-0 h-11 w-11 items-center justify-center"><Text className="text-[24px] text-on-screen">✓</Text></Pressable>
      </View>
    </View>
  </View>;
}
