import { apiPost } from "@mosae/core";
import type { Href } from "expo-router";

/** Both entry points start the same server-backed trip and skip the upload UI. */
export async function startDemoTrip(router: { push: (href: Href) => void }): Promise<void> {
  const result = await apiPost<{ project: { id: string } }>("/api/projects/demo");
  router.push({ pathname: "/director", params: { projectId: result.project.id, repository: "api", live: "1" } } as Href);
}
