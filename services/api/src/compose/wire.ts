import type { Firestore } from "firebase-admin/firestore";
import { safeParseStoryProposal, safeParseDirectionSettings, type Generation, type StoryProposal, type DurationId } from "@mosae/contracts";
import type { Asset } from "../store/finalizeStore.js";
import type { ShotAnalysis } from "../domain/understanding.js";
import { generateStructured, type GenerateOptions } from "../gemini/client.js";
import { createGenAI, generateContentVia, recordUsageToLog } from "../gemini/wire.js";
import { publishGeneration, failGeneration } from "../store/generationStore.js";
import { runCompose, type ComposeDeps, type ComposeJob } from "./runCompose.js";
import type { Asset as CandidateAsset } from "./buildCandidates.js";

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

    const proposal = safeParseStoryProposal(proposalSnap.data());
    if (!proposal.ok) return fail([`invalid proposal: ${proposal.errors.join("; ")}`]);
    if (proposal.proposal.state !== "accepted") {
      return fail([`proposal ${generation.proposalId} is not accepted`]);
    }

    const catalog = await loadComposeCatalog(db, task.projectId, proposal.proposal);

    // Constructed here, not at module load, and only when a key exists.
    const client = !config.generateStructured && config.geminiApiKey ? createGenAI(config.geminiApiKey) : undefined;
    const call: ComposeDeps["generateStructured"] = config.generateStructured
      ?? (client
        ? (options) => generateStructured(options as GenerateOptions<unknown>, {
            generateContent: generateContentVia(client),
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
    return "composed";
  };
}
