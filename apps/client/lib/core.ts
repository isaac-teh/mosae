import { configureCore, setStoryRepository, createApiStoryRepository, createFixtureStoryRepository } from "@mosae/core";

const useEmulators = process.env.EXPO_PUBLIC_USE_EMULATORS === "true";
const useApiStoryRepository = process.env.EXPO_PUBLIC_USE_API_STORY_REPOSITORY === "true";
const storyProjectId = process.env.EXPO_PUBLIC_STORY_PROJECT_ID;

configureCore({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  firebase: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  },
  useEmulators,
});

if (useApiStoryRepository && !storyProjectId) {
  throw new Error("EXPO_PUBLIC_STORY_PROJECT_ID is required when EXPO_PUBLIC_USE_API_STORY_REPOSITORY=true");
}

setStoryRepository(
  useApiStoryRepository
    ? createApiStoryRepository({ projectId: storyProjectId as string })
    : createFixtureStoryRepository(),
);
