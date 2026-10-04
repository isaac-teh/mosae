/**
 * Record-and-replay for Gemini calls, so a screen can be exercised repeatedly
 * without paying for the model every time.
 *
 * MOCK_GEMINI=record  hit the real API, save every exchange to disk
 * MOCK_GEMINI=replay  serve from disk, never contact the API (alias: "1")
 * unset               normal operation
 *
 * The hard part is that prompts embed Firestore IDs, and those IDs change
 * every run. A recording keyed on the raw prompt would miss on the next
 * upload, and a recorded response naming yesterday's shot IDs would be
 * rejected by validateProposal as invented. So both directions are
 * normalised: ID-shaped tokens are replaced by positional placeholders on
 * the way in (which is what the key is computed from) and on the way out,
 * then the placeholders are re-expanded against the CURRENT run's IDs.
 * Identical media in identical order therefore replays as a valid answer
 * about this run's data.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EMBED_DIMENSIONS } from "./pricing.js";

export type RecorderMode = "off" | "record" | "replay";

const raw = process.env.MOCK_GEMINI;
export const MODE: RecorderMode =
  raw === "record" ? "record" : raw === "replay" || raw === "1" ? "replay" : "off";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR =
  process.env.GEMINI_FIXTURES ?? path.resolve(here, "../../fixtures/gemini");

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * A digest written so the ID masker leaves it alone. Bare hex is long and
 * mixes letters with digits, so it looks exactly like a generated ID — left
 * as-is, every photo masked to the same placeholder and shared one fixture.
 * Dots break it into groups too short to match.
 */
const digestToken = (hex: string): string => (hex.match(/.{1,8}/g) ?? []).join(".");

// ── Normalisation ────────────────────────────────────────────────────────────

/**
 * A token worth treating as an identifier: long, and mixing letters with
 * digits the way a generated ID does and an English word does not. Candidate
 * IDs like `<shotId>#still@c0` split on the punctuation, so only the
 * generated part is replaced and the structural suffix stays readable.
 */
const TOKEN = /[A-Za-z0-9_-]{16,}/g;
const looksGenerated = (token: string): boolean =>
  /[0-9]/.test(token) && /[A-Za-z]/.test(token);

type IdMap = { ids: string[]; index: Map<string, number> };

const emptyIdMap = (): IdMap => ({ ids: [], index: new Map() });

/**
 * Replace generated IDs with «0», «1», … in order of first appearance.
 *
 * `extend` is the whole subtlety. A REQUEST defines the run's vocabulary, so
 * masking it extends the map. A RESPONSE must not: an ID the model returns
 * that was never in the request is one it invented, and inventing shot ids is
 * exactly what the working-set validation exists to catch. Masking it mints a
 * placeholder replay cannot resolve — the proposal then came back with literal
 * «16» shot ids. Left alone, the invented id replays verbatim and the recorded
 * repair turn follows, which is the behaviour actually observed.
 */
function maskIds(text: string, map: IdMap, extend = true): string {
  return text.replace(TOKEN, (token) => {
    if (!looksGenerated(token)) return token;
    const position = map.index.get(token);
    if (position !== undefined) return `«${position}»`;
    if (!extend) return token;
    const next = map.ids.length;
    map.ids.push(token);
    map.index.set(token, next);
    return `«${next}»`;
  });
}

/** Put this run's IDs back where the placeholders sit. */
function unmaskIds(text: string, map: IdMap): string {
  return text.replace(/«(\d+)»/g, (whole, digits: string) => {
    const id = map.ids[Number(digits)];
    return id ?? whole;
  });
}

/**
 * Large or unstable fields become stable digests, so the key survives a
 * re-upload of the same bytes and stays small enough to store.
 */
const fileUriDigests = new Map<string, string>();

