import { Router, type RequestHandler } from "express";
import { buildAlbumProfile, loadLibrary, recommendSoundtrack, soundtrackCatalog } from "../music/library.js";
import type { Firestore } from "firebase-admin/firestore";
import { requireUser } from "../auth/requireUser.js";
import { isValidId } from "../domain/ids.js";
import { normalizeDirectionRecommendation, CADENCES, DURATION_SECONDS, type CadenceId, type DurationId } from "@mosae/contracts";
import { stripProposalEnvelope } from "../store/directingStore.js";
import { DIRECTING_RULES, leftOutLengthHint, photoBaseDuration, requestedCollageCount } from "../compose/directingRules.js";
import { styleRecipeForCadence } from "../compose/styleRecipe.js";

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

      const userSnap = await deps.db.collection("users").doc(userId).get();
      const recentTrackIds = Array.isArray(userSnap.get("recentSoundtrackIds"))
        ? (userSnap.get("recentSoundtrackIds") as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
      const currentGenerationId = projectSnap.get("currentPlayableGenerationId");
      let currentProjectTrackId: string | null = null;
      if (typeof currentGenerationId === "string") {
        const currentGeneration = await deps.db.collection("projects").doc(projectId).collection("generations").doc(currentGenerationId).get();
        if (typeof currentGeneration.get === "function") {
          const settings = currentGeneration.get("settings") as Record<string, unknown> | undefined;
          currentProjectTrackId = typeof settings?.soundtrackId === "string" ? settings.soundtrackId : null;
        }
      }

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
      const videoClipCapacities = videos.map((moment) => {
        const start = typeof moment.previewInSec === "number" ? moment.previewInSec : 0;
        const end = typeof moment.previewOutSec === "number" ? moment.previewOutSec : start;
        const sourceLength = Math.max(0, end - start);
        const clips = sourceLength >= 30 ? 3 : sourceLength >= 12 ? 2 : 1;
        return { clips, sourceLength };
      });
      // Capacity uses the same v2 collage bands and per-clip limits as compose.
      // A single photo caps at four seconds; collage holds use their photo-count base.
      const collageCount = requestedCollageCount(keptMoments.length, "few");
      const photosPerCollage = keptMoments.length < 20 ? 4 : keptMoments.length < 50 ? 4 : DIRECTING_RULES.collageMaxPhotos;
      const collagePhotos = Math.min(photoCount, collageCount * photosPerCollage);
      const maximumDurationSecByCadence = Object.fromEntries(CADENCES.map(({ id }) => {
        const videoMax = DIRECTING_RULES.videoLength[id][1];
        const videoSeconds = videoClipCapacities.reduce((sum, video) => sum + video.clips * Math.min(video.sourceLength, videoMax), 0);
        const singleMax = Math.min(DIRECTING_RULES.singlePhotoMaxSec, photoBaseDuration(1, id) * DIRECTING_RULES.tierlessPhotoStretchMultiplier);
        const collageGroups = collagePhotos > 0 ? Math.min(collageCount, Math.ceil(photoCount / photosPerCollage)) : 0;
        const collageMax = collageGroups > 0
          ? collageGroups * photoBaseDuration(Math.min(photosPerCollage, Math.ceil(collagePhotos / collageGroups)), id) * DIRECTING_RULES.tierlessPhotoStretchMultiplier
          : 0;
        const photoCapacity = Math.max(0, photoCount - collagePhotos) * singleMax + collageMax;
        // The 50% video-share rule caps extra capacity, while a one-clip-per-
        // source coverage floor may exceed it at compose time.
        const capacity = Math.max(videoSeconds, photoCapacity + Math.min(videoSeconds, photoCapacity));
        return [id, Math.floor(capacity)];
      })) as Record<CadenceId, number>;
      const maximumDurationSec = Math.max(...Object.values(maximumDurationSecByCadence));
      const recommendedCadence: CadenceId =
        typeof proposalData.recommendedCadence === "string"
          ? proposalData.recommendedCadence as CadenceId
          : "reflective";
      const storyIntentId = typeof proposalData.storyIntentId === "string" ? proposalData.storyIntentId : null;
      const intentText = storyIntentId
        ? await deps.db.collection("projects").doc(projectId).collection("storyIntents").doc(storyIntentId).get().then((snap) => snap.get("text"))
        : "";
      const intent = typeof intentText === "string" ? intentText : "";
      const momentEnergy = moments.flatMap((moment) => {
        const energy = typeof moment.energy === "number" ? moment.energy : typeof moment.highlightScore === "number" ? moment.highlightScore : null;
        if (energy !== null) return [Math.max(0, Math.min(1, energy))];
        const activityText = [moment.mood, ...(Array.isArray(moment.activities) ? moment.activities : [])].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
        if (/dance|run|jump|play|splash|race|cheer|laugh|celebrat|energetic|excited/.test(activityText)) return [0.8];
        if (/calm|peace|gentle|quiet|sleep|rest/.test(activityText)) return [0.25];
        return [];
      });
      const targetEnergy = momentEnergy.length
        ? momentEnergy.reduce((sum, value) => sum + value, 0) / momentEnergy.length
        : undefined;
      const albumProfile = buildAlbumProfile({
        cadence: recommendedCadence,
        intent,
        occasion: [proposalData.title, proposalData.occasion].filter((value): value is string => typeof value === "string").join(" "),
        evidence: moments.map((moment) => ({
          ...(typeof moment.mood === "string" ? { mood: moment.mood } : {}),
          ...(typeof moment.emotion === "string" ? { emotion: moment.emotion } : {}),
          ...(typeof moment.storyRole === "string" ? { storyRole: moment.storyRole } : {}),
          ...(typeof moment.setting === "string" || typeof moment.place === "string" ? { place: String(moment.setting ?? moment.place) } : {}),
          ...(Array.isArray(moment.activities) ? { activities: moment.activities.filter((value): value is string => typeof value === "string") } : {}),
          ...(typeof moment.energy === "number" ? { energy: moment.energy } : {}),
          ...(typeof moment.highlightScore === "number" ? { highlightScore: moment.highlightScore } : {}),
          context: [moment.title, moment.description].filter((value): value is string => typeof value === "string").join(" "),
        })),
      });
      const recommendedCapacity = maximumDurationSecByCadence[recommendedCadence];
      const shortSeconds = Math.min(DIRECTING_RULES.minimumFilmSec, recommendedCapacity);
      const recommendedDuration: DurationId | "short" =
        (Object.entries(DURATION_SECONDS) as [DurationId, number][])
          .sort((a, b) => a[1] - b[1])
          .find(([, seconds]) => seconds <= recommendedCapacity)?.[0] ?? "short";
      const suggestedTrackId = recommendSoundtrack(library, {
        projectId, intent, cadence: recommendedCadence,
        targetDurationSec: recommendedDuration === "short" ? shortSeconds : DURATION_SECONDS[recommendedDuration],
        recentTrackIds: recentTrackIds.filter((id) => id !== currentProjectTrackId),
        currentProjectTrackId, targetEnergy: targetEnergy ?? albumProfile.energy, profile: albumProfile,
        musicMood: styleRecipeForCadence(recommendedCadence).musicMood,
      });

      // Read the story intent for the note text
      const note = intent;

      const cadenceReason: string | null =
        typeof proposalData.cadenceReason === "string" ? proposalData.cadenceReason : null;

      // Build duration list from DURATION_SECONDS
      const durations: { id: DurationId | "short"; label: string; caption: string; seconds: number }[] = (Object.entries(DURATION_SECONDS) as [DurationId, number][])
        .filter(([, seconds]) => seconds <= maximumDurationSec)
        .map(([id, seconds]) => ({ id, label: DURATION_LABELS[id].label, caption: DURATION_LABELS[id].caption, seconds }));
      durations.push({ id: "short", label: "Short", caption: `About ${shortSeconds} seconds`, seconds: shortSeconds });
      const orderedDurations = [...durations].sort((a, b) => a.seconds - b.seconds);
      const videoBudgetSec = videoClipCapacities.reduce((sum, video) => sum + Math.min(video.sourceLength, DIRECTING_RULES.videoMinClipSec), 0);
      const lengthHints = orderedDurations.flatMap((duration) => {
        const next = orderedDurations.find((choice) => choice.seconds > duration.seconds);
        const hint = leftOutLengthHint({
          durationSec: duration.seconds,
          nextDurationSec: next?.seconds,
          goodMomentCount: keptMoments.length,
          photoCount,
          videoSec: videoBudgetSec,
          lockedPhotoCount: Math.min(3, photoCount),
        });
        return hint ? [hint] : [];
      });

      const recommendation = normalizeDirectionRecommendation(proposalData.directionRecommendation);
      return res.json({
        note,
        ...(recommendation !== undefined ? { recommendation } : {}),
        rewrites: [],
        cadences: CADENCES.map(({ id, name, description }) => ({ id, name, description })),
        soundtracks: soundtrackCatalog(library, recommendedCadence, recommendedDuration === "short" ? shortSeconds : DURATION_SECONDS[recommendedDuration], suggestedTrackId),
        durations,
        lengthHints,
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
