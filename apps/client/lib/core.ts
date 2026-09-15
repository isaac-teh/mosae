import { configureCore } from "@mosae/core";

const useEmulators = process.env.EXPO_PUBLIC_USE_EMULATORS === "true";
// Firebase validates API-key format before routing Auth requests to an emulator.
// The emulator does not validate the key itself, so use a format-valid placeholder
// when the documented local `demo-key` value is supplied.
const apiKey = useEmulators && process.env.EXPO_PUBLIC_FIREBASE_API_KEY === "demo-key" ? "AIzaSyDemoMosaeEmulatorKey000000000000000" : process.env.EXPO_PUBLIC_FIREBASE_API_KEY;

configureCore({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  firebase: {
    apiKey,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  },
  useEmulators,
});
