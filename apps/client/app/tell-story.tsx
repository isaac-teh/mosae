import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStepBack } from "@/lib/useStepBack";
import { useProjectProgress } from "@/lib/useProjectProgress";
import { startStoryPlan, watchStoryPlan, type StoryPlanJob } from "@mosae/core";
import { getFixtureRepository, storyRoute } from "@/lib/storyFlow";
import { StepHeader } from "@/components/StepHeader";
import { ProcessingBanner } from "@/components/ProcessingBanner";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useDictation } from "@/lib/useDictation";
import { ChipCheckIcon, MicIcon, ShieldIcon, SparklesIcon } from "@/components/icons";

const THEMES = [
  "✨ Having fun",
  "🎂 Birthday celebration",
  "🍜 Street food & treats",
  "⛩️ Places we explored",
  "👨‍👩‍👧 Candid family hugs",
  "😂 Goofy moments",
];

const FAILED_PROJECT = "Planning is unavailable because none of your memories could be read. Please upload them again.";
const COLLECTING_PROJECT = "Finish adding your memories before planning a story.";

// Figma: "Tell AI the Story" (1:292)
export default function TellStoryScreen() {
  const params = useLocalSearchParams<{ projectId?: string; count?: string; live?: string; repository?: string }>();
  const apiEnabled = process.env.EXPO_PUBLIC_USE_API_STORY_REPOSITORY === "true";
  const live = params.repository !== "fixture" && (params.live === "1" || params.repository === "api" || apiEnabled);
  const projectId = params.projectId ?? (apiEnabled ? process.env.EXPO_PUBLIC_STORY_PROJECT_ID : null) ?? null;
  // Changing flow/project disposes all pending requests, listeners and UI state.
  return <TellStoryProject key={JSON.stringify([live, projectId])} live={live} projectId={projectId} count={Number(params.count ?? 0)} />;
}

