import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ projectId: "demo-mosae" });
const p = getFirestore().doc("projects/D39lB6XloGxzzXNcYP0B");
console.log("project", (await p.get()).get("status"));
for (const d of (await p.collection("assets").get()).docs) {
  const a = d.data();
  console.log(a.fileName, a.status, a.media?.localTime, JSON.stringify(a.place ?? null));
}
const shots = await p.collection("shots").get();
console.log("shots analysed", shots.docs.filter((s) => s.get("analysis")).length, "/", shots.size);
