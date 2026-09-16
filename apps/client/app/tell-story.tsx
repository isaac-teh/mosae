import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStepBack } from "@/lib/useStepBack";
import { getStoryRepository } from "@mosae/core";
import { StepHeader } from "@/components/StepHeader";
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

// Figma: "Tell AI the Story" (1:292)
export default function TellStoryScreen() {
  const [storyText, setStoryText] = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const goBack = useStepBack("/pick-memory");
  const params = useLocalSearchParams<{ projectId?: string; count?: string }>();
  const dictation = useDictation((text) => setStoryText((prev) => (prev ? `${prev} ${text}` : text)));

  const projectId = params.projectId ?? null;
  const count = Number(params.count ?? 0);
  const canSubmit = storyText.trim().length > 0 || themes.length > 0;

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
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const focus = themes.length ? `\n\nFocus on: ${themes.join(", ")}` : "";
    try {
      const { planId } = await getStoryRepository().createPlan(`${storyText.trim()}${focus}`, projectId ? [projectId] : []);
      router.push(`/review-moments?planId=${planId}` as any);
    } catch (e) {
      console.error("submit failed", e);
      setError("Couldn't find the moments. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      stickyHeaderIndices={[0]}
      keyboardShouldPersistTaps="handled"
      style={{ overflow: "visible" }}
    >
      <StepHeader
        step="Step 2 of 6"
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

        {error && <Text className="mt-4 text-center font-sans text-xs text-brand">{error}</Text>}

        <PrimaryButton
          label={submitting ? "Finding the moments..." : "Find the moments"}
          onPress={handleSubmit}
          icon={<SparklesIcon />}
          disabled={!canSubmit || submitting}
        />
      </View>
    </ScrollView>
  );
}
