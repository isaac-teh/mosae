import { doc, onSnapshot } from "firebase/firestore";
import { apiPost } from "../apiClient";
import { ensureSignedIn } from "../auth";
import { getFirestoreClient } from "../firebase";

export type StoryPlanJob = {
  id: string;
  proposalId: string;
  status: "waiting_for_ready" | "queued" | "running" | "publishing" | "succeeded" | "failed";
  progress?: "searching" | "inspecting" | "organizing" | null;
  reason?: string | null;
};

export async function startStoryPlan(projectId: string, text: string, focus: string[]): Promise<StoryPlanJob> {
  const response = await apiPost<{ job: StoryPlanJob }>(`/api/projects/${encodeURIComponent(projectId)}/story-intents`, { text, focus });
  return response.job;
}

/** Unsubscribe also cancels setup when authentication is still pending. */
export function watchStoryPlan(
  projectId: string,
  jobId: string,
  handlers: { onChange(job: StoryPlanJob): void; onError(error: unknown): void },
): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  const fail = (error: unknown) => { if (!stopped) handlers.onError(error); };
  void ensureSignedIn().then(() => {
    if (stopped) return;
    unsubscribe = onSnapshot(doc(getFirestoreClient(), "projects", projectId, "jobs", jobId), snapshot => {
      if (stopped) return;
      if (!snapshot.exists()) {
        fail(new Error("Planning job is unavailable. Please reconnect."));
        return;
      }
      handlers.onChange(snapshot.data() as StoryPlanJob);
    }, fail);
  }).catch(fail);
  return () => { stopped = true; unsubscribe?.(); };
}
