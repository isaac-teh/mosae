import { getStorage } from "firebase-admin/storage";
import { adminDb, getAdminApp } from "../src/firebase/admin.js";
import { recordFinalize } from "../src/store/finalizeStore.js";
import { InMemoryTaskQueue } from "../src/queue/taskQueue.js";
import { dispatchDue } from "../src/outbox/dispatcher.js";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  throw new Error("replayFinalize only runs against the emulators");
}

const bucketName = process.env.FIREBASE_STORAGE_BUCKET ?? "demo-mosae.appspot.com";
const [files] = await getStorage(getAdminApp()).bucket(bucketName).getFiles({ prefix: "uploads/" });

for (const file of files) {
  const result = await recordFinalize(adminDb, bucketName, {
    bucket: bucketName,
    objectName: file.name,
    generation: String(file.metadata.generation),
    sizeBytes: Number(file.metadata.size),
    contentType: file.metadata.contentType ?? "application/octet-stream",
    now: Date.now(),
  });
  console.log(file.name, result.kind);
}

const queue = new InMemoryTaskQueue();
console.log("dispatch", await dispatchDue(adminDb, queue, Date.now()));
console.log("queued", queue.tasks.map((t) => t.name));
process.exit(0);
