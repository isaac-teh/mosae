import type { Firestore } from "firebase-admin/firestore";
import { safeParseStoryProposal, safeParseDirectionSettings, type Generation, type StoryProposal, type DurationId } from "@mosae/contracts";
import type { Asset } from "../store/finalizeStore.js";
import type { ShotAnalysis } from "../domain/understanding.js";
import { generateStructured, type GenerateOptions } from "../gemini/client.js";
import { createProjectGeminiClient, geminiConfigured, recordUsageToLog } from "../gemini/wire.js";
import { publishGeneration, failGeneration } from "../store/generationStore.js";
import { enqueueRender } from "../store/enqueueRender.js";
import { stripProposalEnvelope } from "../store/directingStore.js";
import { runCompose, type ComposeDeps, type ComposeJob } from "./runCompose.js";
import type { Asset as CandidateAsset } from "./buildCandidates.js";
import type { Face } from "../domain/understanding.js";
import { castSummary } from "../cast/castSummary.js";
import { photoRoles } from "../cast/prominence.js";
import type { Cast, FaceRef } from "../cast/types.js";
import type { ClipTime } from "./chronology.js";

export type ComposeTask = {
  projectId: string;
  generationId: string;
  /** Set when retries are exhausted: settle the generation as failed, do not compose. */
  giveUp?: string;
};
export type ComposeTaskResult = "composed" | "failed" | "skipped";

export type ComposeConfig = {
  db: Firestore;
  geminiApiKey?: string;
  /** Test seam: a recorded model response in place of the SDK. */
  generateStructured?: ComposeDeps["generateStructured"];
  soundtrackIds?: Set<string>;
  /**
   * Called once the render task is written. Production's dispatcher polls the
   * outbox; the local dev runner only drains on events, so it hooks in here or
   * the render task sits undelivered and the film stays "rendering" forever.
   */
  afterRenderEnqueued?: () => void;
};

/**
 * The catalog composition needs, keyed the way `buildCandidates` reads it: by
 * moment id, because that is what the proposal's chapters name. Each moment
 * contributes exactly its own shot, so a video moment never offers candidates
 * from a neighbouring shot in the same asset.
 */
export async function loadComposeCatalog(
  db: Firestore,
  projectId: string,
  proposal: StoryProposal,
): Promise<Map<string, CandidateAsset>> {
  const project = db.collection("projects").doc(projectId);
  const [shotSnaps, assetSnaps] = await Promise.all([
    project.collection("shots").get(),
    project.collection("assets").get(),
  ]);
  const assets = new Map(assetSnaps.docs.map((doc) => [doc.id, doc.data() as Asset]));
  const shots = new Map(shotSnaps.docs.map((doc) => [doc.id, doc]));

  const deselected = new Set(proposal.constraints.deselectedMomentIds);
  const hidden = new Set(proposal.constraints.hiddenShotIds ?? []);
  const catalog = new Map<string, CandidateAsset>();

  for (const moment of proposal.moments) {
    // A film may not contain media the user deselected, so it is never offered.
    if (deselected.has(moment.id)) continue;

    if (hidden.has(moment.shotId)) continue;
    const swapped = proposal.constraints.photoSwaps?.[moment.id];
    const shotId = swapped && !hidden.has(swapped) && shots.has(swapped) ? swapped : moment.shotId;
    const shot = shots.get(shotId);
    if (!shot) continue;
    const asset = assets.get(shot.get("assetId") as string);
    // Analysis from a superseded asset generation is not eligible, exactly as
    // planning treats it.
    if (!asset || asset.generation !== shot.get("assetGeneration")) continue;

    const analysis = shot.get("analysis") as ShotAnalysis | null | undefined;

    if (moment.kind === "photo") {
      catalog.set(moment.id, {
        kind: "photo",
        file: asset.fileName,
        assetId: shot.get("assetId") as string,
        eventId: asset.eventId ?? null,
        localTime: asset.media?.localTime ?? null,
        dHash: asset.quality?.dHash ?? null,
        dupOf: asset.dupOf ?? null,
        ...(analysis?.kind === "photo"
          ? { analysis: { caption: analysis.caption }, keyMomentScore: analysis.keyMomentScore }
          : {}),
      });
      continue;
    }

    const startSec = (shot.get("sourceStartSec") as number | null) ?? 0;
    const endSec = shot.get("sourceEndSec") as number | null;
    if (endSec == null || endSec <= startSec) continue;

    catalog.set(moment.id, {
      kind: "video",
      file: asset.fileName,
      assetId: shot.get("assetId") as string,
      eventId: asset.eventId ?? null,
      localTime: asset.media?.localTime ?? null,
      dHash: asset.quality?.dHash ?? null,
      dupOf: asset.dupOf ?? null,
      analysis: {
        shots: [{
          startSec,
          endSec,
          description: analysis?.kind === "video" ? analysis.description : "",
          role: analysis?.kind === "video" ? analysis.role : undefined,
          quality: analysis?.kind === "video" ? analysis.quality : undefined,
          usable: analysis?.kind === "video" ? analysis.usable : true,
        }],
        transcript: (asset.transcript ?? []).filter((line) => line.endSec > startSec && line.startSec < endSec),
      },
    });
  }

  return catalog;
}

