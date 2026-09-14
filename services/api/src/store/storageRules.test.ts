import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

let env: RulesTestEnvironment;
const original = (uid: string) => `uploads/${uid}/p1/s1/a1/original`;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-mosae",
    storage: { rules: readFileSync(resolve(process.cwd(), "../../storage.rules"), "utf8"), host: "127.0.0.1", port: 9199 },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

describe("storage.rules (emulator)", () => {
  it("lets a user upload an image or video original to their own path", async () => {
    const storage = env.authenticatedContext("alice").storage();
    await assertSucceeds(storage.ref(original("alice")).put(jpeg, { contentType: "image/jpeg" }).then(() => undefined));
    await assertSucceeds(storage.ref(original("alice").replace("a1", "a2")).put(jpeg, { contentType: "video/mp4" }).then(() => undefined));
  });

  it("rejects other users' paths, anonymous callers, and non-original objects", async () => {
    const alice = env.authenticatedContext("alice").storage();
    await assertFails(alice.ref(original("bob")).put(jpeg, { contentType: "image/jpeg" }).then(() => undefined));
    await assertFails(alice.ref("uploads/alice/p1/s1/a1/thumb.jpg").put(jpeg, { contentType: "image/jpeg" }).then(() => undefined));
    await assertFails(alice.ref("renders/alice/p1/out.mp4").put(jpeg, { contentType: "video/mp4" }).then(() => undefined));
    const nobody = env.unauthenticatedContext().storage();
    await assertFails(nobody.ref(original("alice")).put(jpeg, { contentType: "image/jpeg" }).then(() => undefined));
  });

  it("rejects non-media content types", async () => {
    const storage = env.authenticatedContext("alice").storage();
    await assertFails(storage.ref(original("alice").replace("a1", "a3")).put(jpeg, { contentType: "application/pdf" }).then(() => undefined));
    await assertFails(storage.ref(original("alice").replace("a1", "a5")).put(new Uint8Array(), { contentType: "image/jpeg" }).then(() => undefined));
    await assertFails(storage.ref(original("alice").replace("a1", "a6")).put(jpeg, { contentType: "image/" }).then(() => undefined));
    await assertFails(storage.ref("uploads/alice/p1/s1/a1/x/original").put(jpeg, { contentType: "image/jpeg" }).then(() => undefined));
  });

  it("allows owners to read, and denies overwrite and delete", async () => {
    const alice = env.authenticatedContext("alice").storage();
    const ref = alice.ref(original("alice").replace("a1", "a4"));
    await assertSucceeds(ref.put(jpeg, { contentType: "image/jpeg" }).then(() => undefined));
    await assertSucceeds(ref.getMetadata());
    await assertFails(ref.put(jpeg, { contentType: "image/jpeg" }).then(() => undefined));
    await assertFails(ref.delete());
    await assertFails(env.authenticatedContext("bob").storage().ref(ref.fullPath).getMetadata());
  });
});
