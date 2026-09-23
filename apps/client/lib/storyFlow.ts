import { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";
import { createApiStoryRepository, createFixtureStoryRepository, type StoryRepository } from "@mosae/core";

export type StoryFlow = { repository: "api"; projectId: string } | { repository: "fixture" };
let fixtureRepository: StoryRepository | undefined;

export function getFixtureRepository() {
  return fixtureRepository ??= createFixtureStoryRepository();
}

export function storyRoute(path: string, id: { planId?: string; filmId?: string }, flow: StoryFlow) {
  const query = Object.entries({ ...id, ...flow }).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&");
  return `${path}?${query}`;
}

/** A review URL owns its repository identity, including after a full reload. */
export function useStoryFlow() {
  const params = useLocalSearchParams<{ repository?: string; projectId?: string; live?: string }>();
  const api = params.repository === "api" || (params.repository !== "fixture" &&
    (params.live === "1" || process.env.EXPO_PUBLIC_USE_API_STORY_REPOSITORY === "true"));
  const projectId = params.projectId ?? process.env.EXPO_PUBLIC_STORY_PROJECT_ID ?? "";
  const flow = useMemo<StoryFlow>(() => api ? { repository: "api", projectId } : { repository: "fixture" }, [api, projectId]);
  const repository = useMemo(() => api ? createApiStoryRepository({ projectId }) : getFixtureRepository(), [api, projectId]);
  return { flow, repository, route: (path: string, id: { planId?: string; filmId?: string } = {}) => storyRoute(path, id, flow) };
}
