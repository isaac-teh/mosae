import { Router } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type ToolStatus = { ffmpeg: boolean; ffprobe: boolean; exiftool: boolean };

async function present(command: string, args: string[]): Promise<boolean> {
  try {
    await run(command, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ingest shells out to these. A container missing one would otherwise look
 * healthy and fail on the first upload instead of at startup.
 */
export async function probeTools(): Promise<ToolStatus> {
  const [ffmpeg, ffprobe, exiftool] = await Promise.all([
    present("ffmpeg", ["-version"]),
    present("ffprobe", ["-version"]),
    present("exiftool", ["-ver"]),
  ]);
  return { ffmpeg, ffprobe, exiftool };
}

export function healthRouter(deps: { probe?: () => Promise<ToolStatus> } = {}): Router {
  const probe = deps.probe ?? probeTools;
  const router = Router();
  router.get("/health", async (_req, res) => {
    let tools: ToolStatus;
    try {
      tools = await probe();
    } catch {
      tools = { ffmpeg: false, ffprobe: false, exiftool: false };
    }
    const ok = tools.ffmpeg && tools.ffprobe && tools.exiftool;
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", tools });
  });
  return router;
}
