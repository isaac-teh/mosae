import { describe, expect, it } from "vitest";
import { loadDemoBundle } from "./bundle.js";
import { castSummary } from "../cast/castSummary.js";
import { leaveOutShots } from "../cast/leaveOut.js";
import { daySummary, dayTitles, tripDays } from "../directing/days.js";
import { runPlan, type PlanJob } from "../directing/runPlan.js";
import { createPlanningModel } from "../directing/wire.js";
import { createPlanningTools, type PlanningShot } from "../directing/tools.js";
import { replayingExactGenerate, replayingGenerate, replayingEmbed } from "../gemini/recorder.js";
import { generateStructured, type GenerateOptions } from "../gemini/client.js";
import { runCompose } from "../compose/runCompose.js";
import type { Asset as CandidateAsset } from "../compose/buildCandidates.js";
import { recommendDuration } from "@mosae/contracts";
import type { FaceRef } from "../cast/types.js";

describe("demo chip-only fixture coverage", () => {
  it("plans the trip from exact fixtures with freshly mapped shot ids and no Gemini key", async () => {
    const bundle = loadDemoBundle();
    const sorted = [...bundle.photos].sort((a, b) => a.sourceShotId.localeCompare(b.sourceShotId));
    const shotId = new Map(sorted.map((photo, i) => [photo.sourceShotId, `${String(i).padStart(2, "0")}_FreshDemoAssetIdentifier${i}_0000`]));
    const assetId = new Map(sorted.map((photo, i) => [photo.sourceAssetId, `${String(i).padStart(2, "0")}_FreshDemoAssetIdentifier${i}`]));
    const shots: PlanningShot[] = sorted.map((photo) => ({
      id: shotId.get(photo.sourceShotId)!, projectId: "fresh-demo-project", assetId: assetId.get(photo.sourceAssetId)!,
      assetStatus: "understood", eventId: photo.eventId, dupOf: photo.dupOf ? shotId.get(photo.dupOf) ?? null : null,
      day: photo.media.localTime?.slice(0, 10) ?? null, localTime: photo.media.localTime ?? null,
      place: photo.place?.name ?? null, durationSec: null, sourceStartSec: null, sourceEndSec: null,
      embedding: null, analysis: photo.analysis,
    }));
    const faces: FaceRef[] = shots.flatMap((shot) => shot.analysis?.kind === "photo" ? (shot.analysis.faces ?? []).map((face) => ({ faceId: face.faceId, shotId: shot.id, photoHash: "", bbox: face.bbox, ageBand: face.ageBand, prominence: face.prominence })) : []);
    const identities = new Map(shots.flatMap((shot) => shot.analysis?.kind === "photo" ? (shot.analysis.faces ?? []).filter((face) => face.characterId).map((face) => [face.faceId, face.characterId!] as const) : []));
    const leftOut = leaveOutShots(shots.filter((shot) => shot.analysis?.kind === "photo").map((shot) => ({ shotId: shot.id, faces: (shot.analysis?.kind === "photo" ? shot.analysis.faces ?? [] : []).map((face) => ({ bbox: face.bbox, personId: face.characterId ?? null, stranger: face.stranger ?? false })) })), bundle.cast, []);
    const excluded = leftOut.map((item) => item.shotId);
    const days = tripDays(shots.filter((shot) => !excluded.includes(shot.id)).map((shot) => ({ id: shot.id, day: shot.day ?? null, localTime: shot.localTime, place: shot.place ?? null })));
    const job: PlanJob = {
      id: "fresh-job", projectId: "fresh-demo-project", proposalId: "fresh-proposal", storyIntentId: "fresh-intent", version: 1, parentProposalId: null,
      intent: { text: "Singapore trip", focus: [] },
      constraints: { excludedShotIds: [], deselectedMomentIds: [], mustIncludeMomentIds: [], feedback: [], focusCharacterIds: bundle.cast.focus },
      shots, castSummary: castSummary(bundle.cast, faces, identities) ?? undefined,
      daySummary: daySummary(days), dayTitles: dayTitles(days), leftOut, autoExcludedShotIds: excluded,
    };
    const tools = createPlanningTools({ projectId: job.projectId, excludedShotIds: excluded, embedContent: replayingEmbed(), loadShots: async () => shots, loadAsset: async () => null });
    const result = await runPlan(job, { model: createPlanningModel({ generateContent: replayingExactGenerate(), recordUsage: () => {} }, job.id), tools });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proposal = result.proposal;
    const byShot = new Map(shots.map((shot) => [shot.id, shot]));
    const byAsset = new Map(bundle.photos.map((photo) => [assetId.get(photo.sourceAssetId)!, photo]));
    const assets = new Map<string, CandidateAsset>();
    for (const moment of proposal.moments) {
      const shot = byShot.get(moment.shotId)!;
      const photo = byAsset.get(shot.assetId)!;
      assets.set(moment.id, { kind: "photo", file: photo.fileName, assetId: shot.assetId,
        eventId: photo.eventId, localTime: photo.media.localTime ?? null, dHash: photo.quality?.dHash ?? null,
        dupOf: null, analysis: { caption: photo.analysis.caption }, keyMomentScore: photo.analysis.keyMomentScore });
    }
    const chapterOf = new Map(proposal.chapters.flatMap((chapter, index) => chapter.momentIds.map((id) => [id, index + 1] as const)));
    const composeFaces = proposal.moments.flatMap((moment) => {
      const shot = byShot.get(moment.shotId)!;
      return shot.analysis?.kind === "photo" ? (shot.analysis.faces ?? []).filter((face) => face.prominence !== "background" && face.characterId).map((face) => ({ faceId: face.faceId, shotId: shot.id, photoHash: "", bbox: face.bbox, ageBand: face.ageBand, prominence: face.prominence })) : [];
    });
    const composeIdentities = new Map(composeFaces.map((face) => [face.faceId, identities.get(face.faceId)!] as const));
    const timeOf = new Map(proposal.moments.map((moment) => {
      const shot = byShot.get(moment.shotId)!;
      return [moment.id, { chapter: chapterOf.get(moment.id) ?? proposal.chapters.length + 1, localTime: shot.localTime, score: shot.analysis?.kind === "photo" ? shot.analysis.keyMomentScore : 0 }] as const;
    }));
    const composed = await runCompose({
      proposal, projectId: job.projectId, generationId: "fresh-generation", mode: "memory", aspect: "9:16",
      durationId: recommendDuration(proposal.moments.length), cadenceId: proposal.recommendedCadence ?? "tender",
      seed: "fresh-seed", soundtrackId: null, note: "Singapore trip\nFocus: Whole family.", captions: false,
      collageAmount: "few", motionFeel: "calm", chapterOf, timeOf,
      cast: { summary: castSummary(bundle.cast, composeFaces, composeIdentities)!, core: bundle.cast.core, focus: bundle.cast.focus,
        peopleByMoment: new Map(), subjectsByMoment: new Map(), namesById: {} },
    // Demo planning is exact-key replayed. Composition can vary with the
    // generated proposal, so exercise the existing same-stage replay pool.
    }, { generateStructured: (options) => generateStructured(options as GenerateOptions<unknown>, { generateContent: replayingGenerate(), recordUsage: () => {} }), soundtrackIds: new Set(), assets });
    if (!composed.ok) throw new Error(composed.reasons.join("; "));
  });
});
