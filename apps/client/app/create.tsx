// Figma: "What would you like to create?" (8:864)
import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useStepBack } from "@/lib/useStepBack";
import { useStoryFlow, useStoryScreenGuard } from "@/lib/storyFlow";
import { type CreateOption, type StoryPlan, type StoryRepository } from "@mosae/core";
import { storyImage } from "@/lib/storyImage";
import {
  CreateAlbumIcon,
  CreateArrowIcon,
  CreateBackIcon,
  CreateCakeIcon,
  CreateCheckIcon,
  CreateFilmIcon,
  CreateHelpIcon,
  CreateMusicIcon,
  CreatePhotosIcon,
  CreateShareIcon,
  CreateTimerIcon,
  CreateVaultIcon,
} from "@/components/sceneIcons";

type Option = {
  id: CreateOption;
  title: string;
  shortName: string;
  description: string;
  meta?: string;
};

const options: Option[] = [
  { id: "film", title: "Direct my film", shortName: "Direct my film", description: "Let AI weave emotional pacing, ambient\naudio & cinematic cuts into an intimate\nheirloom film." },
  { id: "album", title: "Print out as an album", shortName: "Print album", description: "Design a tactile, linen-bound archival\nphotobook crafted on heavy museum-\ngrade art paper." },
  { id: "share", title: "Share with loved ones", shortName: "Share", description: "Invite grandparents and close family to an\nad-free, secure interactive web journal." },
  { id: "apple-photos", title: "Sync to Apple Photos", shortName: "Sync to Photos", description: "Export these curated treasures cleanly into\na standalone album in your native camera\nroll." },
];

function OptionIcon({ id }: { id: CreateOption }) {
  if (id === "film") return <CreateFilmIcon />;
  if (id === "album") return <CreateAlbumIcon />;
  if (id === "share") return <CreateShareIcon />;
  return <CreatePhotosIcon />;
}

function CreateOptionCard({ option, selected, onPress, filmLength }: { option: Option; selected: boolean; onPress: () => void; filmLength: string }) {
  return <Pressable role="radio" aria-checked={selected} aria-label={option.title} onPress={onPress}
    className={`rounded-[16px] bg-surface-raised p-4 ${selected ? "border-2 border-action shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)]" : "shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"}`}>
    <View className="flex-row gap-[14px]">
      <View className={`size-12 items-center justify-center rounded-full ${selected ? "bg-ink-tint" : "bg-surface-sunken"}`}><OptionIcon id={option.id} /></View>
      <View className="min-w-0 flex-1 gap-1.5 pr-1">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2"><Text className="font-sans-semibold text-button leading-5 text-ink">{option.title}</Text>{option.id === "film" && <Text className="rounded-full bg-accent/20 px-2 py-0.5 font-sans-semibold text-[11px] leading-[14px] text-action">AI Directed</Text>}</View>
          <View className={`size-5 items-center justify-center rounded-full ${selected ? "bg-action" : "bg-surface-sunken"}`}>{selected && <CreateCheckIcon />}</View>
        </View>
        <Text className="font-sans text-caption leading-[18px] text-ink-muted">{option.description}</Text>
        {option.id === "film" && <View className="flex-row items-center gap-3 pt-0.5"><View className="flex-row items-center gap-1"><CreateMusicIcon /><Text className="font-sans-semibold text-[11px] leading-[14px] text-action">No music yet</Text></View><View className="flex-row items-center gap-1"><CreateTimerIcon /><Text className="font-sans-semibold text-[11px] leading-[14px] text-action">{filmLength}</Text></View></View>}
        {option.id === "album" && <Text className="pt-0.5 font-sans-semibold text-[11px] leading-[14px] text-ink-muted">Hardcover Linen • 8×10″</Text>}
      </View>
    </View>
  </Pressable>;
}

export default function CreateScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const story = useStoryFlow();
  return <CreateScreenContent key={`${story.identityKey}:plan:${planId}`} planId={planId} repository={story.repository} route={story.route} />;
}

