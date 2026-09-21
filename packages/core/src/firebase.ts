import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { getCoreConfig } from "./config";

let authConnected = false;
let firestoreConnected = false;
let storageConnected = false;

function firebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(getCoreConfig().firebase);
}

export function getAuthClient() {
  const auth = getAuth(firebaseApp());
  if (getCoreConfig().useEmulators && !authConnected) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    authConnected = true;
  }
  return auth;
}

export function getStorageClient() {
  const storage = getStorage(firebaseApp());
  if (getCoreConfig().useEmulators && !storageConnected) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    storageConnected = true;
  }
  return storage;
}

export function getFirestoreClient() {
  const db = getFirestore(firebaseApp());
  if (getCoreConfig().useEmulators && !firestoreConnected) {
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
    firestoreConnected = true;
  }
  return db;
}