function TellStoryProject({ live, projectId, count }: { live: boolean; projectId: string | null; count: number }) {
  const [storyText, setStoryText] = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<StoryPlanJob | null>(null);
  const [reconnect, setReconnect] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const requestId = useRef(0);
  const { push } = useRouter();
  const goBack = useStepBack("/pick-memory");
  const dictation = useDictation((text) => setStoryText((prev) => (prev ? `${prev} ${text}` : text)));

  const progress = useProjectProgress(projectId, count, live);
  const canSubmit = storyText.trim().length > 0 || themes.length > 0;
  const unavailable = !live ? null : !projectId
    ? "Choose your memories before planning a story."
    : progress?.status === "failed"
      ? FAILED_PROJECT
      : progress?.status === "collecting" ? COLLECTING_PROJECT : null;
  const jobId = job?.id ?? null;
  const reconnecting = Boolean(error && job && job.status !== "failed" && job.status !== "succeeded");
  const planningLabel = job?.status === "waiting_for_ready" ? "Waiting for your memories to be ready"
    : job?.status === "queued" ? "Waiting to plan your story"
      : job?.status === "publishing" || job?.progress === "organizing" ? "Organizing your story"
        : job?.progress === "inspecting" ? "Inspecting the moments" : "Searching your memories";

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestId.current++; };
  }, []);

  useEffect(() => {
    if (!projectId || !jobId) return;
    let active = true;
    const request = requestId.current;
    let stop = () => {};
    stop = watchStoryPlan(projectId, jobId, {
      onChange(next) {
        if (!active || request !== requestId.current || next.id !== jobId) return;
        setJob(next);
        setError(null);
        if (next.status === "failed" || next.status === "succeeded") {
          active = false;
          stop();
          setSubmitting(false);
          if (next.status === "failed") {
            setError(next.reason || "Couldn't find the moments. Please try again.");
          } else {
            // The character picker sits between the plan and reviewing its moments:
            // faces exist by now, and naming them still feeds back into the plan.
            push(storyRoute("/character-picker", { planId: next.proposalId }, { repository: "api", projectId }) as any);
          }
        }
      },
      onError(reason) {
        if (!active || request !== requestId.current) return;
        setError(reason instanceof Error ? reason.message : "Couldn't read planning progress. Please reconnect.");
      },
    });
    if (!active) stop();
    return () => { active = false; stop(); };
  }, [projectId, jobId, reconnect, push]);

  function toggleTheme(theme: string) {
    setThemes((prev) => (prev.includes(theme) ? prev.filter((t) => t !== theme) : [...prev, theme]));
  }

  function toggleDictation() {
    if (!dictation.supported) {
      setError("Dictation isn't supported in this browser.");
      return;
    }
    setError(null);
    dictation.toggle();
  }

  async function handleSubmit() {
    if (!canSubmit || unavailable || inFlight.current) return;
    if (reconnecting) {
      setError(null);
      setReconnect(value => value + 1);
      return;
    }
    if (submitting) return;
    inFlight.current = true;
    const request = ++requestId.current;
    const current = () => mounted.current && request === requestId.current;
    setSubmitting(true);
    setError(null);
    setJob(null);
    const focus = themes.length ? `\n\nFocus on: ${themes.join(", ")}` : "";
    try {
      if (live && projectId) {
        const next = await startStoryPlan(projectId, storyText.trim() || themes.join(", "), themes);
        if (current()) setJob(next);
        return;
      }
      const { planId } = await getFixtureRepository().createPlan(`${storyText.trim()}${focus}`, projectId ? [projectId] : []);
      // The fixture flow has no stored faces to name, so it skips the picker.
      if (current()) push(storyRoute("/review-moments", { planId }, { repository: "fixture" }) as any);
    } catch (e) {
      if (!current()) return;
      const message = e instanceof Error ? e.message : "Couldn't find the moments. Please try again.";
      setError(message === "project_failed" ? FAILED_PROJECT : message === "project_collecting" ? COLLECTING_PROJECT : message);
      setSubmitting(false);
    } finally {
      if (current()) inFlight.current = false;
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      stickyHeaderIndices={[0]}
      keyboardShouldPersistTaps="handled"
    >
      <StepHeader
        step="Step 2 of 7"
        label="STORY INTENT"
        progress={2 / 7}
        onBack={() => goBack()}
        backLabel="Go back to Step 1"
      />

      <View className="px-5 pb-10 pt-6">
        <Text role="heading" aria-level={2} className="pt-1 font-sans-semibold text-sm leading-[17.5px] tracking-[-0.35px] text-ink">
          What do you want this story to be about?
        </Text>
        <Text className="mt-1 font-sans text-sm leading-[22.75px] text-ink-soft">
          Mosaé will listen to your intent and curate the most meaningful moments from your {count || "selected"}{" "}
          {count === 1 ? "memory" : "memories"}.
        </Text>
        <ProcessingBanner progress={progress} />

        <View className="mt-4 min-h-[280px] justify-between rounded-2xl bg-surface p-6 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)]">
          <View className="flex-row items-center gap-1.5 pb-3">
            <View className="size-2 rounded-full bg-brand-bright" />
            <Text className="font-sans-semibold text-[11px] uppercase leading-[14px] tracking-[0.275px] text-brand-bright">Intent</Text>
          </View>
          <TextInput
            multiline
            value={storyText}
            onChangeText={setStoryText}
            placeholder="This was our first family trip to Japan for my daughter's birthday. Focus on moments of her having fun, the food we tried, and the quiet places we explored together."
            placeholderTextColor="#8c716a"
            textAlignVertical="top"
            className="min-h-[160px] w-full flex-1 bg-transparent font-sans text-sm leading-[22.75px] text-ink outline-none"
          />
          <View className="flex-row items-center justify-between pt-2">
            <Pressable
              role="button"
              aria-pressed={dictation.listening}
              onPress={toggleDictation}
              className={`flex-row items-center gap-1 rounded-full px-4 py-1.5 ${dictation.listening ? "bg-brand-tint" : "bg-surface-sunken"}`}
            >
              <MicIcon />
              <Text className="font-sans-semibold text-[11px] leading-[14px] text-ink">
                {dictation.listening ? "Listening..." : "Dictate story"}
              </Text>
            </Pressable>
            <Pressable role="button" onPress={() => setStoryText("")} disabled={!storyText} className="px-1 disabled:opacity-40">
              <Text className="font-sans text-xs leading-[18px] text-ink-soft">Clear</Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-sans-medium text-xs text-ink-soft">Suggested focal themes</Text>
            <Text className="font-sans text-xs leading-[18px] text-ink-faint">Tap to attach</Text>
          </View>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {THEMES.map((theme) => {
              const active = themes.includes(theme);
              return (
                <Pressable
                  role="button"
                  key={theme}
                  aria-pressed={active}
                  onPress={() => toggleTheme(theme)}
                  className={`flex-row items-center gap-1 rounded-full px-3.5 py-1.5 shadow-[0_1px_1px_rgba(0,0,0,0.05)] ${
                    active ? "bg-brand-tint" : "bg-surface-sunken"
                  }`}
                >
                  <Text className={`font-sans-medium text-xs leading-[18px] ${active ? "text-brand-deep" : "text-ink-soft"}`}>{theme}</Text>
                  {active && <ChipCheckIcon />}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="mt-6 flex-row items-center justify-center gap-1 py-1">
          <ShieldIcon />
          <Text className="font-sans text-xs leading-[18px] text-ink-soft/80">Mosaé curates your memories privately and securely.</Text>
        </View>

        {unavailable && <Text role="alert" className="mt-4 text-center font-sans text-xs text-brand">{unavailable}</Text>}
        {job && submitting && !error && !unavailable && (
          <View role="status" aria-live="polite" className="mt-4 rounded-2xl bg-surface-sunken px-4 py-3">
            <Text className="font-sans text-xs leading-[18px] text-ink-soft">{planningLabel}</Text>
          </View>
        )}
        {error && <Text role="alert" className="mt-4 text-center font-sans text-xs text-brand">{error}</Text>}

        <PrimaryButton
          label={reconnecting ? "Reconnect" : submitting ? "Finding the moments..." : error ? "Try again" : "Find the moments"}
          onPress={handleSubmit}
          icon={<SparklesIcon />}
          disabled={!canSubmit || Boolean(unavailable) || (submitting && !reconnecting)}
        />
      </View>
    </ScrollView>
  );
}
