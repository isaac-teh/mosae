"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setPendingMedia } from "@/lib/pendingMedia";
import { Logo } from "@/components/Logo";

const STEPS = [
  { emoji: "🖼️", title: "Pick your moments", body: "Photos and videos from a trip, a birthday, or an ordinary Sunday." },
  { emoji: "✍️", title: "Tell the story", body: "Say what matters. Mosaé finds the moments that match." },
  { emoji: "🎬", title: "Get your film", body: "Gemini directs pacing, music, and cuts into a keepsake film." },
];

function isMedia(file: File) {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

export default function Home() {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function start(list: FileList | null) {
    const files = Array.from(list ?? []).filter(isMedia);
    if (files.length === 0) {
      setError("Please choose photos or videos.");
      return;
    }
    setPendingMedia(files);
    router.push("/pick-memory");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas pb-32">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          start(e.target.files);
          e.target.value = "";
        }}
      />

      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand-tint/60 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -left-28 top-72 size-64 rounded-full bg-honey-tint blur-3xl" />

      <header className="relative flex h-14 items-center justify-between px-5">
        <Logo />
        <span className="rounded-full bg-surface-pill px-3 py-1 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.55px] text-ink-soft">
          Beta
        </span>
      </header>

      <section className="relative px-5 pt-6">
        <p className="text-[11px] font-semibold uppercase leading-[14px] tracking-[0.55px] text-brand-bright">
          Your memories, directed
        </p>
        <h1 className="mt-3 font-serif text-[36px] leading-[40px] tracking-[-0.5px] text-ink">
          Turn your photos into a film <em className="text-brand">worth keeping.</em>
        </h1>
        <p className="mt-3 text-sm leading-[22.75px] text-ink-soft">
          Upload the moments you love, tell Mosaé what they mean, and get an heirloom-quality short film made from your
          own photos and videos.
        </p>
      </section>

      <section className="relative px-5 pt-7">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            start(e.dataTransfer.files);
          }}
          className={`group flex w-full flex-col items-center rounded-3xl border-2 border-dashed px-6 pb-7 pt-8 text-center shadow-md transition-colors ${
            dragging ? "border-brand bg-brand-tint/40" : "border-brand-dot bg-surface"
          }`}
        >
          <span aria-hidden className="relative mb-5 flex h-[92px] w-[150px] items-center justify-center">
            <span className="absolute left-1 top-3 h-[72px] w-[58px] -rotate-12 rounded-xl bg-honey-tint shadow-sm" />
            <span className="absolute right-1 top-3 h-[72px] w-[58px] rotate-12 rounded-xl bg-brand-tint shadow-sm" />
            <span className="relative flex h-[84px] w-[66px] items-center justify-center rounded-xl bg-brand shadow-lg transition-transform group-hover:-translate-y-1">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4" />
                <path d="m6 10 6-6 6 6" />
                <path d="M4 20h16" />
              </svg>
            </span>
          </span>
          <span className="font-serif text-[22px] leading-[28px] text-ink">
            {dragging ? "Drop to start" : "Upload photos & videos"}
          </span>
          <span className="mt-1 text-xs leading-[18px] text-ink-soft">Drag them here, or tap to browse your library</span>
          <span className="mt-4 rounded-full bg-surface-sunken px-3 py-1 text-[11px] font-medium leading-[14px] text-ink-soft">
            JPG · PNG · HEIC · MP4 · MOV
          </span>
        </button>
        {error && (
          <p role="alert" className="mt-3 text-center text-xs text-brand">
            {error}
          </p>
        )}
      </section>

      <section className="relative px-5 pt-9">
        <h2 className="text-xs font-medium text-ink-soft">How it works</h2>
        <ol className="mt-3 flex flex-col gap-2">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3 rounded-2xl bg-surface-muted p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-lg shadow-sm">
                {step.emoji}
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase leading-[14px] tracking-[0.55px] text-ink-faint">
                  Step {i + 1}
                </span>
                <span className="mt-0.5 block font-serif text-[17px] leading-[22px] text-ink">{step.title}</span>
                <span className="mt-0.5 block text-xs leading-[18px] text-ink-soft">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="relative mt-6 flex items-center justify-center gap-1 px-5">
        <img src="/icons/shield.svg" alt="" width={10.667} height={13.333} className="h-[13.333px] w-[10.667px]" />
        <span className="text-xs leading-[18px] text-ink-soft/80">Your memories stay private to your account.</span>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[430px] bg-gradient-to-t from-canvas via-canvas/95 to-transparent px-5 pb-8 pt-6">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-14 w-full items-center justify-center gap-1.5 rounded-full bg-brand text-sm font-medium tracking-[0.35px] text-white shadow-xl"
        >
          <img src="/icons/sparkles.svg" alt="" width={18.333} height={18.333} className="size-[18.333px]" />
          Start with your memories
        </button>
      </div>
    </main>
  );
}
