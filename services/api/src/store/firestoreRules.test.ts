import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-mosae",
    firestore: { rules: readFileSync(resolve(process.cwd(), "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8085 },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p-alice"), { userId: "alice", status: "ready" });
    await setDoc(doc(db, "projects/p-alice/assets/a1"), { status: "understood" });
    await setDoc(doc(db, "projects/p-alice/shots/s1"), { assetId: "a1" });
    await setDoc(doc(db, "projects/p-alice/storyProposals/pr1"), { state: "draft" });
    await setDoc(doc(db, "projects/p-alice/generations/g1"), { status: "rendering" });
    await setDoc(doc(db, "projects/p-alice/jobs/j1"), { type: "plan", status: "running" });
    await setDoc(doc(db, "projects/p-alice/uploadSessions/u1"), { closed: false });
    await setDoc(doc(db, "projects/p-alice/taskOutbox/t1"), { state: "pending" });
  });
});

afterAll(async () => {
  await env?.cleanup();
});

describe("firestore.rules (emulator)", () => {
  it("lets an owner read their project and its progress collections", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(db, "projects/p-alice")));
    await assertSucceeds(getDoc(doc(db, "projects/p-alice/assets/a1")));
    await assertSucceeds(getDoc(doc(db, "projects/p-alice/shots/s1")));
    await assertSucceeds(getDoc(doc(db, "projects/p-alice/storyProposals/pr1")));
    await assertSucceeds(getDoc(doc(db, "projects/p-alice/generations/g1")));
    await assertSucceeds(getDoc(doc(db, "projects/p-alice/jobs/j1")));
  });

  it("denies another signed-in user, at the project and at every subcollection", async () => {
    const db = env.authenticatedContext("bob").firestore();
    await assertFails(getDoc(doc(db, "projects/p-alice")));
    await assertFails(getDoc(doc(db, "projects/p-alice/assets/a1")));
    await assertFails(getDoc(doc(db, "projects/p-alice/shots/s1")));
    await assertFails(getDoc(doc(db, "projects/p-alice/storyProposals/pr1")));
    await assertFails(getDoc(doc(db, "projects/p-alice/generations/g1")));
    await assertFails(getDoc(doc(db, "projects/p-alice/jobs/j1")));
  });

  it("denies an unauthenticated reader", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "projects/p-alice")));
    await assertFails(getDoc(doc(db, "projects/p-alice/shots/s1")));
  });

  it("keeps server-only collections closed even to the owner", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(getDoc(doc(db, "projects/p-alice/uploadSessions/u1")));
    await assertFails(getDoc(doc(db, "projects/p-alice/taskOutbox/t1")));
  });

  it("denies every client write, including the owner's", async () => {
    const db = env.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "projects/p-alice"), { userId: "alice", status: "ready" }));
    await assertFails(setDoc(doc(db, "projects/p-alice/storyProposals/pr1"), { state: "accepted" }));
    await assertFails(setDoc(doc(db, "projects/p-bob"), { userId: "bob" }));
  });
});
