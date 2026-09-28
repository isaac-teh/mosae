import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ projectId: "demo-mosae" });
const p = getFirestore().doc("projects/D39lB6XloGxzzXNcYP0B");
for (const j of (await p.collection("jobs").get()).docs) console.log(JSON.stringify({ diagnostics: j.get("diagnostics"), usage: j.get("usage"), code: j.get("code") }, null, 1).slice(0, 3000));
