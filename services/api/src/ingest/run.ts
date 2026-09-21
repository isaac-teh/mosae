import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Runner = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Runs a command without a shell, so file names are never interpreted. ffmpeg
 * writes its analysis to stderr, which is why both streams are returned.
 */
export const defaultRun: Runner = async (command, args, options) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    maxBuffer: 64 * 1024 * 1024,
    timeout: options?.timeoutMs ?? 15 * 60_000,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

/** True when the child was killed for exceeding its timeout, which is worth retrying. */
export function isTimeout(error: unknown): boolean {
  return Boolean((error as { killed?: boolean } | null)?.killed);
}
