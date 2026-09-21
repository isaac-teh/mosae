import { collection, doc, getCountFromServer, getDoc, query, where } from "firebase/firestore";
import { ensureSignedIn } from "../auth";
import { getFirestoreClient } from "../firebase";
import { computeProgress, type ProjectProgress, type ProjectStatus, type RawProgress } from "./progress";

export type ProgressDeps = { read(projectId: string): Promise<RawProgress> };

/**
 * The same aggregation counts the server uses to settle a project: two counts and
 * one document per poll, with no listener on the whole assets collection, which
 * would download every asset document of a 1,500 file upload.
 */
const firestoreDeps: ProgressDeps = {
  async read(projectId) {
    await ensureSignedIn();
    const db = getFirestoreClient();
    const assets = collection(db, "projects", projectId, "assets");
    const [project, ingested, failed] = await Promise.all([
      getDoc(doc(db, "projects", projectId)),
      getCountFromServer(query(assets, where("status", "==", "ingested"))),
      getCountFromServer(query(assets, where("status", "==", "failed"))),
    ]);
    return { status: (project.get("status") as ProjectStatus | undefined) ?? null, ingested: ingested.data().count, failed: failed.data().count };
  },
};

const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * A first read that fails means this project is not readable (wrong id, no
 * access), so it stops at once instead of retrying forever. After a success a
 * few transient failures are tolerated before giving up.
 */
export function watchProjectProgress(
  projectId: string,
  expectedTotal: number,
  handlers: { onChange: (progress: ProjectProgress) => void; onError?: (error: unknown) => void },
  deps: ProgressDeps = firestoreDeps,
  intervalMs = 2000,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let everSucceeded = false;
  let failures = 0;

  const tick = async () => {
    try {
      const progress = computeProgress(await deps.read(projectId), expectedTotal);
      if (stopped) return;
      everSucceeded = true;
      failures = 0;
      handlers.onChange(progress);
      if (progress.finished) return;
    } catch (error) {
      if (stopped) return;
      failures += 1;
      if (!everSucceeded || failures >= MAX_CONSECUTIVE_FAILURES) {
        handlers.onError?.(error);
        return;
      }
    }
    timer = setTimeout(() => void tick(), intervalMs);
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
