// Figma: "Review Selected Moments" (1:384)
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import type { AlternativeShot, Moment, PlanEdits } from "@mosae/core";
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

/**
 * One moment on the live Review: its photo, why it was chosen, and the edits.
 * Hidden photos stay listed (dimmed) so they can be brought back.
 */
function ReviewMoment({ moment, first, last, busy, highlight, onToggleSelected, onSwap, onMove, onHide }: {
  moment: Moment; first: boolean; last: boolean; busy: boolean; highlight: boolean;
  onToggleSelected: () => void; onSwap: () => void; onMove: (delta: -1 | 1) => void; onHide?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorId = `moment-${moment.id}`;
  // After a move, bring the moved photo into view so the eye follows it.
  useEffect(() => {
    if (!highlight || typeof document === "undefined") return;
    document.getElementById(anchorId)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [highlight, anchorId]);
  const action = (label: string, aria: string, onPress: () => void, disabled = false) => (
    <Pressable role="button" aria-label={aria} disabled={busy || disabled} onPress={() => { setOpen(false); onPress(); }} className={`rounded-full bg-surface-sunken px-3 py-1.5 ${disabled ? "opacity-40" : ""}`}>
      <Text className="font-sans-semibold text-xs leading-4 text-ink">{label}</Text>
    </Pressable>
  );
  return (
    <View nativeID={anchorId} className={`mt-3 rounded-[26px] ${highlight ? "border-2 border-brand" : "border-2 border-transparent"}`}>
      <MomentCard moment={moment} size="hero" onToggleSelected={onToggleSelected} />
      <View className="mt-1.5 flex-row items-start gap-2 px-1">
        <Text className="flex-1 font-sans text-xs leading-4 text-ink-soft">
          {moment.hidden ? "Hidden by you." : moment.reason ?? ""}
        </Text>
        <Pressable role="button" aria-label={`More for ${moment.title}`} aria-expanded={open} onPress={() => setOpen((value) => !value)} className="rounded-full px-2">
          <Text className="font-sans-semibold text-base leading-4 text-ink-soft">⋯</Text>
        </Pressable>
      </View>
      {open && (
        <View className="mt-2 flex-row flex-wrap gap-2 px-1">
          {action("Swap photo", `Swap photo for ${moment.title}`, onSwap, !!moment.hidden)}
          {action("Move up", `Move ${moment.title} up`, () => onMove(-1), first)}
          {action("Move down", `Move ${moment.title} down`, () => onMove(1), last)}
          {onHide && action(moment.hidden ? "Show photo" : "Hide photo", `${moment.hidden ? "Show" : "Hide"} ${moment.title}`, onHide)}
        </View>
      )}
    </View>
  );
}

export default function ReviewMomentsScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { repository, route } = useStoryFlow();
  const goBack = useStepBack(route("/tell-story") as Href);
  const { plan, error, mutationError, updating, mutate } = useStoryPlan(planId, repository);
  // Each edit pushes the edits it replaced; undo sends the last one back.
  const undoStack = useRef<PlanEdits[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [swapping, setSwapping] = useState<{ moment: Moment; shots: AlternativeShot[] | null } | null>(null);
  const [showLeftOut, setShowLeftOut] = useState(false);
  // The moment just moved, outlined briefly so it is clear where it went.
  const [justMoved, setJustMoved] = useState<string | null>(null);
  useEffect(() => {
    if (!justMoved) return;
    const timer = setTimeout(() => setJustMoved(null), 1600);
    return () => clearTimeout(timer);
  }, [justMoved]);
  // Every edit is a new plan version. Point the URL at it, so a reload or a
  // shared link opens what is on screen rather than the version before the edit.
  const shownPlanId = plan?.planId;
  useEffect(() => {
    if (shownPlanId && planId && shownPlanId !== planId) router.setParams?.({ planId: shownPlanId });
  }, [shownPlanId, planId, router]);

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
        progress={0.5}
        onBack={() => goBack()}
        backLabel="Go back to tell story"
      />
    );
  }

  const archivalText = plan.archivalMatch.join(" \u2022 ");
  const edits = plan.edits;
  const momentsById = new Map(plan.moments.map((moment) => [moment.id, moment]));

  /** Applies one Review edit as a new plan version, remembering the old edits for undo. */
  function edit(change: (current: PlanEdits) => PlanEdits, onDone?: () => void) {
    if (!edits) return;
    const before = edits;
    void mutate((id) => repository.applyEdits(id, change(structuredClone(before)))).then((ok) => {
      if (!ok) return;
      undoStack.current.push(before);
      setUndoCount(undoStack.current.length);
      onDone?.();
    });
  }
  function undo() {
    const previous = undoStack.current.at(-1);
    if (!previous) return;
    void mutate((id) => repository.applyEdits(id, previous)).then((ok) => {
      if (!ok) return;
      undoStack.current.pop();
      setUndoCount(undoStack.current.length);
    });
  }
  const toggleSelected = (moment: Moment) => {
    if (!edits) { void mutate((id) => repository.setMomentSelected(id, moment.id, !moment.selected)); return; }
    edit((next) => {
      const deselected = new Set(next.deselectedMomentIds);
      if (moment.selected) deselected.add(moment.id);
      else deselected.delete(moment.id);
      // Deselecting a must-include moment would contradict itself, so it stops being one.
      const mustIncludeMomentIds = moment.selected ? next.mustIncludeMomentIds.filter((id) => id !== moment.id) : next.mustIncludeMomentIds;
      return { ...next, deselectedMomentIds: [...deselected], mustIncludeMomentIds };
    });
  };
  const toggleHidden = (moment: Moment, shotId: string) => edit((next) => ({
    ...next,
    hiddenShotIds: moment.hidden ? next.hiddenShotIds.filter((id) => id !== shotId) : [...next.hiddenShotIds, shotId],
  }));
  const move = (chapterMomentIds: string[], momentId: string, delta: -1 | 1) => edit((next) => {
    const order = [...chapterMomentIds];
    const from = order.indexOf(momentId);
    const to = from + delta;
    if (to < 0 || to >= order.length) return next;
    [order[from], order[to]] = [order[to]!, order[from]!];
    // Keep every other chapter's order as it was; replace this chapter's run.
    const rest = next.momentOrder.filter((id) => !chapterMomentIds.includes(id));
    return { ...next, momentOrder: [...rest, ...order] };
  }, () => setJustMoved(momentId));
  async function openSwap(moment: Moment) {
    setSwapping({ moment, shots: null });
    try {
      const shots = await repository.getAlternatives(plan!.planId, moment.id);
      setSwapping((current) => (current?.moment.id === moment.id ? { moment, shots } : current));
    } catch {
      setSwapping((current) => (current?.moment.id === moment.id ? { moment, shots: [] } : current));
    }
  }
  const swapTo = (moment: Moment, shotId: string) => {
    setSwapping(null);
    edit((next) => ({ ...next, photoSwaps: { ...next.photoSwaps, [moment.id]: shotId } }));
  };

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
          progress={0.5}
          onBack={() => goBack()}
          backLabel="Go back to tell story"
        />
      </View>

      {/* Content starts at y=84 (80pt + 4pt heading margin) */}
      {/* No scroll anchoring: it pinned the tapped card in place on a move, so the
          other photos slid past it and the move looked reversed. */}
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" style={{ overflowAnchor: "none" } as object}>
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
            {edits && plan.chapters.length > 0 ? (
              <>
                <View className="mb-3 flex-row items-center justify-between">
                  <Text className="font-sans text-xs leading-4 text-ink-soft">Tap ⋯ on a moment to swap, move or hide it.</Text>
                  <Pressable role="button" aria-label="Undo" disabled={undoCount === 0 || updating} onPress={undo} className={`rounded-full px-3 py-1.5 ${undoCount === 0 ? "bg-surface-sunken opacity-50" : "bg-surface-pill"}`}>
                    <Text className="font-sans-semibold text-xs leading-4 text-ink">Undo</Text>
                  </Pressable>
                </View>
                {plan.chapters.map((chapter, chapterIndex) => (
                  <View key={chapter.id} className={chapterIndex ? "mt-6" : ""}>
                    <Text className="font-serif text-[20px] leading-[26px] text-ink">{chapter.title}</Text>
                    {chapter.subtitle ? <Text className="mt-0.5 font-sans text-xs leading-4 text-ink-soft">{chapter.subtitle}</Text> : null}
                    {chapter.momentIds.map((momentId, position) => {
                      const moment = momentsById.get(momentId);
                      if (!moment) return null;
                      return (
                        <ReviewMoment
                          key={moment.id}
                          moment={moment}
                          first={position === 0}
                          last={position === chapter.momentIds.length - 1}
                          busy={updating}
                          highlight={justMoved === moment.id}
                          onToggleSelected={() => toggleSelected(moment)}
                          onSwap={() => void openSwap(moment)}
                          onMove={(delta) => move(chapter.momentIds, moment.id, delta)}
                          onHide={moment.shotId ? () => toggleHidden(moment, moment.shotId!) : undefined}
                        />
                      );
                    })}
                  </View>
                ))}
                {(plan.leftOut?.length ?? 0) > 0 && (
                  <View className="mt-6 rounded-[16px] bg-white p-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]">
                    <Pressable role="button" aria-expanded={showLeftOut} aria-label={`Left out (${plan.leftOut!.length})`} onPress={() => setShowLeftOut((open) => !open)} className="flex-row items-center justify-between">
                      <Text className="font-sans-semibold text-sm leading-5 text-ink">{`Left out (${plan.leftOut!.length})`}</Text>
                      <Text className="font-sans text-xs leading-4 text-ink-soft">{showLeftOut ? "Hide" : "Show why"}</Text>
                    </Pressable>
                    {showLeftOut && plan.leftOut!.map((item) => (
                      <View key={item.shotId} className="mt-3 flex-row items-center gap-3">
                        {item.thumbnailUrl ? <Image source={{ uri: item.thumbnailUrl }} accessibilityIgnoresInvertColors style={{ width: 48, height: 48, borderRadius: 8 }} /> : <View style={{ width: 48, height: 48 }} className="rounded-[8px] bg-surface-sunken" />}
                        <Text className="flex-1 font-sans text-xs leading-4 text-ink-soft">{item.reason}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : momentRows(plan.moments).map((row, index) => (
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

      {swapping && (
        <View className="absolute inset-0 z-40 items-center justify-center px-5">
          <Pressable role="button" aria-label="Close" onPress={() => setSwapping(null)} className="absolute inset-0 bg-black/40" />
          <View role="dialog" aria-label="Swap photo" className="w-full max-w-[420px] rounded-[20px] bg-white p-5">
            <Text className="font-serif text-[20px] leading-[26px] text-ink">Swap photo</Text>
            <Text className="mt-1 font-sans text-xs leading-4 text-ink-soft">Other shots from the same moment.</Text>
            {swapping.shots === null ? (
              <Text className="mt-4 font-sans text-sm leading-5 text-ink-soft">Looking…</Text>
            ) : swapping.shots.length === 0 ? (
              <Text className="mt-4 font-sans text-sm leading-5 text-ink-soft">No other shots of this moment.</Text>
            ) : (
              <View className="mt-4 flex-row flex-wrap gap-2">
                {swapping.shots.map((shot, index) => (
                  <Pressable key={shot.shotId} role="button" aria-label={`Use other shot ${index + 1}`} onPress={() => swapTo(swapping.moment, shot.shotId)}>
                    <Image source={{ uri: shot.thumbnailUrl }} accessibilityIgnoresInvertColors style={{ width: 96, height: 96, borderRadius: 12 }} />
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable role="button" aria-label="Cancel" onPress={() => setSwapping(null)} className="mt-4 items-center py-2">
              <Text className="font-sans-medium text-sm leading-5 text-ink-soft">Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Bottom nav - absolute at bottom */}
      <BottomTabBar active="gallery" />
    </View>
  );
}
