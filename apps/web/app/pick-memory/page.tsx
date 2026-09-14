"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getStorageClient } from "@/lib/firebase/client";
import { StepProgress } from "@/components/StepProgress";

type Picked = {
  id: string;
  file: File;
  previewUrl: string;
  isVideo: boolean;
  duration?: string;
  selected: boolean;
};

function formatDuration(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Figma: "Pick the Memory - Camera Roll" (1:128)
export default function PickMemoryPage() {
  const [items, setItems] = useState<Picked[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Revoke object URLs only when leaving the screen; they stay in use while selections change.
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.previewUrl)), []);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).map<Picked>((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      previewUrl: URL.createObjectURL(file),
      isVideo: file.type.startsWith("video/"),
      selected: true,
    }));
    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...next.filter((n) => !seen.has(n.id))];
    });
  }

  function setDuration(id: string, seconds: number) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, duration: formatDuration(seconds) } : p)));
  }

  function toggle(id: string) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)));
  }

  const selected = items.filter((i) => i.selected);
  const videoCount = selected.filter((i) => i.isVideo).length;
  const photoCount = selected.length - videoCount;
  const anySelected = selected.length > 0;

  async function handleNext() {
    if (!anySelected) return;
    setUploading(true);
    setError(null);
    try {
      const refs: string[] = [];
      for (const { file } of selected) {
        const storageRef = ref(getStorageClient(), `uploads/${Date.now()}-${file.name}`);
        await uploadBytes(storageRef, file);
        refs.push(await getDownloadURL(storageRef));
      }
      const params = new URLSearchParams({ mediaRefs: JSON.stringify(refs) });
      router.push(`/tell-story?${params.toString()}`);
    } catch (e) {
      console.error("upload failed", e);
      setError("Upload failed. Please try again.");
      setUploading(false);
    }
  }

  return (
    <main className="relative min-h-screen bg-canvas pb-28">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <header className="sticky top-0 z-30 bg-canvas/85 shadow-[0_1px_8px_rgba(54,49,44,0.04)] backdrop-blur-md">
        <div className="flex h-14 items-center justify-between pl-5 pr-4">
          <button type="button" onClick={() => router.back()} className="text-sm font-medium leading-[22px] text-brand">
            Cancel
          </button>
          <h1 className="text-sm font-bold tracking-[-0.35px] text-ink">Camera Roll</h1>
          <button
            type="button"
            disabled={!anySelected}
            onClick={() => setItems((prev) => prev.map((p) => ({ ...p, selected: false })))}
            className="text-xs font-semibold text-brand disabled:opacity-40"
          >
            Deselect
          </button>
        </div>
        <StepProgress value={1 / 3} />
      </header>

      <div className="flex justify-center px-4 pb-2.5 pt-3.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 rounded-full border border-line bg-surface-muted px-[13px] py-[5px]"
        >
          <span className="text-xs font-semibold text-ink">{items.length ? "Your Memories" : "Add Memories"}</span>
          {items.length > 0 && <span className="text-[11px] leading-[14px] text-ink-soft">({items.length})</span>}
          <img src="/icons/chevron-down.svg" alt="" width={8} height={4.933} className="h-[4.933px] w-2" />
        </button>
      </div>

      {items.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mx-4 mt-2 flex h-[260px] w-[calc(100%-2rem)] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-brand-dot bg-surface-muted text-center"
        >
          <span className="text-sm font-semibold text-ink">Pick photos & videos</span>
          <span className="max-w-[240px] text-xs leading-[18px] text-ink-soft">
            Choose the moments from your trip, celebration, or everyday life.
          </span>
        </button>
      ) : (
        <section className="grid grid-cols-3 gap-0.5">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => toggle(item.id)}
              aria-pressed={item.selected}
              className="relative aspect-square overflow-hidden bg-surface-sunken"
            >
              {item.isVideo ? (
                <video
                  src={item.previewUrl}
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(e) => setDuration(item.id, e.currentTarget.duration)}
                  className="size-full object-cover"
                />
              ) : (
                <img src={item.previewUrl} alt={item.file.name} className="size-full object-cover" />
              )}

              {!item.selected && <span className="absolute inset-0 bg-canvas/40" />}

              {item.isVideo && item.duration && (
                <span className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded-2xl bg-[rgba(49,48,45,0.75)] px-1.5 py-0.5 backdrop-blur-[2px]">
                  <img src="/icons/play.svg" alt="" width={4.583} height={5.833} className="h-[5.833px] w-[4.583px]" />
                  <span className="text-[10px] leading-[14px] text-white">{item.duration}</span>
                </span>
              )}

              {item.selected ? (
                <span className="absolute bottom-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-brand shadow-md">
                  <img src="/icons/check.svg" alt="" width={8.95} height={6.825} className="h-[6.825px] w-[8.95px]" />
                </span>
              ) : (
                <span className="absolute bottom-1.5 right-1.5 size-5 rounded-full border-2 border-white/90 bg-black/10" />
              )}
            </button>
          ))}
        </section>
      )}

      <div className="fixed inset-x-0 bottom-8 z-30 mx-auto w-full max-w-[430px] px-5">
        <div className="flex items-center justify-between rounded-full border border-line bg-canvas/90 p-[11px] shadow-xl backdrop-blur-md">
          <div className="min-w-0 flex-1 pl-3 pr-2">
            <p className="truncate text-xs font-semibold text-ink">
              {error ?? (uploading ? "Uploading..." : `${selected.length} selected`)}
            </p>
            <p className="truncate text-xs leading-[18px] text-ink-soft">
              {photoCount} {photoCount === 1 ? "photo" : "photos"}, {videoCount} {videoCount === 1 ? "video" : "videos"}
            </p>
          </div>
          <button
            type="button"
            disabled={!anySelected || uploading}
            onClick={handleNext}
            className="flex items-center gap-1.5 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-md disabled:opacity-50"
          >
            Next
            <img src="/icons/arrow-right.svg" alt="" width={10.667} height={10.667} className="size-[10.667px]" />
          </button>
        </div>
      </div>
    </main>
  );
}
