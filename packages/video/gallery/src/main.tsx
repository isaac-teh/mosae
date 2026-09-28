import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@remotion/player";
import { ALLOWED_COMBOS, Collage, COLLAGE_EFFECTS, COLLAGE_LAYOUTS, createCollageSpec, PLACEHOLDER_PHOTOS, type CollageSpec } from "@mosae/video/collage";
import "./style.css";

type Verdict = "keep" | "tweak" | "block";
type Review = { verdict: Verdict; note: string };
type ReviewMap = Record<string, Review>;
const KEY = "mosae-collage-review-v1";
declare const __COLLAGE_TRIP_PHOTOS__: string[];
const photos = __COLLAGE_TRIP_PHOTOS__.length ? __COLLAGE_TRIP_PHOTOS__ : PLACEHOLDER_PHOTOS;
const combos = ALLOWED_COMBOS;
const keyOf = (layoutId: string, motionId: string) => `${layoutId}::${motionId}`;

function App() {
  const [effectId, setEffectId] = useState<CollageSpec["effectId"]>(null);
  const [reviews, setReviews] = useState<ReviewMap>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as ReviewMap;
      const allowedKeys = new Set(combos.map(({ layoutId, motionId }) => keyOf(layoutId, motionId)));
      return Object.fromEntries(Object.entries(saved).filter(([id]) => allowedKeys.has(id)));
    } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(reviews)); }, [reviews]);
  const specs = useMemo(() => combos.map(({ layoutId, motionId }) => ({
    ...createCollageSpec(layoutId, { motionId, effectId, seed: `gallery-${layoutId}-${motionId}`, slots: createCollageSpec(layoutId).slots.map((slot, i) => ({ slotId: slot.slotId, src: photos[i % photos.length] })) }),
  })), [effectId]);
  const review = (id: string, verdict: Verdict) => {
    const previous = reviews[id]?.note ?? "";
    const note = verdict === "tweak" ? (window.prompt("What should change?", previous) ?? previous) : previous;
    setReviews((current) => ({ ...current, [id]: { verdict, note } }));
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ combos: combos.map(({ layoutId, motionId }) => ({ layoutId, motionId, verdict: reviews[keyOf(layoutId, motionId)]?.verdict ?? null, note: reviews[keyOf(layoutId, motionId)]?.note ?? "" })) }, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "collage-review.json"; link.click(); URL.revokeObjectURL(link.href);
  };
  return <main>
    <header><div><p className="eyebrow">MOSAE · CREATIVE REVIEW</p><h1>Collage building blocks</h1><p className="intro">Review original collage compositions and motion, staged with stock travel photography.</p></div><button className="export" onClick={exportJson}>Export JSON</button></header>
    <div className="toolbar"><label>Effect <select value={effectId ?? "none"} onChange={(e) => setEffectId(e.target.value === "none" ? null : e.target.value as NonNullable<CollageSpec["effectId"]>)}><option value="none">None</option>{COLLAGE_EFFECTS.map((effect) => <option key={effect.id} value={effect.id}>{effect.label}</option>)}</select></label><span>{combos.length} approved combinations · {Object.keys(reviews).length} reviewed</span></div>
    <section className="gallery">{combos.map(({ layoutId, motionId }, index) => {
      const id = keyOf(layoutId, motionId); const current = reviews[id]; const spec = specs[index]; const label = `${COLLAGE_LAYOUTS.find((layout) => layout.id === layoutId)?.label} · ${motionId}`;
      return <article className={`card ${current?.verdict ?? ""}`} key={id}>
        <div className="preview"><Player component={Collage} inputProps={{ spec }} durationInFrames={90} fps={30} compositionWidth={360} compositionHeight={640} controls loop clickToPlay style={{ width: "100%", height: "100%" }} /></div>
        <div className="card-info"><div><h2>{label}</h2><p>{effectId ? `${effectId} · ` : "No effect · "}{spec.slots.length} slots</p></div><span className={`badge ${current?.verdict ?? "pending"}`}>{current?.verdict ?? "pending"}</span></div>
        {current?.note && <p className="note">{current.note}</p>}
        <div className="actions"><button className={current?.verdict === "keep" ? "selected keep" : ""} onClick={() => review(id, "keep")}>Keep</button><button className={current?.verdict === "tweak" ? "selected tweak" : ""} onClick={() => review(id, "tweak")}>Tweak</button><button className={current?.verdict === "block" ? "selected block" : ""} onClick={() => review(id, "block")}>Block</button></div>
      </article>;
    })}</section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
