import { initializeApp, getApps, getApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";
let authConnected = false;
let storageConnected = false;

export function getAuthClient() {
  const auth = getAuth(firebaseApp);
  if (useEmulators && !authConnected) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    authConnected = true;
  }
  return auth;
}

export function getStorageClient() {
  const storage = getStorage(firebaseApp);
  if (useEmulators && !storageConnected) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    storageConnected = true;
  }
  return storage;
}

export function getDbClient() {
  return getFirestore(firebaseApp);
}
