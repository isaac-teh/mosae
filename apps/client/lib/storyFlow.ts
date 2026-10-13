import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const fixtureOptIn = params.repository === "fixture" || (params.repository !== "api" && params.live !== "1" &&
    process.env.NODE_ENV !== "production" && process.env.EXPO_PUBLIC_USE_FIXTURE_STORY_REPOSITORY === "true"
  );
  const api = !fixtureOptIn && (
    params.repository === "api" || params.live === "1" ||
    process.env.EXPO_PUBLIC_USE_API_STORY_REPOSITORY === "true" ||
    process.env.NODE_ENV === "production" || process.env.EXPO_PUBLIC_USE_FIXTURE_STORY_REPOSITORY !== "true"
  );
  const projectId = params.projectId ?? "";
  const flow = useMemo<StoryFlow>(() => api ? { repository: "api", projectId } : { repository: "fixture" }, [api, projectId]);
  const repository = useMemo(() => {
    const source = api ? createApiStoryRepository(projectId ? { projectId } : {}) : getFixtureRepository();
    if (!api) return source;
    return new Proxy(source, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const failed = (error: unknown): never => {
            if ((error as { status?: unknown } | null)?.status === 404) routerRef.current.replace("/");
            throw error;
          };
          try {
            const result = value.apply(target, args) as unknown;
            return result && typeof (result as { catch?: unknown }).catch === "function"
              ? (result as Promise<unknown>).catch(failed)
              : result;
          } catch (error) { return failed(error); }
        };
      },
    });
  }, [api, projectId]);
  const identityKey = api ? `api:${projectId}` : "fixture";
  return { flow, identityKey, repository, route: (path: string, id: { planId?: string; filmId?: string } = {}) => storyRoute(path, id, flow) };
}

/** Guards async continuations owned by one keyed screen identity. */
export function useStoryScreenGuard() {
  const active = useRef(true);
  useEffect(() => () => { active.current = false; }, []);
  return useCallback(() => active.current, []);
}
