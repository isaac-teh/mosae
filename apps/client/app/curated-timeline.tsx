// Figma: "Curated Story Timeline" (1:541)
import { useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStoryFlow } from "@/lib/storyFlow";
import type { Moment } from "@mosae/core";
import { BottomTabBar } from "@/components/BottomTabBar";
import { ContinueArrowIcon, HeartIcon } from "@/components/sceneIcons";
import { storyImage } from "@/lib/storyImage";
import { momentRows } from "@/lib/momentRows";
import { useStoryPlan } from "@/lib/useStoryPlan";

type TileProps = {
  moment: Moment;
  imageKey: string;
  title: string;
  meta: string;
  chip: string;
  emoji: string;
  hero?: boolean;
  video?: boolean;
  onSelected: () => void;
  onFavorite?: () => void;
  heirloom?: boolean;
};

function TimelineTile({ moment, imageKey, title, meta, chip, emoji, hero, video, onSelected, onFavorite, heirloom }: TileProps) {
  const height = hero ? (moment.badge === "Heirloom" ? 206.25 : 247.5) : 193.75;
  return (
    <View className={`${hero ? "w-full p-[10px]" : "flex-1 min-w-0 p-2"} rounded-[24px] bg-white shadow-[0px_1px_1px_rgba(0,0,0,0.05)]`}>
      <View className="relative overflow-hidden rounded-[16px] bg-surface-sunken" style={{ height }}>
        <Image source={storyImage(imageKey)} className="absolute h-full w-full object-cover" style={hero ? (moment.badge === "Heirloom" ? { width: "100%", height: "119.38%", top: "-9.69%" } : { width: "100.52%", left: "-0.26%" }) : { width: "167.54%", left: "-33.77%" }} />
        <View className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.4)] via-1/2 via-[rgba(0,0,0,0)] to-[rgba(0,0,0,0.2)]" />
        <Pressable role="checkbox" aria-label={`Select ${title}`} aria-checked={moment.selected} onPress={onSelected} className={`absolute items-center justify-center rounded-full bg-brand ${hero ? "right-3 top-3 size-8" : "right-[10px] top-[10px] size-7"}`}>
          <Text className="font-sans-semibold text-sm text-white">{moment.selected ? "✓" : ""}</Text>
        </Pressable>
        {video && <View className="absolute inset-0 items-center justify-center"><View className="size-11 items-center justify-center rounded-full bg-[rgba(252,249,244,0.85)]"><Text className="ml-0.5 text-[18px] text-brand">▶</Text></View></View>}
        <View className={`absolute flex-row items-center rounded-full bg-[rgba(255,255,255,0.9)] ${hero ? "bottom-3 left-3 gap-1.5 px-3 py-1" : "bottom-[10px] left-2 gap-1 px-[10px] py-0.5"}`}>
          <Text className={hero ? "text-xs" : "text-[11px]"}>{emoji}</Text><Text className={`${hero ? "text-[11px] leading-[14px]" : "text-[10px] leading-[22px]"} font-sans-semibold text-ink`}>{chip}</Text>
        </View>
      </View>
      <View className={`${hero ? "px-2 pb-1 pt-[10px]" : "px-1.5 pb-0.5 pt-2"} flex-row items-center justify-between`}>
        <View className="flex-1 min-w-0"><Text numberOfLines={1} className={`${hero ? "text-[18px] leading-[26px]" : "text-[15px] leading-[18.75px]"} font-serif text-ink`}>{title}</Text><Text numberOfLines={hero ? 2 : 1} className={`${hero ? "text-xs leading-[18px]" : "text-[11px] leading-[22px]"} font-sans text-ink-soft`}>{meta}</Text></View>
        {heirloom && <Text className="ml-2 font-sans-medium text-xs leading-[18px] text-honey">Heirloom Pick</Text>}
        {onFavorite && <Pressable role="button" aria-label={`Favorite ${title}`} aria-pressed={moment.favorite} onPress={onFavorite} className="ml-2 size-6 items-center justify-center"><HeartIcon /></Pressable>}
      </View>
    </View>
  );
}

