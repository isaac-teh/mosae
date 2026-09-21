import { watchProjectProgress, type ProjectProgress } from "@mosae/core";
import { useEffect, useState } from "react";

/** Returns null until the first successful read, and again if progress cannot be read. */
export function useProjectProgress(projectId: string | null, expectedTotal: number, enabled: boolean): ProjectProgress | null {
  const [progress, setProgress] = useState<ProjectProgress | null>(null);
  useEffect(() => {
    if (!enabled || !projectId) return undefined;
    return watchProjectProgress(projectId, expectedTotal, { onChange: setProgress, onError: () => setProgress(null) });
  }, [projectId, expectedTotal, enabled]);
  return progress;
}
