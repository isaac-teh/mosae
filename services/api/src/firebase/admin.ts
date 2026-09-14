import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? "demo-mosae" });
  }
  if (process.env.FIREBASE_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  }
  return initializeApp({ credential: applicationDefault(), storageBucket: process.env.FIREBASE_STORAGE_BUCKET });
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

let cachedDb: Firestore | undefined;

// Lazily initialized so the server can boot without real Firebase
// credentials present; it only throws once a route actually touches Firestore.
export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    cachedDb ??= getFirestore(getAdminApp());
    const value = Reflect.get(cachedDb, prop, cachedDb);
    return typeof value === "function" ? value.bind(cachedDb) : value;
  },
});
