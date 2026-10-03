import { Router, type RequestHandler } from "express";
import { loadLibrary, soundtrackCatalog } from "../music/library.js";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import { normalizeDirectionRecommendation, CADENCES, DURATION_SECONDS, recommendDuration, type CadenceId, type DurationId } from "@mosae/contracts";
import { stripProposalEnvelope } from "../store/directingStore.js";
import { holdsFor } from "../compose/brief.js";

const DURATION_LABELS: Record<DurationId, { label: string; caption: string }> = {
  "30s": { label: "30 sec", caption: "A quick share" },
  "1m": { label: "1 min", caption: "Highlights" },
  "2m": { label: "2 min", caption: "The full story" },
  "3m": { label: "3 min", caption: "Extended cut" },
  "4m": { label: "4 min", caption: "A little more room" },
  "5m": { label: "5 min", caption: "Everything" },
};

export function directionOptionsRouter(deps: {
  db: Firestore;
  auth?: RequestHandler;
}): Router {
  const router = Router();
  router.use(deps.auth ?? requireUser());
  const library = loadLibrary();

  for (const name of ["projectId", "proposalId"]) {
    router.param(name, (_req, res, next, value: string) => {
      if (!isValidId(value)) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      next();
    });
  }

  // GET /api/projects/:projectId/proposals/:proposalId/direction-options
  router.get("/:projectId/proposals/:proposalId/direction-options", async (req, res) => {
    const userId = res.locals.userId as string;
    const { projectId, proposalId } = req.params;

    try {
      // Ownership check
      const projectSnap = await deps.db.collection("projects").doc(projectId).get();
      if (!projectSnap.exists || projectSnap.get("userId") !== userId) {
        return res.status(403).json({ error: "forbidden" });
      }

      // Read the proposal
      const proposalSnap = await deps.db
        .collection("projects")
        .doc(projectId)
        .collection("storyProposals")
        .doc(proposalId)
        .get();

      if (!proposalSnap.exists) {
        return res.status(404).json({ error: "not_found" });
      }

      const proposalData = stripProposalEnvelope(proposalSnap.data()) as Record<string, unknown>;

      // Count only moments still in the user's accepted selection.
      const moments = Array.isArray(proposalData.moments) ? proposalData.moments as Array<Record<string, unknown>> : [];
      const constraints = proposalData.constraints && typeof proposalData.constraints === "object" ? proposalData.constraints as Record<string, unknown> : {};
      const ids = (key: string) => new Set(Array.isArray(constraints[key]) ? (constraints[key] as unknown[]).filter((id): id is string => typeof id === "string") : []);
      const deselected = ids("deselectedMomentIds");
      const excluded = ids("excludedShotIds");
      const hidden = ids("hiddenShotIds");
      const keptMoments = moments.filter((moment) => typeof moment.id === "string" && typeof moment.shotId === "string" && !deselected.has(moment.id) && !excluded.has(moment.shotId) && !hidden.has(moment.shotId));
      const photoCount = keptMoments.filter((m) => m.kind === "photo").length;
      const videos = keptMoments.filter((m) => m.kind === "video");
      const videoSeconds = videos.reduce((sum, moment) => {
        const start = typeof moment.previewInSec === "number" ? moment.previewInSec : 0;
        const end = typeof moment.previewOutSec === "number" ? moment.previewOutSec : start;
        return sum + Math.max(0, end - start);
      }, 0);
      const recommendedDuration: DurationId = recommendDuration(photoCount);
      // Estimate capacity for each selectable pace. These values use the same
      // maximum holds that composition uses, so a long option is only offered
      // when the proposal has enough selected material for that cadence.
      const maximumDurationSecByCadence = Object.fromEntries(CADENCES.map(({ id }) => {
        const maximumHold = holdsFor(id).max;
        return [id, photoCount * maximumHold + Math.min(videoSeconds, videos.length * maximumHold * 2)];
      }));
      const maximumDurationSec = Math.max(...Object.values(maximumDurationSecByCadence));

      // Read the story intent for the note text
      const storyIntentId = typeof proposalData.storyIntentId === "string" ? proposalData.storyIntentId : null;
      let note = "";
      if (storyIntentId) {
        const intentSnap = await deps.db
          .collection("projects")
          .doc(projectId)
          .collection("storyIntents")
          .doc(storyIntentId)
          .get();
        if (intentSnap.exists) {
          const intentText = intentSnap.get("text");
          note = typeof intentText === "string" ? intentText : "";
        }
      }

      const recommendedCadence: CadenceId =
        typeof proposalData.recommendedCadence === "string"
          ? proposalData.recommendedCadence as CadenceId
          : "reflective";

      const cadenceReason: string | null =
        typeof proposalData.cadenceReason === "string" ? proposalData.cadenceReason : null;

      // Build duration list from DURATION_SECONDS
      const durations = (Object.entries(DURATION_SECONDS) as [DurationId, number][]).map(([id, seconds]) => ({
        id,
        label: DURATION_LABELS[id].label,
        caption: DURATION_LABELS[id].caption,
        seconds,
      }));

      const recommendation = normalizeDirectionRecommendation(proposalData.directionRecommendation);
      return res.json({
        note,
        ...(recommendation !== undefined ? { recommendation } : {}),
        rewrites: [],
        cadences: CADENCES.map(({ id, name, description }) => ({ id, name, description })),
        soundtracks: soundtrackCatalog(library, recommendedCadence),
        durations,
        maximumDurationSec,
        maximumDurationSecByCadence,
        recommendedDuration,
        recommendedCadence,
        cadenceReason,
        collageAmount: "few",
        motionFeel: "calm",
      });
    } catch (error) {
      console.error("direction-options route failed", error);
      return res.status(500).json({ error: "internal" });
    }
  });

  return router;
}
