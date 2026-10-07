import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const SIGNAL_STEP_SEC = 0.25;
export const MAX_SIGNAL_SAMPLES = 2400;
export type ShotSignals = { stepSec: 0.25; shake: number[]; blur: number[]; loud: number[] };

const round2 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;

/** Extract low-resolution proxy samples. A failed ffmpeg/ffprobe run is handled by the caller. */
export async function extractShotSignals(proxy: string, startSec: number, endSec: number): Promise<ShotSignals> {
  const duration = Math.max(0, endSec - startSec);
  if (!Number.isFinite(duration) || duration <= 0) return { stepSec: SIGNAL_STEP_SEC, shake: [], blur: [], loud: [] };
  const expected = Math.min(MAX_SIGNAL_SAMPLES, Math.max(1, Math.ceil(duration / SIGNAL_STEP_SEC)));
  const run = (args: string[]) => execFileAsync("ffmpeg", args, { encoding: "buffer", maxBuffer: 128 * 1024 * 1024, timeout: 120_000 });
  const frameArgs = ["-v", "error", "-ss", String(startSec), "-t", String(duration), "-i", proxy, "-an", "-vf", "fps=4,scale=160:90:flags=area,format=gray", "-f", "rawvideo", "pipe:1"];
  const { stdout: frameBuffer } = await run(frameArgs);
  const frames = Buffer.isBuffer(frameBuffer) ? frameBuffer : Buffer.from(frameBuffer);
  const frameSize = 160 * 90;
  const frameCount = Math.min(expected, Math.floor(frames.length / frameSize));
  const blurRaw: number[] = [];
  const motionRaw: number[] = [];
  for (let f = 0; f < frameCount; f++) {
    const offset = f * frameSize;
    let varianceSum = 0;
    for (let y = 1; y < 89; y++) for (let x = 1; x < 159; x++) {
      const p = offset + y * 160 + x;
      const lap = 4 * frames[p] - frames[p - 1] - frames[p + 1] - frames[p - 160] - frames[p + 160];
      varianceSum += lap * lap;
    }
    blurRaw.push(varianceSum / (158 * 88));
    if (f === 0) motionRaw.push(0);
    else {
      let diff = 0;
      for (let p = 0; p < frameSize; p++) diff += Math.abs(frames[offset + p] - frames[offset - frameSize + p]);
      motionRaw.push(diff / (frameSize * 255));
    }
  }
  let hasAudio = false;
  try {
    const probe = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", proxy], { timeout: 30_000 });
    hasAudio = String(probe.stdout).trim().length > 0;
  } catch { /* missing ffprobe/audio means silence */ }
  let loud: number[] = [];
  if (hasAudio) {
    const { stdout } = await run(["-v", "error", "-ss", String(startSec), "-t", String(duration), "-i", proxy, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"]);
    const pcm = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    const samplesPerBin = 2000;
    for (let i = 0; i < Math.min(expected, Math.ceil(pcm.length / 4 / samplesPerBin)); i++) {
      let sum = 0; let count = 0;
      for (let j = i * samplesPerBin * 4; j + 4 <= pcm.length && j < (i + 1) * samplesPerBin * 4; j += 4) { const value = pcm.readFloatLE(j); sum += value * value; count++; }
      loud.push(count ? Math.sqrt(sum / count) : 0);
    }
  }
  const targetCount = Math.min(expected, Math.max(frameCount, loud.length));
  const resample = (values: number[], count: number) => Array.from({ length: count }, (_, i) => values.length ? values[Math.min(values.length - 1, Math.floor(i * values.length / count))] : 0);
  // Laplacian variance is highly skewed: detailed phone footage commonly sits
  // well above 500 even after downscaling to the 160x90 proxy. A square-root
  // curve keeps sharp frames near zero while preserving separation between
  // sharp and box-blurred footage instead of saturating both at zero.
  const blurSeverity = (variance: number) => round2(1 - Math.min(1, Math.sqrt(Math.max(0, variance) / 1500)));
  return {
    stepSec: SIGNAL_STEP_SEC,
    shake: resample(motionRaw, targetCount).map((v) => round2(v * 5)),
    blur: resample(blurRaw, targetCount).map(blurSeverity),
    loud: resample(loud, targetCount).map((v) => round2(v * 4)),
  };
}
