import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInAnonymously: vi.fn(),
  auth: { currentUser: null as any, authStateReady: vi.fn(async () => {}) },
}));

vi.mock("firebase/auth", () => ({ signInAnonymously: mocks.signInAnonymously }));
vi.mock("./firebase", () => ({ getAuthClient: () => mocks.auth }));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.auth.currentUser = null;
});

describe("ensureSignedIn", () => {
  it("shares one pending anonymous sign-in between concurrent callers", async () => {
    let finish!: (value: { user: { uid: string } }) => void;
    const signedIn = new Promise<{ user: { uid: string } }>((resolve) => { finish = resolve; });
    mocks.signInAnonymously.mockReturnValue(signedIn);
    const { ensureSignedIn } = await import("./auth");

    const first = ensureSignedIn();
    const second = ensureSignedIn();
    await vi.waitFor(() => expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1));
    const user = { uid: "same-anonymous-user" };
    finish({ user });

    const [firstUser, secondUser] = await Promise.all([first, second]);
    expect(firstUser).toBe(user);
    expect(secondUser).toBe(user);
  });

  it("clears a rejected single-flight promise so a later call can retry", async () => {
    const user = { uid: "retry-user" };
    mocks.signInAnonymously.mockRejectedValueOnce(new Error("temporary auth failure")).mockResolvedValueOnce({ user });
    const { ensureSignedIn } = await import("./auth");

    await expect(ensureSignedIn()).rejects.toThrow("temporary auth failure");
    await expect(ensureSignedIn()).resolves.toBe(user);
    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(2);
  });
});