/**
 * Run one compose job: load the accepted proposal and the catalog it names,
 * compose, and either publish the film or fail the generation with its reasons.
 *
 * The Gemini SDK is constructed only when work actually begins, so a missing
 * `GEMINI_API_KEY` can fail a compose task but can never prevent API boot —
 * the same arrangement planning uses.
 */
/**
 * Build the person-anchored Ken Burns hint for a proposal.
 *
 * For each moment that names a focus person — one whose shot's stored analysis
 * carries a face whose `characterId` is in the proposal's `focusCharacterIds` —
 * resolve that face's bbox center in normalized 0–1 coordinates and key it by
 * moment id. Only photo analyses carry faces, so video moments never qualify.
 * A focus id that matches no face in a shot contributes nothing for that moment;
 * the whole map is empty when there are no focus ids or no matching faces, which
 * keeps a null-focus film byte-identical to the pre-focus output.
 */
async function buildFocusCenterMap(
  db: Firestore,
  projectId: string,
  proposal: StoryProposal,
): Promise<Map<string, { cx: number; cy: number }>> {
  const focusIds = new Set(proposal.constraints.focusCharacterIds ?? []);
  if (focusIds.size === 0) return new Map();

  const project = db.collection("projects").doc(projectId);
  const shotSnaps = await project.collection("shots").get();
  const shots = new Map(shotSnaps.docs.map((doc) => [doc.id, doc.data() as ShotAnalysis]));

  const map = new Map<string, { cx: number; cy: number }>();
  for (const moment of proposal.moments) {
    if (map.has(moment.id)) continue;
    const analysis = shots.get(moment.shotId);
    if (!analysis || analysis.kind !== "photo" || !analysis.faces) continue;

    // Prefer the highest-confidence focus face so a crowded frame anchors on the
    // clearest one, but any matching face is enough to drive motion.
    const matches = analysis.faces.filter((face) => face.characterId && focusIds.has(face.characterId));
    if (matches.length === 0) continue;

    const face = matches.reduce((best, next) => (next.confidence > best.confidence ? next : best));
    const [ymin, xmin, ymax, xmax] = face.bbox;
    map.set(moment.id, { cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2 });
  }

  return map;
}