function ChapterHeader({ day, subtitle, badge, color, milestone }: { day: string; subtitle: string; badge: string; color: string; milestone?: boolean }) {
  return <View className="flex-row items-start justify-between border-b border-track pb-[9px]"><View className="flex-1"><View className="flex-row items-center gap-2"><View className="size-[10px] rounded-full" style={{ backgroundColor: color }} /><Text className="font-serif text-[18px] leading-[26px] text-ink">{day}</Text></View><Text className="ml-4 font-sans text-xs leading-[18px] text-ink-soft">{subtitle}</Text></View><View className={`mt-1 rounded-full px-2 py-0.5 ${milestone ? "bg-brand" : "bg-surface-sunken"}`}><Text className={`font-sans-semibold text-[11px] leading-[14px] ${milestone ? "text-white" : "text-honey"}`}>{badge}</Text></View></View>;
}

export default function CuratedTimelineScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { repository, route } = useStoryFlow();
  const { plan, error, mutationError, updating, mutate, load } = useStoryPlan(planId, repository);
  const [request, setRequest] = useState("");
  if (error) return <View className="flex-1 items-center justify-center bg-canvas"><Text className="text-brand">{error}</Text><Pressable role="button" aria-label="Retry" onPress={() => void load()} className="mt-4 rounded-full bg-brand px-5 py-3"><Text className="font-sans-semibold text-white">Retry</Text></Pressable></View>;
  if (!plan) return <View className="flex-1 bg-canvas" />;
  const selectedCount = (plan.totalMomentCount ?? plan.moments.length) - plan.moments.filter((moment) => !moment.selected).length;
  const updateMoment = (moment: Moment) => { void mutate((id) => repository.setMomentSelected(id, moment.id, !moment.selected)); };
  const updateFavorite = (moment: Moment) => { void mutate((id) => repository.setMomentFavorite(id, moment.id, !moment.favorite)); };
  const submit = async () => {
    if (!request.trim()) return;
    if (await mutate((id) => repository.reviseMoments(id, request.trim()))) setRequest("");
  };
  const momentsById = new Map(plan.moments.map((moment) => [moment.id, moment]));
  return <View className="flex-1 bg-canvas"><ScrollView className="flex-1" keyboardShouldPersistTaps="handled"><View className="min-h-[2631px] px-5 pb-28 pt-16">
    <View className="pb-6"><View className="flex-row items-center justify-between"><View className="flex-row items-center gap-1.5 rounded-full bg-surface-pill px-3 py-1"><View className="size-1.5 rounded-full bg-brand" /><Text className="font-sans-semibold text-[11px] leading-[14px] tracking-[0.55px] text-ink-soft">STEP 3 OF 6 • CURATED TIMELINE</Text></View><Text className="font-sans-semibold text-[11px] leading-[14px] text-honey">{selectedCount} Moments Selected</Text></View><Text className="mt-2 font-serif text-[26px] leading-[32.5px] tracking-[-0.65px] text-ink">{plan.timelineIntro.headline}</Text><Text className="mt-[3.25px] font-sans text-sm leading-[22.75px] text-ink-soft">{plan.timelineIntro.body}</Text><View className="mt-4 flex-row items-center gap-1 rounded-[16px] bg-honey-tint p-3 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"><Text className="text-[17px] text-honey">✦</Text><Text className="flex-1 font-sans-semibold text-xs leading-[16.5px] text-honey">Archival Sequence: <Text className="text-honey-deep">{plan.timelineIntro.sequence}</Text></Text></View></View>
    {plan.chapters.map((chapter, chapterIndex) => {
      const moments = chapter.momentIds.flatMap((id) => {
        const moment = momentsById.get(id);
        return moment ? [{ ...moment, ...chapter.momentPresentation?.[id] }] : [];
      });
      // A single chapter moment is a hero; a pair shares a row. Longer chapters
      // continue with the same rhythm as the moments review.
      const rows = moments.length === 2 ? [{ size: "half" as const, moments }] : momentRows(moments);
      return <View key={chapter.id} className={chapterIndex ? "mt-6 pt-2" : ""}>
        <ChapterHeader day={chapter.dayLabel} subtitle={[chapter.title, chapter.subtitle].filter(Boolean).join(" • ")} badge={chapter.badge.label} color={chapter.dotColor} milestone={chapter.badge.tone === "milestone"} />
        {rows.map((row) => <View key={row.moments[0].id} className={`mt-3 ${row.size === "half" ? "flex-row gap-2" : ""}`}>
          {row.moments.map((moment) => <TimelineTile key={moment.id} moment={moment} imageKey={moment.imageKey} title={moment.title} meta={moment.meta} chip={moment.tag.label} emoji={moment.tag.emoji} hero={row.size === "hero"} video={moment.kind === "video"} heirloom={moment.badge === "Heirloom"} onSelected={() => updateMoment(moment)} onFavorite={row.size === "hero" && !moment.badge ? () => updateFavorite(moment) : undefined} />)}
        </View>)}
      </View>;
    })}
    {mutationError && <Text role="alert" className="mt-3 text-sm text-brand">{mutationError}</Text>}
    <Pressable role="button" aria-label={`Add photos from ${plan.albumName} album`} onPress={() => router.navigate("/pick-memory")} className="mt-6 flex-row items-center justify-center gap-2 rounded-[16px] border border-dashed border-brand-dot bg-surface-muted px-[17px] py-[15px]"><Text className="text-lg text-brand">+</Text><Text className="font-sans-medium text-xs leading-4 text-ink">+ Add photos from {plan.albumName} album ({plan.timelineOtherPhotoCount ?? plan.otherPhotoCount} more)</Text></Pressable>
    <View className="mt-6 h-[336px] rounded-[24px] border border-[rgba(224,191,183,0.4)] bg-white p-4 shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)]"><View className="flex-row items-start justify-between"><View className="flex-row gap-2"><Text className="text-lg text-brand">✦</Text><Text className="font-serif text-[16px] leading-[22px] text-ink">Want to change the moments{`\n`}we picked?</Text></View><View className="flex-row items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5"><View className="size-1.5 rounded-full bg-brand" /><Text className="font-sans-semibold text-[10px] leading-[22px] tracking-[0.5px] text-brand-deep">AI DIRECTOR</Text></View></View><Text className="mt-3 font-sans text-xs leading-[18px] text-ink-soft">Tell our archival curator what to emphasize or swap out{`\n`}for your film.</Text><View className="relative mt-3 h-11 justify-center rounded-full border border-[rgba(224,191,183,0.6)] bg-surface-sunken pl-[13px] pr-24"><TextInput value={request} onChangeText={setRequest} placeholder="e.g., Add more photos of Mei, or show more food we tried..." placeholderTextColor="rgba(89,65,59,0.6)" className="font-sans text-xs text-ink" /><Pressable role="button" aria-label="Update moments" disabled={!request.trim() || updating} onPress={() => void submit()} className="absolute right-1.5 top-[7px] rounded-full bg-brand px-[14px] py-1.5"><Text className="font-sans-medium text-[11px] leading-[14px] text-white">{updating ? "Updating..." : "Update"}</Text></Pressable></View><View className="mt-4 gap-1.5">{plan.suggestions.map((suggestion) => <Pressable key={suggestion} role="button" aria-label={suggestion} onPress={() => setRequest(suggestion)} className="self-start rounded-full bg-surface-sunken px-2.5 py-1"><Text className="font-sans text-[11px] leading-[22px] text-ink-soft">{suggestion}</Text></Pressable>)}</View></View>
    <View className="mt-4 py-2"><View className="flex-row justify-between px-1"><Text className="font-sans-medium text-xs leading-4 text-ink-soft">{selectedCount} moments selected</Text><Text className="font-sans-semibold text-xs leading-4 text-honey">{plan.estimatedFilmLabel}</Text></View><Pressable role="button" aria-label="Continue" disabled={updating} onPress={() => router.navigate(route("/create", { planId: plan.planId }) as any)} className="mt-2 flex-row items-center justify-center gap-2 rounded-full bg-brand px-4 py-3.5 shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)]"><Text className="font-sans-semibold text-sm leading-5 text-white">Continue</Text><ContinueArrowIcon /></Pressable><Text className="mt-2 text-center font-sans text-[11px] leading-[22px] text-[rgba(89,65,59,0.7)]">Step 4: Director mode enables audio overlay, pacing & chapter titles</Text></View>
  </View></ScrollView><BottomTabBar active="gallery" /></View>;
}
