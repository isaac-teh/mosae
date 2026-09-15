import { apiPost } from "./apiClient";

export async function submitStory(
  storyText: string,
  mediaRefs: string[]
): Promise<{ planId: string }> {
  return apiPost("/api/curate", { storyText, mediaRefs });
}