function CreateScreenContent({ planId, repository, route }: {
  planId: string;
  repository: StoryRepository;
  route: (path: string, id?: { planId?: string; filmId?: string }) => string;
}) {
  const router = useRouter();
  const isCurrent = useStoryScreenGuard();
  const goBack = useStepBack(route("/curated-timeline", { planId: planId }) as Href);
  const [plan, setPlan] = useState<StoryPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CreateOption>("film");
  const [comingSoon, setComingSoon] = useState(false);

  const load = useCallback(() => repository.getPlan(planId)
    .then((value) => { if (isCurrent()) setPlan(value); })
    .catch((cause: Error) => { if (isCurrent()) setError(cause.message); }), [isCurrent, planId, repository]);
  useEffect(() => { void load(); }, [load]);
  if (!plan && !error) return <View className="flex-1 bg-surface" />;
  if (error) return <View className="flex-1 items-center justify-center bg-surface"><Text className="text-action">{error}</Text><Pressable role="button" aria-label="Retry" onPress={() => { setError(null); void load(); }} className="mt-4 rounded-full bg-action px-4 py-3"><Text className="font-sans-semibold text-on-action">Retry</Text></Pressable></View>;
  if (!plan) return null;
  const current = options.find((option) => option.id === selected)!;
  const continueWithOption = async () => {
    try {
      const result = await repository.chooseCreateOption(plan.planId, selected);
      if (!isCurrent()) return;
      if (result.available) router.navigate(route("/direct-film", { planId: plan.planId }) as never);
      else setComingSoon(true);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to continue");
    }
  };
  // The same count the curated timeline shows, so the two screens agree.
  const momentCount = (plan.totalMomentCount ?? plan.moments.length) - plan.moments.filter((moment) => !moment.selected).length;
  const where = [plan.place, plan.dateRange].filter(Boolean).join(" • ");
  const filmLength = plan.estimatedFilmLabel.replace(/ film$/, "");
  return <View className="flex-1 bg-surface"><ScrollView className="flex-1" contentContainerClassName="min-h-[1000px] px-4 pb-8" keyboardShouldPersistTaps="handled">
    <View className="flex-row items-center justify-between py-2">
      <Pressable role="button" aria-label="Go back to curated timeline" onPress={() => goBack()} className="size-10 items-center justify-center rounded-full bg-surface-sunken shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><CreateBackIcon /></Pressable>
      <View className="flex-row items-center gap-1.5 rounded-full bg-accent/20 px-3 py-1"><View className="size-1.5 rounded-full bg-accent" /><Text className="font-sans-semibold text-[11px] leading-[14px] tracking-[1.1px] text-accent">STEP 4 • NEXT STEP</Text></View>
      <Pressable role="button" aria-label="Help" className="size-10 items-center justify-center"><CreateHelpIcon /></Pressable>
    </View>
    <View className="pt-4"><Text className="font-sans-semibold text-caption leading-4 tracking-[0.6px] text-action">{momentCount} MOMENTS CURATED</Text><Text className="mt-[5px] font-title text-[26px] leading-[32.5px] text-ink">What would you like to create?</Text><Text className="mt-[7.5px] font-sans text-body leading-[22.75px] text-ink-muted">Your {momentCount} moments{plan.place ? ` from ${plan.place}` : ""} are ready.{`\n`}Choose how you wish to bring this chapter to life.</Text></View>
    <View className="mt-5 flex-row items-center gap-[14px] rounded-[16px] bg-surface-raised p-[14px] shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"><View className="size-14 overflow-hidden rounded-full"><Image source={storyImage(plan.coverImageKey)} className="absolute left-[-41.76%] top-0 h-full w-[183.51%]" resizeMode="stretch" /><View className="absolute inset-x-0 bottom-0 items-center bg-black/60"><Text className="font-sans-semibold text-[9px] leading-[20px] tracking-[-0.45px] text-on-screen">{momentCount} PICS</Text></View></View><View className="flex-1 gap-0.5"><View className="flex-row items-center gap-1.5"><CreateCakeIcon /><Text className="font-sans text-[18px] leading-[26px] text-ink">{plan.title}</Text></View><Text className="font-sans text-caption leading-[18px] text-ink-muted">{where}</Text></View></View>
    <View role="radiogroup" className="mt-6 gap-[14px]">{options.map((option) => <CreateOptionCard key={option.id} option={option} filmLength={filmLength} selected={selected === option.id} onPress={() => { setSelected(option.id); setComingSoon(false); }} />)}</View>
    <View className="mt-5 flex-row items-center justify-center gap-1.5 px-4"><CreateVaultIcon /><Text className="text-center font-sans text-caption leading-[18px] text-ink-muted">Every curated memory is archived in your Vault to re-{`\n`}create anytime.</Text></View>
    <Pressable role="button" aria-label={`Continue with ${current.shortName}`} onPress={() => void continueWithOption()} className="mt-8 h-[52px] flex-row items-center justify-center gap-2 rounded-full bg-action px-6 shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)]"><Text className="font-sans-semibold text-button leading-5 text-on-action">Continue with {current.shortName}</Text><CreateArrowIcon /></Pressable>
    {comingSoon && <Text className="mt-2 text-center font-sans text-caption text-ink-muted">Coming soon</Text>}
  </ScrollView></View>;
}
