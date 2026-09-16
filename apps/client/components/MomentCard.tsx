import { Pressable, Text, View, Image } from "react-native";
import type { ReactNode } from "react";
import type { Moment } from "@mosae/core";
import { demoImage } from "@/lib/demoAssets";
import { CheckIcon } from "./icons";
import { HeartIcon } from "./sceneIcons";

type MomentCardProps = {
  moment: Moment;
  size: "hero" | "half";
  onToggleSelected: () => void;
  onToggleFavorite?: () => void;
  trailing?: ReactNode;
};

// Figma: review-moments.tsx cards (nodes 1:401-1:422, 1:425-1:460, 1:471-1:492)
export function MomentCard({
  moment,
  size,
  onToggleSelected,
  trailing,
}: MomentCardProps) {
  const isHero = size === "hero";
  const height = isHero ? 247.5 : 193.75;
  const padding = isHero ? 10 : 8;
  const titleSize = isHero ? "text-[18px]" : "text-[15px]";
  const metaSize = isHero ? "text-[12px]" : "text-[11px]";
  const tagFontSize = isHero ? "text-[11px]" : "text-[10px]";
  const tagPaddingX = isHero ? 12 : 10;
  const tagPaddingY = isHero ? 4 : 2;
  const badgeSize = isHero ? "size-[32px]" : "size-[28px]";
  const bottomOffset = isHero ? 12 : 10;
  const leftOffset = isHero ? 12 : 8;
  const ringSize = isHero ? "size-[32px]" : "size-[28px]";
  const titlePt = isHero ? 10 : 8;
  const titlePb = isHero ? 4 : 2;
  const titlePx = isHero ? 8 : 6;
  const selected = moment.selected;

  return (
    <View
      className={`${isHero ? "w-full" : "flex-1 min-w-0"} bg-white rounded-[24px] shadow-[0px_1px_1px_rgba(0,0,0,0.05)]`}
      style={{ padding }}
    >
      <View className="relative rounded-[16px] bg-[#f0ede9] overflow-hidden">
        <View style={{ height }} className="w-full">
          <View className="absolute inset-0 overflow-hidden pointer-events-none">
            <Image
              source={demoImage(moment.imageKey)}
              accessibilityLabel={moment.title}
              className="absolute h-full w-full object-cover"
              style={{
                ...(moment.kind === "video"
                  ? { width: "167.54%", left: "-33.77%" }
                  : isHero
                    ? { width: "100.52%", left: "-0.26%" }
                    : { width: "167.54%", left: "-33.77%" }),
                ...(selected ? {} : { opacity: 0.5 }),
              }}
            />
          </View>
          <View className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.4)] via-1/2 via-[rgba(0,0,0,0)] to-[rgba(0,0,0,0.2)]" />

          {/* Selection badge */}
          <Pressable
            role="checkbox"
            aria-checked={selected as boolean}
            aria-label={`Select ${moment.title}`}
            onPress={onToggleSelected}
            className={`absolute ${badgeSize} rounded-full bg-brand items-center justify-center ${
              isHero ? "top-[12px] right-[12px]" : "top-[10px] right-[10px]"
            }`}
          >
            {selected ? (
              <CheckIcon />
            ) : (
              <View className={`${ringSize} rounded-full border-2 border-white/90 bg-black/10`} />
            )}
          </Pressable>

          {/* Tag chip */}
          <View
            className="absolute backdrop-blur-[6px] bg-[rgba(255,255,255,0.9)] flex-row items-center rounded-full shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
            style={{
              bottom: bottomOffset,
              left: leftOffset,
              paddingHorizontal: tagPaddingX,
              paddingVertical: tagPaddingY,
            }}
          >
            <Text className="font-serif text-[12px]">{moment.tag.emoji}</Text>
            <Text className={`font-sans-semibold ${tagFontSize} text-[#1c1c19] whitespace-nowrap`}>
              {moment.tag.label}
            </Text>
          </View>

          {/* Video play overlay for video moments */}
          {moment.kind === "video" && (
            <View className="absolute inset-0 items-center justify-center">
              <View className="backdrop-blur-[6px] bg-[rgba(252,249,244,0.85)] rounded-full items-center justify-center" style={{ width: 44, height: 44 }}>
                <Text className="text-white text-lg">▶</Text>
              </View>
            </View>
          )}
        </View>

        {/* Card footer: title + meta + trailing */}
        <View className="flex-row items-center justify-between" style={{ paddingTop: titlePt, paddingBottom: titlePb, paddingHorizontal: titlePx }}>
          <View className="flex-1 min-w-0">
            <Text numberOfLines={isHero ? 1 : 1} className={`${titleSize} font-serif text-[#1c1c19]`}>
              {moment.title}
            </Text>
            <Text numberOfLines={2} className={`font-sans ${metaSize} text-[#59413b]`}>
              {moment.meta}
            </Text>
          </View>
          {/* Hero cards get a trailing heart icon on the right side of title row */}
          {isHero && <HeartIcon />}
          {trailing}
        </View>
      </View>

      {/* Heirloom badge for hero moments with a badge label (e.g. "Heirloom") */}
      {moment.badge && isHero && (
        <View
          className="absolute bg-[rgba(255,221,184,0.5)] flex-row items-center rounded-full"
          style={{ bottom: bottomOffset, right: leftOffset + 40, paddingHorizontal: 8, paddingVertical: 2 }}
        >
          <Text className="font-sans-semibold text-[11px] text-[#855300] whitespace-nowrap">
            {moment.badge}
          </Text>
        </View>
      )}
    </View>
  );
}
