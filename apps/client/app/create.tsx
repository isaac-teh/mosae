// Figma: "What would you like to create?" (8:864)
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getStoryRepository, type CreateOption, type StoryPlan } from "@mosae/core";
import { demoImage } from "@/lib/demoAssets";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "@/components/icons";

type Option = {
  id: CreateOption;
  title: string;
  shortName: string;
  icon: string;
  description: string;
  meta?: string;
};

const options: Option[] = [
  { id: "film", title: "Direct my film", shortName: "Direct my film", icon: "▣", description: "Let AI weave emotional pacing, ambient\naudio & cinematic cuts into an intimate\nheirloom film.", meta: "♫ Piano & Ambient   ◷ ~3 min" },
  { id: "album", title: "Print out as an album", shortName: "Print album", icon: "▰", description: "Design a tactile, linen-bound archival\nphotobook crafted on heavy museum-\ngrade art paper.", meta: "Hardcover Linen • 8×10″" },
  { id: "share", title: "Share with loved ones", shortName: "Share", icon: "⌯", description: "Invite grandparents and close family to an\nad-free, secure interactive web journal." },
  { id: "apple-photos", title: "Sync to Apple Photos", shortName: "Sync to Photos", icon: "▣", description: "Export these 32 curated treasures cleanly\ninto a standalone album in your native\ncamera roll." },
];

function CreateOptionCard({ option, selected, onPress }: { option: Option; selected: boolean; onPress: () => void }) {
  return <Pressable role="radio" aria-checked={selected} aria-label={option.title} onPress={onPress}
    className={`rounded-[16px] bg-white p-4 ${selected ? "border-2 border-brand shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)]" : "shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"}`}>
    <View className="flex-row gap-[14px]">
      <View className={`size-12 items-center justify-center rounded-full ${selected ? "bg-brand-tint" : "bg-surface-pill"}`}><Text className="text-[22px] text-brand">{option.icon}</Text></View>
      <View className="min-w-0 flex-1 gap-1.5 pr-1">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2"><Text className="font-sans-semibold text-sm leading-5 text-ink">{option.title}</Text>{option.id === "film" && <Text className="rounded-full bg-[#ffb4a2] px-2 py-0.5 font-sans-semibold text-[11px] leading-[14px] text-brand-deep">AI Directed</Text>}</View>
          <View className={`size-5 items-center justify-center rounded-full ${selected ? "bg-brand" : "bg-surface-pill"}`}>{selected && <CheckIcon />}</View>
        </View>
        <Text className="font-sans text-xs leading-[18px] text-ink-soft">{option.description}</Text>
        {option.meta && <Text className={`pt-0.5 font-sans-semibold text-[11px] leading-[14px] ${option.id === "film" ? "text-brand" : "text-ink-soft"}`}>{option.meta}</Text>}
      </View>
    </View>
  </Pressable>;
}

export default function CreateScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CreateOption>("film");
  const [comingSoon, setComingSoon] = useState(false);

  const load = () => getStoryRepository().getPlan(planId).then(setPlan).catch((cause: Error) => setError(cause.message));
  useEffect(() => { void getStoryRepository().getPlan(planId).then(setPlan).catch((cause: Error) => setError(cause.message)); }, [planId]);
  if (!plan && !error) return <View className="flex-1 bg-canvas" />;
  if (error) return <View className="flex-1 items-center justify-center bg-canvas"><Text className="text-brand">{error}</Text><Pressable role="button" aria-label="Retry" onPress={() => { setError(null); void load(); }} className="mt-4 rounded-full bg-brand px-5 py-3"><Text className="font-sans-semibold text-white">Retry</Text></Pressable></View>;
  if (!plan) return null;
  const current = options.find((option) => option.id === selected)!;
  const continueWithOption = async () => {
    const result = await getStoryRepository().chooseCreateOption(plan.planId, selected);
    if (result.available) router.navigate(`/direct-film?planId=${plan.planId}` as never);
    else setComingSoon(true);
  };
  return <View className="flex-1 bg-canvas"><ScrollView className="flex-1" contentContainerClassName="min-h-[1000px] px-5 pb-8" keyboardShouldPersistTaps="handled">
    <View className="flex-row items-center justify-between py-2">
      <Pressable role="button" aria-label="Go back to curated timeline" onPress={() => router.back()} className="size-10 items-center justify-center rounded-full bg-surface-muted shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><ArrowLeftIcon /></Pressable>
      <View className="flex-row items-center gap-1.5 rounded-full bg-[#ffddb8] px-3 py-1"><View className="size-1.5 rounded-full bg-honey" /><Text className="font-sans-semibold text-[11px] leading-[14px] tracking-[1.1px] text-honey-deep">STEP 4 • NEXT STEP</Text></View>
      <Pressable role="button" aria-label="Help" className="size-10 items-center justify-center"><Text className="text-[21px] text-ink-soft">?</Text></Pressable>
    </View>
    <View className="pt-4"><Text className="font-sans-semibold text-xs leading-4 tracking-[0.6px] text-brand">32 MOMENTS CURATED</Text><Text className="mt-[5px] font-serif text-[26px] leading-[32.5px] text-ink">What would you like to create?</Text><Text className="mt-[7.5px] font-sans text-sm leading-[22.75px] text-ink-soft">Your 32 moments from Tokyo &amp; Kyoto are ready.{`\n`}Choose how you wish to bring this chapter to life.</Text></View>
    <View className="mt-5 flex-row items-center gap-[14px] rounded-[16px] bg-white p-[14px] shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><View className="size-14 overflow-hidden rounded-full"><Image source={demoImage(plan.coverImageKey)} className="absolute left-[-41.76%] top-0 h-full w-[183.51%]" resizeMode="stretch" /><View className="absolute inset-x-0 bottom-0 items-center bg-black/60"><Text className="font-sans-semibold text-[9px] leading-[20px] tracking-[-0.45px] text-white">32 PICS</Text></View></View><View className="flex-1 gap-0.5"><Text className="font-serif text-[18px] leading-[26px] text-ink">🎂 Mai’s 7th Birthday in Japan</Text><Text className="font-sans text-xs leading-[18px] text-ink-soft">Tokyo & Kyoto • Oct 14–18, 2024</Text></View></View>
    <View role="radiogroup" className="mt-6 gap-[14px]">{options.map((option) => <CreateOptionCard key={option.id} option={option} selected={selected === option.id} onPress={() => { setSelected(option.id); setComingSoon(false); }} />)}</View>
    <View className="mt-5 flex-row items-center justify-center gap-1.5 px-4"><Text className="text-sm text-ink-soft">♙</Text><Text className="text-center font-sans text-xs leading-[18px] text-ink-soft">Every curated memory is archived in your Vault to re-{`\n`}create anytime.</Text></View>
    <Pressable role="button" aria-label={`Continue with ${current.shortName}`} onPress={() => void continueWithOption()} className="mt-8 h-[52px] flex-row items-center justify-center gap-2 rounded-full bg-brand px-6 shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)]"><Text className="font-sans-semibold text-sm leading-5 text-white">Continue with {current.shortName}</Text><ArrowRightIcon /></Pressable>
    {comingSoon && <Text className="mt-2 text-center font-sans text-xs text-ink-soft">Coming soon</Text>}
  </ScrollView></View>;
}