export function createCompose(config: ComposeConfig): (task: ComposeTask) => Promise<ComposeTaskResult> {
  const { db } = config;

  return async (task) => {
    const project = db.collection("projects").doc(task.projectId);
    const genRef = project.collection("generations").doc(task.generationId);
    const genSnap = await genRef.get();
    if (!genSnap.exists) return "skipped";

    const generation = genSnap.data() as Generation;
    // Anything other than `composing` has already been settled by another
    // attempt; a retry must not overwrite it.
    if (generation.status !== "composing") return "skipped";

    const projectSnap = await project.get();
    const userId = (projectSnap.get("userId") as string | undefined) ?? "";

    const fail = async (reasons: string[]): Promise<ComposeTaskResult> => {
      await failGeneration(db, { userId, projectId: task.projectId, generationId: task.generationId, reasons });
      return "failed";
    };

    if (task.giveUp) return fail([task.giveUp]);

    const settings = safeParseDirectionSettings(generation.settings);
    if (!settings.ok) return fail([`invalid direction settings: ${settings.errors.join("; ")}`]);

    const proposalSnap = await project.collection("storyProposals").doc(generation.proposalId).get();
    if (!proposalSnap.exists) return fail([`proposal ${generation.proposalId} not found`]);

    const proposal = safeParseStoryProposal(stripProposalEnvelope(proposalSnap.data()));
    if (!proposal.ok) return fail([`invalid proposal: ${proposal.errors.join("; ")}`]);
    if (proposal.proposal.state !== "accepted") {
      return fail([`proposal ${generation.proposalId} is not accepted`]);
    }

    const catalog = await loadComposeCatalog(db, task.projectId, proposal.proposal);

    // Person-anchored Ken Burns hint: for each moment that names a focus person
    // (a stored face whose characterId is in the proposal's focusCharacterIds),
    // resolve that face's bbox center. Keyed by moment id so runCompose can look
    // it up per photo clip. A moment with no focus face contributes nothing and
    // falls back to plain geometry; a project with no focus ids produces an
    // empty map, which keeps the film byte-identical to the pre-focus output.
    const focusCenter = await buildFocusCenterMap(db, task.projectId, proposal.proposal);

    const castSnap = await project.collection("cast").doc("current").get();
    const stored = castSnap.exists ? castSnap.data() as Cast : null;
    // Existing v1 Firestore casts predate subjectCount.
    const storedCast = stored ? {
      ...stored,
      people: stored.people.map((person) => ({ ...person, subjectCount: person.subjectCount ?? 0 })),
    } : null;
    const peopleByMoment = new Map<string, Set<string>>();
    const subjectsByMoment = new Map<string, Set<string>>();
    const chapterOf = new Map<string, number>();
    const chapterCount = proposal.proposal.chapters.length;
    proposal.proposal.chapters.forEach((chapter, index) => chapter.momentIds.forEach((id) => chapterOf.set(id, index + 1)));
    const timeOf = new Map<string, ClipTime>();
    const assetById = new Map((await project.collection("assets").get()).docs.map((doc) => [doc.id, doc.data() as Asset]));
    const castFaces: FaceRef[] = [];
    const shotSnaps = await project.collection("shots").get();
    const shotById = new Map(shotSnaps.docs.map((doc) => [doc.id, doc.data()]));
    for (const moment of proposal.proposal.moments) {
      const shotDoc = shotSnaps.docs.find((doc) => doc.id === moment.shotId);
      const asset = shotDoc ? assetById.get(shotDoc.get("assetId") as string) : undefined;
      timeOf.set(moment.id, {
        chapter: chapterOf.get(moment.id) ?? chapterCount + 1,
        localTime: asset?.media?.localTime ?? null,
        score: asset && (shotDoc?.get("analysis") as ShotAnalysis | undefined)?.kind === "photo"
          ? ((shotDoc?.get("analysis") as Extract<ShotAnalysis, { kind: "photo" }>).keyMomentScore ?? 0) : 0,
      });
      const analysis = shotById.get(moment.shotId)?.analysis as ShotAnalysis | undefined;
      if (analysis?.kind !== "photo") continue;
      const people = new Set<string>();
      const subjects = new Set<string>();
      const faces = analysis.faces ?? [];
      const roles = photoRoles(faces.map((face) => face.bbox));
      const excluded = new Set((storedCast?.people ?? []).filter((person) => person.excluded).map((person) => person.personId));
      for (const [index, face] of faces.entries()) {
        if (!face.characterId || excluded.has(face.characterId)) continue;
        if (roles[index] === "subject") subjects.add(face.characterId);
        // Preserve v1 coverage semantics: peopleByMoment continues to ignore
        // faces Gemini labeled background, independently of bbox-based subjects.
        if (face.prominence === "background") continue;
        people.add(face.characterId);
        castFaces.push({ faceId: face.faceId, shotId: moment.shotId, photoHash: "", bbox: face.bbox, ageBand: face.ageBand, prominence: face.prominence });
      }
      peopleByMoment.set(moment.id, people);
      subjectsByMoment.set(moment.id, subjects);
    }
    const identities = new Map(castFaces.flatMap((face) => {
      const analysis = shotById.get(face.shotId)?.analysis as ShotAnalysis | undefined;
      const found = analysis?.kind === "photo" ? analysis.faces?.find((item) => item.faceId === face.faceId)?.characterId : undefined;
      return found ? [[face.faceId, found] as const] : [];
    }));
    const summary = storedCast ? castSummary(storedCast, castFaces, identities) : null;

    // Constructed here, not at module load, and only when a key exists.
    const call: ComposeDeps["generateStructured"] = config.generateStructured
      ?? (projectSnap.get("demo") === "trip1-v2" || geminiConfigured(config.geminiApiKey)
        ? (options) => generateStructured(options as GenerateOptions<unknown>, {
            generateContent: createProjectGeminiClient({ db, projectId: task.projectId, apiKey: config.geminiApiKey }),
            recordUsage: recordUsageToLog(db, { projectId: task.projectId }),
          })
        : async () => { throw new Error("gemini_api_key_missing"); });

    const job: ComposeJob = {
      proposal: proposal.proposal,
      projectId: task.projectId,
      generationId: task.generationId,
      mode: (projectSnap.get("mode") as ComposeJob["mode"] | undefined) ?? "memory",
      aspect: settings.settings.aspect,
      // null means the director chooses; phase 4 has no such choice yet, so it
      // takes the middle length rather than inventing one.
      durationId: (settings.settings.durationId ?? "1m") as DurationId,
      cadenceId: settings.settings.cadenceId as ComposeJob["cadenceId"],
      seed: generation.seed,
      soundtrackId: settings.settings.soundtrackId,
      // The directing note is the whole of the spec's revision mechanism: a
      // recompose differs from its parent only by the settings, and this is the
      // field that carries what the user actually asked for.
      note: settings.settings.note,
      captions: settings.settings.captions,
      collageAmount: settings.settings.collageAmount,
      motionFeel: settings.settings.motionFeel,
      focusCenter,
      chapterOf,
      timeOf,
      ...(storedCast && summary ? {
        cast: {
          summary, core: storedCast.core, focus: storedCast.focus, peopleByMoment, subjectsByMoment,
          namesById: Object.fromEntries(storedCast.people.map((person) => [person.personId, person.role === "child" ? "your child" : person.role === "parent" ? "a parent" : "a family member"])),
        },
      } : {}),
    };

    const result = await runCompose(job, {
      generateStructured: call,
      soundtrackIds: config.soundtrackIds ?? new Set(settings.settings.soundtrackId ? [settings.settings.soundtrackId] : []),
      assets: catalog,
    });

    if (!result.ok) return fail(result.reasons);

    await publishGeneration(db, {
      userId,
      projectId: task.projectId,
      generationId: task.generationId,
      timeline: result.timeline,
      droppedPicks: result.droppedPicks,
      reasons: result.reasons,
      now: Date.now(),
    });

    // Task 7's ruling: a playable film is rendered automatically. Compose writes
    // the render task here; in production the dispatcher picks it up, so Save and
    // auto-render share one path.
    await enqueueRender(db, {
      userId,
      projectId: task.projectId,
      generationId: task.generationId,
      schemaVersion: generation.schemaVersion,
    });
    config.afterRenderEnqueued?.();

    return "composed";
  };
}
