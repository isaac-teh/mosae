import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function initAdminDb(): Firestore {
  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      });
  return getFirestore(app);
}

let cachedDb: Firestore | undefined;

// Lazily initialized so the server can boot without real Firebase
// credentials present; it only throws once a route actually touches Firestore.
export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_target, prop, receiver) {
    if (!cachedDb) {
      cachedDb = initAdminDb();
    }
    return Reflect.get(cachedDb, prop, receiver);
  },
});
