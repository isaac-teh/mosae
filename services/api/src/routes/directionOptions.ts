import { Router, type RequestHandler } from "express";
import { loadLibrary, soundtrackCatalog } from "../music/library.js";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import { normalizeDirectionRecommendation, CADENCES, DURATION_SECONDS, type CadenceId, type DurationId } from "@mosae/contracts";
import { stripProposalEnvelope } from "../store/directingStore.js";
import { DIRECTING_RULES, photoBaseDuration, requestedCollageCount } from "../compose/directingRules.js";

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
        const sourceLength = Math.max(0, end - start);
        const clips = sourceLength >= 30 ? 3 : sourceLength >= 12 ? 2 : 1;
        return sum + clips * Math.min(sourceLength, 6);
      }, 0);
      // Capacity uses the same v2 collage bands and per-clip limits as compose.
      // A single photo caps at four seconds; collage holds use their photo-count base.
      const collageCount = requestedCollageCount(keptMoments.length, "few");
      const photosPerCollage = keptMoments.length < 20 ? 4 : keptMoments.length < 50 ? 4 : DIRECTING_RULES.collageMaxPhotos;
      const collagePhotos = Math.min(photoCount, collageCount * photosPerCollage);
      const maximumDurationSecByCadence = Object.fromEntries(CADENCES.map(({ id }) => {
        const singleMax = Math.min(DIRECTING_RULES.singlePhotoMaxSec, photoBaseDuration(1, id) * DIRECTING_RULES.tierlessPhotoStretchMultiplier);
        const collageGroups = collagePhotos > 0 ? Math.min(collageCount, Math.ceil(photoCount / photosPerCollage)) : 0;
        const collageMax = collageGroups > 0
          ? collageGroups * photoBaseDuration(Math.min(photosPerCollage, Math.ceil(collagePhotos / collageGroups)), id) * DIRECTING_RULES.tierlessPhotoStretchMultiplier
          : 0;
        const photoCapacity = Math.max(0, photoCount - collagePhotos) * singleMax + collageMax;
        // The 50% video-share rule means video can add at most as many seconds
        // as the stills support, even when more footage is available.
        const capacity = photoCapacity + Math.min(videoSeconds, photoCapacity);
        return [id, Math.floor(capacity)];
      })) as Record<CadenceId, number>;
      const maximumDurationSec = Math.max(...Object.values(maximumDurationSecByCadence));
      const recommendedCadence: CadenceId =
        typeof proposalData.recommendedCadence === "string"
          ? proposalData.recommendedCadence as CadenceId
          : "reflective";
      const recommendedCapacity = maximumDurationSecByCadence[recommendedCadence];
      const shortSeconds = Math.min(DIRECTING_RULES.minimumFilmSec, recommendedCapacity);
      const recommendedDuration: DurationId | "short" =
        (Object.entries(DURATION_SECONDS) as [DurationId, number][])
          .sort((a, b) => a[1] - b[1])
          .find(([, seconds]) => seconds <= recommendedCapacity)?.[0] ?? "short";

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

      const cadenceReason: string | null =
        typeof proposalData.cadenceReason === "string" ? proposalData.cadenceReason : null;

      // Build duration list from DURATION_SECONDS
      const durations: { id: DurationId | "short"; label: string; caption: string; seconds: number }[] = (Object.entries(DURATION_SECONDS) as [DurationId, number][])
        .filter(([, seconds]) => seconds <= maximumDurationSec)
        .map(([id, seconds]) => ({ id, label: DURATION_LABELS[id].label, caption: DURATION_LABELS[id].caption, seconds }));
      durations.push({ id: "short", label: "Short", caption: `About ${shortSeconds} seconds`, seconds: shortSeconds });

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
