import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectAuthEmulator: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  connectStorageEmulator: vi.fn(),
  auth: {}, firestore: {}, storage: {},
}));

vi.mock("firebase/app", () => ({ getApp: vi.fn(() => ({})), getApps: vi.fn(() => [{}]), initializeApp: vi.fn() }));
vi.mock("firebase/auth", () => ({ connectAuthEmulator: mocks.connectAuthEmulator, getAuth: vi.fn(() => mocks.auth) }));
vi.mock("firebase/firestore", () => ({ connectFirestoreEmulator: mocks.connectFirestoreEmulator, getFirestore: vi.fn(() => mocks.firestore) }));
vi.mock("firebase/storage", () => ({ connectStorageEmulator: mocks.connectStorageEmulator, getStorage: vi.fn(() => mocks.storage) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("Firebase emulator endpoints", () => {
  it("allows the web app to use isolated emulator ports", async () => {
    vi.stubEnv("EXPO_PUBLIC_FIRESTORE_EMULATOR_PORT", "18085");
    vi.stubEnv("EXPO_PUBLIC_AUTH_EMULATOR_PORT", "19099");
    vi.stubEnv("EXPO_PUBLIC_STORAGE_EMULATOR_PORT", "19199");
    const { configureCore } = await import("./config.js");
    configureCore({ apiBaseUrl: "http://127.0.0.1:18080", firebase: {}, useEmulators: true });
    const firebase = await import("./firebase.js");

    firebase.getAuthClient();
    firebase.getFirestoreClient();
    firebase.getStorageClient();

    expect(mocks.connectAuthEmulator).toHaveBeenCalledWith(mocks.auth, "http://127.0.0.1:19099", { disableWarnings: true });
    expect(mocks.connectFirestoreEmulator).toHaveBeenCalledWith(mocks.firestore, "127.0.0.1", 18085);
    expect(mocks.connectStorageEmulator).toHaveBeenCalledWith(mocks.storage, "127.0.0.1", 19199);
  });

  it("never connects to Firebase emulators in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { configureCore } = await import("./config.js");
    configureCore({ apiBaseUrl: "https://api.example.com", firebase: {}, useEmulators: true });
    const firebase = await import("./firebase.js");

    firebase.getAuthClient();
    firebase.getFirestoreClient();
    firebase.getStorageClient();

    expect(mocks.connectAuthEmulator).not.toHaveBeenCalled();
    expect(mocks.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(mocks.connectStorageEmulator).not.toHaveBeenCalled();
  });
});
