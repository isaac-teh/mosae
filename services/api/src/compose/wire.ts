import type { Firestore } from "firebase-admin/firestore";
import { safeParseStoryProposal, safeParseDirectionSettings, type Generation, type StoryProposal, type DurationId } from "@mosae/contracts";
import type { Asset } from "../store/finalizeStore.js";
import type { ShotAnalysis } from "../domain/understanding.js";
import { generateStructured, type GenerateOptions } from "../gemini/client.js";
import { createGeminiClient, geminiConfigured, recordUsageToLog } from "../gemini/wire.js";
import { publishGeneration, failGeneration } from "../store/generationStore.js";
import { enqueueRender } from "../store/enqueueRender.js";
import { stripProposalEnvelope } from "../store/directingStore.js";
import { runCompose, type ComposeDeps, type ComposeJob } from "./runCompose.js";
import type { Asset as CandidateAsset } from "./buildCandidates.js";
import type { Face } from "../domain/understanding.js";

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
  const catalog = new Map<string, CandidateAsset>();

  for (const moment of proposal.moments) {
    // A film may not contain media the user deselected, so it is never offered.
    if (deselected.has(moment.id)) continue;

    const shot = shots.get(moment.shotId);
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

    // Constructed here, not at module load, and only when a key exists.
    const call: ComposeDeps["generateStructured"] = config.generateStructured
      ?? (geminiConfigured(config.geminiApiKey)
        ? (options) => generateStructured(options as GenerateOptions<unknown>, {
            generateContent: createGeminiClient(config.geminiApiKey),
            recordUsage: recordUsageToLog(db, { projectId: task.projectId }),
          })
        : async () => { throw new Error("gemini_api_key_missing"); });

    const job: ComposeJob = {
      proposal: proposal.proposal,
      projectId: task.projectId,
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
      focusCenter,
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
