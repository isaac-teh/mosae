import { configureCore, setStoryRepository, createFixtureStoryRepository } from "@mosae/core";

const useEmulators = process.env.EXPO_PUBLIC_USE_EMULATORS === "true";

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

setStoryRepository(createFixtureStoryRepository());
