"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { submitStory } from "@/lib/api";
import { StepProgress } from "@/components/StepProgress";

const THEMES = [
  "✨ Having fun",
  "🎂 Birthday celebration",
  "🍜 Street food & treats",
  "⛩️ Places we explored",
  "👨‍👩‍👧 Candid family hugs",
  "😂 Goofy moments",
];

// Minimal typing for the Web Speech API (not in lib.dom for all browsers).
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

export default function TellStoryPage() {
  return (
    <Suspense fallback={null}>
      <TellStoryForm />
    </Suspense>
  );
}

// Figma: "Tell AI the Story" (1:292)
function TellStoryForm() {
  const [storyText, setStoryText] = useState("");
  const [themes, setThemes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const mediaRefs: string[] = JSON.parse(searchParams.get("mediaRefs") ?? "[]");
  const canSubmit = storyText.trim().length > 0 || themes.length > 0;

  function toggleTheme(theme: string) {
    setThemes((prev) => (prev.includes(theme) ? prev.filter((t) => t !== theme) : [...prev, theme]));
  }

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Dictation isn't supported in this browser.");
      return;
    }
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      setStoryText((prev) => (prev ? `${prev} ${text}` : text));
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setError(null);
    setListening(true);
    rec.start();
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const focus = themes.length ? `\n\nFocus on: ${themes.join(", ")}` : "";
    try {
      const { planId } = await submitStory("user-1", `${storyText.trim()}${focus}`, mediaRefs);
      router.push(`/review-moments?planId=${planId}`);
    } catch (e) {
      console.error("submit failed", e);
      setError("Couldn't find the moments. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 bg-canvas/85 shadow-[0_1px_8px_rgba(54,49,44,0.04)] backdrop-blur-md">
        <div className="relative flex h-14 items-center justify-center px-5">
          <button
            type="button"
            aria-label="Go back to Step 1"
            onClick={() => router.back()}
            className="absolute left-4 flex size-10 items-center justify-center rounded-full"
          >
            <img src="/icons/arrow-left.svg" alt="" width={13.333} height={13.333} className="size-[13.333px]" />
          </button>
          <div className="flex items-center gap-1 rounded-full bg-surface-pill px-4 py-1 drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <span className="text-[11px] font-semibold uppercase leading-[14px] tracking-[0.55px] text-ink-soft">Step 2 of 6</span>
            <span className="size-1 rounded-full bg-brand-dot" />
            <span className="text-[11px] font-semibold leading-[14px] text-ink-soft">STORY INTENT</span>
          </div>
        </div>
        <StepProgress value={2 / 7} />
      </header>

      <div className="px-5 pb-10 pt-6">
        <h2 className="pt-1 text-sm font-semibold leading-[17.5px] tracking-[-0.35px] text-ink">
          What do you want this story to be about?
        </h2>
        <p className="mt-1 text-sm leading-[22.75px] text-ink-soft">
          Mosaé will listen to your intent and curate the most meaningful moments from your{" "}
          {mediaRefs.length || "selected"} {mediaRefs.length === 1 ? "memory" : "memories"}.
        </p>

        <div className="mt-4 flex min-h-[280px] flex-col justify-between rounded-2xl bg-surface p-6 shadow-md">
          <div className="flex items-center gap-1.5 pb-3">
            <span className="size-2 rounded-full bg-brand-bright" />
            <span className="text-[11px] font-semibold uppercase leading-[14px] tracking-[0.275px] text-brand-bright">Intent</span>
          </div>
          <textarea
            value={storyText}
            onChange={(e) => setStoryText(e.target.value)}
            placeholder="This was our first family trip to Japan for my daughter's birthday. Focus on moments of her having fun, the food we tried, and the quiet places we explored together."
            className="min-h-[160px] w-full flex-1 resize-none bg-transparent text-sm leading-[22.75px] text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={toggleDictation}
              aria-pressed={listening}
              className={`flex items-center gap-1 rounded-full px-4 py-1.5 ${listening ? "bg-brand-tint" : "bg-surface-sunken"}`}
            >
              <img src="/icons/mic.svg" alt="" width={10.5} height={14.25} className="h-[14.25px] w-[10.5px]" />
              <span className="text-[11px] font-semibold leading-[14px] text-ink">{listening ? "Listening..." : "Dictate story"}</span>
            </button>
            <button
              type="button"
              onClick={() => setStoryText("")}
              disabled={!storyText}
              className="px-1 text-xs leading-[18px] text-ink-soft disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-soft">Suggested focal themes</span>
            <span className="text-xs leading-[18px] text-ink-faint">Tap to attach</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {THEMES.map((theme) => {
              const active = themes.includes(theme);
              return (
                <button
                  type="button"
                  key={theme}
                  onClick={() => toggleTheme(theme)}
                  aria-pressed={active}
                  className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium leading-[18px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)] ${
                    active ? "bg-brand-tint text-brand-deep" : "bg-surface-sunken text-ink-soft"
                  }`}
                >
                  {theme}
                  {active && (
                    <img src="/icons/chip-check.svg" alt="" width={10.188} height={7.516} className="h-[7.516px] w-[10.188px]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-1 py-1">
          <img src="/icons/shield.svg" alt="" width={10.667} height={13.333} className="h-[13.333px] w-[10.667px]" />
          <span className="text-xs leading-[18px] text-ink-soft/80">Mosaé curates your memories privately and securely.</span>
        </div>

        {error && <p className="mt-4 text-center text-xs text-brand">{error}</p>}

        <button
          type="button"
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
          className="mt-6 flex h-14 w-full items-center justify-center gap-1 rounded-full bg-brand text-sm font-medium tracking-[0.35px] text-white shadow-xl disabled:opacity-50"
        >
          <img src="/icons/sparkles.svg" alt="" width={18.333} height={18.333} className="size-[18.333px]" />
          {submitting ? "Finding the moments..." : "Find the moments"}
        </button>
      </div>
    </main>
  );
}
