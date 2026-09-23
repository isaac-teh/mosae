// Figma: "Review Selected Moments" (1:384)
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";
import { useStepBack } from "@/lib/useStepBack";
import { useStoryFlow } from "@/lib/storyFlow";
import { momentRows } from "@/lib/momentRows";
import { useStoryPlan } from "@/lib/useStoryPlan";
import { StepHeader } from "@/components/StepHeader";
import { MomentCard } from "@/components/MomentCard";
import { BottomTabBar } from "@/components/BottomTabBar";
import {
  ArchivalSparkleIcon,
  AddPhotoIcon,
  AddMoreIcon,
  ContinueArrowIcon,
} from "@/components/sceneIcons";

export default function ReviewMomentsScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { repository, route } = useStoryFlow();
  const goBack = useStepBack(route("/tell-story") as Href);
  const { plan, error, mutationError, updating, mutate } = useStoryPlan(planId, repository);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-5">
        <Text className="text-brand text-sm">{error}</Text>
        <Pressable
          onPress={() => goBack()}
          className="mt-4 rounded-full bg-brand px-6 py-2"
        >
          <Text className="font-sans-semibold text-sm text-white">Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (!plan) {
    return (
      <StepHeader
        step="STEP 3 OF 6"
        label="CURATED MOMENT"
        progress={0.4744}
        onBack={() => goBack()}
        backLabel="Go back to tell story"
      />
    );
  }

  const archivalText = plan.archivalMatch.join(" \u2022 ");

  function navigateToPickMemory() {
    void router.navigate("/pick-memory");
  }

  function navigateToCuratedTimeline() {
    void router.navigate(route("/curated-timeline", { planId: plan!.planId }) as any);
  }

  return (
    <View className="flex-1 bg-canvas">
      {/* Header overlay - absolute positioned over content */}
      <View className="absolute inset-x-0 top-0 z-30">
        <StepHeader
          step="STEP 3 OF 6"
          label="CURATED MOMENT"
          progress={0.4744}
          onBack={() => goBack()}
          backLabel="Go back to tell story"
        />
      </View>

      {/* Content starts at y=84 (80pt + 4pt heading margin) */}
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        <View className="px-5 pb-[112px] pt-[84px]">
          {/* Intro heading - Plus Jakarta Sans SemiBold 14px leading 17.5px tracking -0.35px */}
          <Text className="font-sans-semibold text-[14px] leading-[17.5px] tracking-[-0.35px] text-ink">
            {plan.intro.headline}
          </Text>

          {/* Body copy */}
          <Text className="mt-[3.25px] font-sans text-sm leading-[22.75px] text-ink-soft">
            {plan.intro.body}
          </Text>

          {/* AI Archival Match strip - 11px single line clipped, px-[10px] py-[8px], rounded-[16px] */}
          <View className="mt-4 flex-row items-center overflow-hidden rounded-[16px] bg-honey-tint px-[10px] py-2 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
            <View className="size-[16.5px] shrink-0 overflow-hidden">
              <ArchivalSparkleIcon />
            </View>
            <Text className="ml-1.5 font-sans text-xs leading-[15.13px] text-honey-deep whitespace-nowrap">
              <Text className="font-sans-semibold text-honey">AI Archival Match: </Text>
              {archivalText}
            </Text>
          </View>

          {/* Cards - 16px gap between each card section */}
          <View className="mt-4">
            {mutationError && <Text role="alert" className="mb-3 text-sm text-brand">{mutationError}</Text>}
            {momentRows(plan.moments).map((row, index) => (
              <View key={row.moments[0].id} className={`${index ? "mt-4" : ""} ${row.size === "half" ? "flex-row gap-2" : ""}`}>
                {row.moments.map((moment) => (
                  <MomentCard
                    key={moment.id}
                    moment={moment}
                    size={row.size}
                    onToggleSelected={() => { void mutate((id) => repository.setMomentSelected(id, moment.id, !moment.selected)); }}
                    onToggleFavorite={() => { void mutate((id) => repository.setMomentFavorite(id, moment.id, !moment.favorite)); }}
                  />
                ))}
              </View>
            ))}

            {/* Add from other photos card */}
            <Pressable
              onPress={navigateToPickMemory}
              role="button"
              aria-label={`Add from ${plan.otherPhotoCount} other photos`}
              className="mt-4 rounded-[24px] bg-surface-muted px-5 py-6 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"
            >
              <View className="mx-auto mb-3 size-12 items-center justify-center rounded-full bg-track">
                <AddPhotoIcon />
              </View>
              <Text className="font-serif text-[18px] leading-[26px] text-center text-ink">
                Add from {plan.otherPhotoCount} other photos
              </Text>
              <Text className="mt-1.5 font-sans text-sm leading-[18px] text-center text-ink-soft">
                Browse unselected captures, candid bursts, or audio clips from this celebration trip.
              </Text>
            </Pressable>

            {/* Dual action buttons - grid 1fr : 1.4fr, 44px tall, gap-0 */}
            <View className="mt-4">
              <View className="grid grid-cols-[1fr_1.4fr] auto-rows-[44px] gap-0">
                <Pressable
                  onPress={navigateToPickMemory}
                  role="button"
                  aria-label="Add more"
                  className="flex-row items-center justify-center gap-1.5 rounded-full bg-surface-pill px-4 py-3 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]"
                >
                  <AddMoreIcon />
                  <Text className="font-sans-semibold text-sm leading-[20px] text-center text-ink">
                    Add more
                  </Text>
                </Pressable>
                <Pressable
                  disabled={updating}
                  onPress={navigateToCuratedTimeline}
                  role="button"
                  aria-label="Continue to curated timeline"
                  className="flex-row items-center justify-center gap-1.5 rounded-full bg-brand px-4 py-3 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
                >
                  <Text className="font-sans-semibold text-sm leading-[20px] text-center text-white">
                    Continue
                  </Text>
                  <ContinueArrowIcon />
                </Pressable>
              </View>
            </View>

            {/* Footnote - 11px, single line, rgba(89,65,59,0.7) */}
            <View className="mt-1 items-center">
              <Text className="whitespace-nowrap font-sans text-[11px] leading-[22px] text-center" style={{ color: "rgba(89,65,59,0.7)" }}>
                Chapter 3: Director mode enables audio overlay &amp; voice pacing
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Bottom nav - absolute at bottom */}
      <BottomTabBar active="gallery" />
    </View>
  );
}