/** Let the file client declare what a returned Gemini file URI actually holds. */
export function rememberFileUri(uri: string, digest: string): void {
  fileUriDigests.set(uri, digest);
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const item = source[key];
    // An AbortSignal is per-call and never part of what was asked.
    if (key === "abortSignal" || key === "signal") continue;
    if (key === "inlineData" && item && typeof item === "object") {
      const inline = item as { mimeType?: string; data?: string };
      out[key] = { mimeType: inline.mimeType, data: `sha256:${digestToken(sha(inline.data ?? ""))}` };
      continue;
    }
    if (key === "fileData" && item && typeof item === "object") {
      const file = item as { fileUri?: string; mimeType?: string };
      const digest = file.fileUri ? fileUriDigests.get(file.fileUri) : undefined;
      out[key] = { mimeType: file.mimeType, fileUri: digest ? `file:${digestToken(digest)}` : file.fileUri };
      continue;
    }
    out[key] = canonicalise(item);
  }
  return out;
}

export type Normalised = { key: string; masked: string; idMap: IdMap };

export function normaliseRequest(request: unknown): Normalised {
  const idMap = emptyIdMap();
  const masked = maskIds(JSON.stringify(canonicalise(request)), idMap);
  return { key: sha(masked), masked, idMap };
}

// ── Fixture store ────────────────────────────────────────────────────────────

type Fixture = {
  key: string;
  kind: "generate" | "embed";
  /** The stage this call belongs to, so a replay can find its siblings. */
  label: string;
  recordedAt: string;
  /** The masked request, kept for a human reading the fixture. */
  request: string;
  /** The masked response, re-expanded at replay time. */
  response: string;
};

let index: Map<string, Fixture> | null = null;

function loadIndex(): Map<string, Fixture> {
  if (index) return index;
  const loaded = new Map<string, Fixture>();
  if (existsSync(FIXTURE_DIR)) {
    for (const name of readdirSync(FIXTURE_DIR)) {
      if (!name.endsWith(".json")) continue;
      try {
        const fixture = JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8")) as Fixture;
        loaded.set(fixture.key, fixture);
      } catch {
        // A half-written fixture is not worth failing a whole run over.
      }
    }
  }
  index = loaded;
  return loaded;
}

function save(fixture: Omit<Fixture, "label">, label: string): void {
  const stored: Fixture = { ...fixture, label };
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const name = `${label}-${stored.key.slice(0, 12)}.json`;
  writeFileSync(path.join(FIXTURE_DIR, name), `${JSON.stringify(stored, null, 2)}\n`);
  loadIndex().set(stored.key, stored);
}

