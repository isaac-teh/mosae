import type { Firestore } from "firebase-admin/firestore";
import { applyEdits, type EditOp, type Timeline } from "@mosae/contracts";
import { bestWindow, type ScoredShot } from "../compose/videoWindow.js";
import { lateVideoDecision } from "../compose/lateJoin.js";

type LateEvent = { assetId: string; shotId: string; label: string; status: "added" | "offered" | "dismissed"; sourceInSec: number; sourceOutSec: number; afterClipId: string | null; previousOps?: EditOp[] };
const clipIdOf = (clip: Timeline["videoClips"][number]) => "kind" in clip ? clip.clipId : clip.id;

/** Called by the understanding worker after a video changes to understood. */
export async function joinReadyVideo(db: Firestore, projectId: string, assetId: string): Promise<"added" | "offered" | "skipped"> {
  const project = db.collection("projects").doc(projectId);
  const assetRef = project.collection("assets").doc(assetId);
  const [projectSnap, assetSnap] = await Promise.all([project.get(), assetRef.get()]);
  if (!projectSnap.exists || !assetSnap.exists || (assetSnap.get("media") as { kind?: string } | undefined)?.kind !== "video") return "skipped";
  const shotsSnap = await project.collection("shots").where("assetId", "==", assetId).orderBy("index").get();
  const assetMedia = assetSnap.get("media") as { durationSec?: number; localTime?: string | null } | undefined;
  const assetPlace = assetSnap.get("place") as { name?: string | null } | undefined;
  const fileLabel = String(assetSnap.get("fileName") ?? "video").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const label = assetPlace?.name?.trim() || fileLabel || "video";
  let best: { shotId: string; inSec: number; outSec: number; score: number } | null = null;
  for (const shotDoc of shotsSnap.docs) {
    const data = shotDoc.data();
    const analysis = data.analysis as { kind?: string; highlights?: ScoredShot["highlights"] } | undefined;
    if (analysis?.kind !== "video") continue;
    const startSec = Number(data.sourceStartSec ?? 0);
    const endSec = Number(data.sourceEndSec ?? assetMedia?.durationSec ?? 0);
    const scored: ScoredShot = { startSec, endSec, highlights: analysis.highlights, signals: data.signals };
    const window = bestWindow(scored, Math.min(4, Math.max(2, endSec - startSec)));
    const candidate = window ?? { inSec: startSec, outSec: endSec, score: 0 };
    if (candidate.outSec - candidate.inSec < 0.5) continue;
    if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.inSec < best.inSec)) best = { shotId: shotDoc.id, ...candidate };
  }
  if (!best) return "skipped";

  const generationId = projectSnap.get("currentPlayableGenerationId");
  if (typeof generationId !== "string") return "skipped";
  const genRef = project.collection("generations").doc(generationId);
  const editsRef = genRef.collection("edits").doc("current");
  const eventRef = genRef.collection("lateVideoEvents").doc(assetId);
  const shotDates = new Map<string, number>();
  if (assetMedia?.localTime) shotDates.set(best.shotId, Date.parse(assetMedia.localTime) || 0);
  const allShots = await project.collection("shots").get();
  const assetIds = [...new Set(allShots.docs.map((shot) => shot.get("assetId")).filter((id): id is string => typeof id === "string"))];
  const assetSnapshots = await Promise.all(assetIds.map((id) => project.collection("assets").doc(id).get()));
  const timeByAsset = new Map(assetSnapshots.map((snap) => [snap.id, Date.parse((snap.get("media") as { localTime?: string | null } | undefined)?.localTime ?? "") || 0]));
  const assetByShot = new Map(allShots.docs.map((shot) => [shot.id, shot.get("assetId") as string]));
  for (const [shotId, id] of assetByShot) shotDates.set(shotId, timeByAsset.get(id) ?? 0);

  return db.runTransaction(async (tx) => {
    const [generationSnap, editsSnap, eventSnap] = await Promise.all([tx.get(genRef), tx.get(editsRef), tx.get(eventRef)]);
    if (!generationSnap.exists || eventSnap.exists) return "skipped";
    const generation = generationSnap.data()!;
    const timeline = generation.timeline as Timeline | null;
    if (!timeline) return "skipped";
    const currentOps = (editsSnap.get("ops") ?? []) as EditOp[];
    const currentRevision = Number(editsSnap.get("revision") ?? 0);
    const alreadyInTimeline = timeline.videoClips.some((clip) => "source" in clip && clip.source.shotId === best!.shotId)
      || currentOps.some((op) => "shotId" in op && op.shotId === best!.shotId);
    const decision = lateVideoDecision({ status: generation.status, composedRevision: Number(generation.composedEditRevision ?? 0), currentRevision, lastAutoRevision: Number(generation.lateVideoRevision ?? -1), hasShot: true, alreadyJoined: alreadyInTimeline });
    const nearest = timeline.videoClips.map((clip, index) => ({ clip, index, time: "source" in clip ? (shotDates.get(clip.source.shotId) ?? 0) : 0 }));
    const timestamp = shotDates.get(best!.shotId) ?? 0;
    const insertAt = nearest.findIndex(({ time }) => time > timestamp);
    const afterClipId = insertAt === 0 || nearest.length === 0 ? null : clipIdOf(nearest[(insertAt < 0 ? nearest.length : insertAt) - 1]!.clip);
    const event: LateEvent = { assetId, shotId: best!.shotId, label, status: decision === "insert" ? "added" : "offered", sourceInSec: best!.inSec, sourceOutSec: best!.outSec, afterClipId };
    if (decision === "skip") return "skipped";
    if (decision === "insert") {
      const op: EditOp = { op: "add", shotId: best!.shotId, kind: "video", afterClipId, durationSec: best!.outSec - best!.inSec, sourceInSec: best!.inSec, sourceOutSec: best!.outSec, ...(assetMedia?.durationSec ? { sourceDurationSec: assetMedia.durationSec } : {}) };
      const ops = [...currentOps, op];
      const applied = applyEdits(timeline, ops);
      if (!applied.ok) return "skipped";
      const revision = currentRevision + 1;
      event.previousOps = currentOps;
      tx.set(editsRef, { revision, ops, updatedAt: Date.now() });
      tx.set(editsRef.collection("revisions").doc(String(revision)), { revision, ops, updatedAt: Date.now() });
      tx.set(genRef, { lateVideoEvents: [...((generation.lateVideoEvents ?? []) as LateEvent[]), event], lateVideoRevision: revision }, { merge: true });
      tx.create(eventRef, event);
      return "added";
    }
    tx.set(genRef, { lateVideoEvents: [...((generation.lateVideoEvents ?? []) as LateEvent[]), event] }, { merge: true });
    tx.create(eventRef, event);
    return "offered";
  });
}

export async function dismissLateVideo(db: Firestore, userId: string, projectId: string, generationId: string, assetId: string): Promise<boolean> {
  const project = db.collection("projects").doc(projectId);
  const generation = project.collection("generations").doc(generationId);
  const eventRef = generation.collection("lateVideoEvents").doc(assetId);
  return db.runTransaction(async (tx) => {
    const [owner, gen, event] = await Promise.all([tx.get(project), tx.get(generation), tx.get(eventRef)]);
    if (!owner.exists || owner.get("userId") !== userId || !gen.exists || !event.exists) return false;
    const events = (gen.get("lateVideoEvents") ?? []) as LateEvent[];
    const updated = events.map((item) => item.assetId === assetId ? { ...item, status: "dismissed" as const } : item);
    tx.update(generation, { lateVideoEvents: updated });
    tx.update(eventRef, { status: "dismissed" });
    return true;
  });
}