/** A label that makes the fixture directory readable at a glance. */
function labelFor(request: unknown): string {
  const text = JSON.stringify(request ?? "");
  if (/Translate the user's request into a small ordered list of allowed edit operations/i.test(text)) return "edit-interpret";
  if (/Interpret the user's typed message only for the current director chat step/i.test(text)) return "interpret";
  if (/story director/i.test(text)) return "direct";
  if (/Candidates:/i.test(text)) return "compose";
  if (/Analyze this video/i.test(text)) return "understand-video";
  if (/Analyze this photo/i.test(text)) return "understand-photo";
  return "call";
}

export class FixtureMissing extends Error {
  constructor(readonly key: string, readonly masked: string) {
    super(`no recorded gemini response for key ${key}`);
    this.name = "FixtureMissing";
  }
}

// ── generateContent ──────────────────────────────────────────────────────────

type GenerateFn = (request: unknown) => Promise<unknown>;

/**
 * Only the two fields every caller reads are kept. The SDK's own object
 * carries `text` as a GETTER, which JSON.stringify drops, and drags along the
 * whole HTTP envelope — recording it verbatim produced fat fixtures that
 * replayed with no text at all.
 */
function essentials(response: unknown): { text?: string; usageMetadata?: unknown } {
  const source = response as { text?: string; usageMetadata?: unknown } | null;
  return { text: source?.text, usageMetadata: source?.usageMetadata ?? {} };
}

export function recordingGenerate(real: GenerateFn): GenerateFn {
  return async (request) => {
    const { key, masked, idMap } = normaliseRequest(request);
    // Recording resumes rather than restarts: an exchange already on disk is
    // served from there instead of bought again, so re-running a flow pays
    // only for the calls that genuinely differ from last time. The key is the
    // same one replay matches on, so anything skipped here would have replayed.
    const existing = loadIndex().get(key);
    if (existing) {
      console.warn(`[gemini:record] reusing ${labelFor(request)} fixture (key ${key.slice(0, 12)})`);
      return JSON.parse(unmaskIds(existing.response, idMap));
    }
    const response = await real(request);
    save(
      {
        key,
        kind: "generate",
        recordedAt: new Date().toISOString(),
        request: masked,
        response: maskIds(JSON.stringify(essentials(response)), idMap, false),
      },
      labelFor(request),
    );
    return response;
  };
}

/**
 * A miss is written out in full beside the fixtures. The masked request is
 * the only thing that explains WHY a key differs, and it is far too long to
 * read in a log line — diffing the dump against the recorded fixture's
 * `request` field shows the differing bytes directly.
 */
export const MISS_DIR = path.join(FIXTURE_DIR, "..", "gemini-misses");

function recordMiss(key: string, masked: string, label: string): void {
  try {
    mkdirSync(MISS_DIR, { recursive: true });
    writeFileSync(path.join(MISS_DIR, `${label}-${key.slice(0, 12)}.txt`), masked);
  } catch {
    // Diagnostics must never be the reason a run dies.
  }
}

/**
 * How many times this process has replayed each stage, so a miss can fall
 * back to the next recorded turn of that stage.
 */
const stageCalls = new Map<string, number>();

/** The recorded turns for one stage, oldest first. */
function turnsFor(label: string): Fixture[] {
  return [...loadIndex().values()]
    .filter((fixture) => fixture.kind === "generate" && fixture.label === label)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

function replayEditFixtureForPrompt(fixture: Fixture, currentPrompt: string, idMap: IdMap): unknown {
  try {
    const storedRequest = JSON.parse(fixture.request) as { contents?: { text?: string }[] };
    const storedPrompt = storedRequest.contents?.map((part) => part.text ?? "").join("\n") ?? "";
    const clips = (prompt: string) => {
      const value = prompt.match(/(?:^|\n)Clips: (\[[^\n]*\])/)?.[1];
      if (!value) return [] as { clipId: string; chapter: string; caption: string; kind: string }[];
      const parsed = JSON.parse(value) as { clipId?: string; chapter: string; caption: string; kind: string }[];
      const idsValue = prompt.match(/(?:^|\n)Allowed IDs: (\{[^\n]*\})/)?.[1];
      const ids = idsValue ? (JSON.parse(idsValue) as { clipIds?: string[] }).clipIds ?? [] : [];
      return parsed.map((clip, index) => ({ ...clip, clipId: clip.clipId ?? ids[index] ?? "" }));
    };
    const oldClips = clips(storedPrompt);
    const currentClips = clips(currentPrompt);
    const clipIdMap = new Map<string, string>();
    const used = new Set<number>();
    for (const [index, oldClip] of oldClips.entries()) {
      const currentIndex = currentClips.findIndex((clip, candidateIndex) => !used.has(candidateIndex)
        && clip.chapter === oldClip.chapter && clip.caption === oldClip.caption && clip.kind === oldClip.kind);
      const fallbackIndex = currentClips[index]?.kind === oldClip.kind && !used.has(index) ? index : -1;
      const selectedIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
      if (selectedIndex >= 0) {
        used.add(selectedIndex);
        clipIdMap.set(oldClip.clipId, currentClips[selectedIndex]!.clipId);
      }
    }
    const envelope = JSON.parse(fixture.response) as { text?: string; [key: string]: unknown };
    if (!envelope?.text) return JSON.parse(unmaskIds(fixture.response, idMap));
    const body = JSON.parse(envelope.text) as { ops?: { clipId?: string; afterClipId?: string | null }[] };
    for (const op of body.ops ?? []) {
      if (op.clipId) op.clipId = clipIdMap.get(op.clipId) ?? op.clipId;
      if (op.afterClipId) op.afterClipId = clipIdMap.get(op.afterClipId) ?? op.afterClipId;
    }
    return JSON.parse(unmaskIds(JSON.stringify({ ...envelope, text: JSON.stringify(body) }), idMap));
  } catch {
    return JSON.parse(unmaskIds(fixture.response, idMap));
  }
}

/**
 * Exact-key replay is right for a single-shot call: the same photo and the
 * same prompt key to the same answer forever. It is NOT enough for directing,
 * which is a conversation that corrects itself. The model invents shot ids,
 * the validator quotes those ids back in its feedback, and that feedback is
 * part of the next turn's prompt — so turn two's key depends on which ids the
 * model happened to invent. It never repeats exactly.
 *
 * So a miss falls back to the next recorded turn OF THE SAME STAGE, in
 * recording order, with ids remapped onto this run. The conversation then
 * follows the shape it actually took when recorded. The fallback is announced
 * on every use, because replaying the wrong turn would otherwise be a silent
 * lie, and the dumped miss is still written for anyone who wants the diff.
 */
export function replayingGenerate(): GenerateFn {
  return async (request) => {
    const { key, masked, idMap } = normaliseRequest(request);
    const label = labelFor(request);
    const exact = loadIndex().get(key);
    if (exact) {
      stageCalls.set(label, (stageCalls.get(label) ?? 0) + 1);
      return JSON.parse(unmaskIds(exact.response, idMap));
    }

    recordMiss(key, masked, label);
    const turns = turnsFor(label);
    if (label === "edit-interpret") {
      const promptText = (request as { contents?: { text?: string }[] }).contents?.map((part) => part.text ?? "").join("\n") ?? "";
      const userRequest = promptText.match(/(?:^|\n)Request: ([^\n]+)/)?.[1];
      if (userRequest) {
        const matching = turns.find((turn) => turn.request.includes(`Request: ${userRequest}`) && !turn.request.includes("Your previous response did not match"));
        if (matching) return replayEditFixtureForPrompt(matching, promptText, idMap);
      }
    }
    const ordinal = stageCalls.get(label) ?? 0;
    const fallback = turns[Math.min(ordinal, turns.length - 1)];
    if (!fallback) throw new FixtureMissing(key, masked);

    stageCalls.set(label, ordinal + 1);
    console.warn(
      `[gemini:replay] no exact fixture for ${label}; using recorded turn ${Math.min(ordinal, turns.length - 1) + 1}/${turns.length} (key ${key.slice(0, 12)})`,
    );
    return JSON.parse(unmaskIds(fallback.response, idMap));
  };
}

/** Demo replay must only use an exact normalized request; a same-stage turn
 * could describe another user's intent or return ids outside this working set. */
export function replayingExactGenerate(): GenerateFn {
  return async (request) => {
    const { key, masked, idMap } = normaliseRequest(request);
    const fixture = loadIndex().get(key);
    if (!fixture || fixture.kind !== "generate") throw new FixtureMissing(key, masked);
    return JSON.parse(unmaskIds(fixture.response, idMap));
  };
}

// ── embedContent ─────────────────────────────────────────────────────────────

type EmbedInput = { model: string; contents: string[]; taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" };
type EmbedFn = (input: EmbedInput) => Promise<number[][]>;
type ImageEmbedInput = { model: string; jpeg: Buffer };
type ImageEmbedFn = (input: ImageEmbedInput) => Promise<number[]>;

/** Each text is cached on its own, so a new photo alongside old ones still hits. */
const embedKey = (model: string, taskType: string, text: string): string =>
  sha(`${model}\u0000${taskType}\u0000${text}`);

export function recordingEmbed(real: EmbedFn): EmbedFn {
  return async (input) => {
    // One request carries many texts, and they are cached independently, so
    // only the ones with no fixture are sent. Positions are preserved: the
    // caller gets vectors in the order it asked for them, whatever their
    // provenance.
    const fixtures = loadIndex();
    const vectors: number[][] = new Array(input.contents.length);
    const missing: { text: string; position: number }[] = [];

    input.contents.forEach((text, position) => {
      const hit = fixtures.get(embedKey(input.model, input.taskType, text));
      if (hit) vectors[position] = JSON.parse(hit.response) as number[];
      else missing.push({ text, position });
    });

    if (missing.length > 0) {
      const fresh = await real({ ...input, contents: missing.map((entry) => entry.text) });
      missing.forEach((entry, order) => {
        const vector = fresh[order] ?? [];
        vectors[entry.position] = vector;
        if (vector.length === 0) return;
        save(
          {
            key: embedKey(input.model, input.taskType, entry.text),
            kind: "embed",
            recordedAt: new Date().toISOString(),
            request: entry.text,
            response: JSON.stringify(vector),
          },
          "embed",
        );
      });
    }
    if (missing.length < input.contents.length) {
      console.warn(`[gemini:record] reusing ${input.contents.length - missing.length}/${input.contents.length} embed fixtures`);
    }
    return vectors;
  };
}

const imageEmbedKey = ({ model, jpeg }: ImageEmbedInput): string =>
  sha(`${model}\u0000IMAGE\u0000${createHash("sha256").update(jpeg).digest("hex")}`);

export function recordingImageEmbed(real: ImageEmbedFn): ImageEmbedFn {
  return async (input) => {
    const fixtures = loadIndex();
    const key = imageEmbedKey(input);
    const hit = fixtures.get(key);
    if (hit?.kind === "embed") return JSON.parse(hit.response) as number[];

    const vector = await real(input);
    if (vector.length > 0) {
      save({
        key,
        kind: "embed",
        recordedAt: new Date().toISOString(),
        request: `image-sha256:${createHash("sha256").update(input.jpeg).digest("hex")}`,
        response: JSON.stringify(vector),
      }, "embed-image");
    }
    return vector;
  };
}

export function replayingImageEmbed(): ImageEmbedFn {
  return async (input) => {
    const fixtures = loadIndex();
    const key = imageEmbedKey(input);
    const hit = fixtures.get(key);
    if (hit?.kind === "embed") return JSON.parse(hit.response) as number[];

    let width = 0;
    for (const fixture of fixtures.values()) {
      if (fixture.kind === "embed") {
        width = (JSON.parse(fixture.response) as number[]).length;
        break;
      }
    }
    return syntheticVector(key, width || EMBED_DIMENSIONS);
  };
}

/**
 * A miss falls back to a deterministic unit vector rather than throwing:
 * embeddings steer ranking, and a run that cannot rank is still worth
 * watching end to end. The dimension follows whatever was recorded, because
 * Firestore rejects a zero-length vector and mixes of width are useless.
 */
export function replayingEmbed(): EmbedFn {
  return async (input) => {
    const fixtures = loadIndex();
    let width = 0;
    for (const fixture of fixtures.values()) {
      if (fixture.kind === "embed") {
        width = (JSON.parse(fixture.response) as number[]).length;
        break;
      }
    }
    return input.contents.map((text) => {
      const hit = fixtures.get(embedKey(input.model, input.taskType, text));
      if (hit) return JSON.parse(hit.response) as number[];
      // Fall back to the width real embeddings use: the recorded vectors are
      // gitignored, so with none on disk this is the only thing keeping a
      // replayed project's vectors the same size as a live one's.
      return syntheticVector(text, width || EMBED_DIMENSIONS);
    });
  };
}

/** Same text, same vector, every run — and never zero length. */
function syntheticVector(text: string, width: number): number[] {
  const seed = createHash("sha256").update(text).digest();
  const values = Array.from({ length: width }, (_, i) => (seed[i % seed.length] - 128) / 128);
  const norm = Math.hypot(...values) || 1;
  return values.map((value) => value / norm);
}

export function fixtureCount(): number {
  return loadIndex().size;
}
