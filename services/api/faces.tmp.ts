import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { photoRoles, faceProminence } from "./src/cast/prominence.js";
initializeApp({ projectId: "demo-mosae" });
const p = getFirestore().doc("projects/D39lB6XloGxzzXNcYP0B");
const assets = new Map((await p.collection("assets").get()).docs.map((d) => [d.id, d.data().fileName]));
for (const s of (await p.collection("shots").get()).docs) {
  const name = assets.get(s.get("assetId"));
  if (!["x-photobomb.jpg", "x-distant.jpg", "d1-10.jpg", "d1-05.jpg", "d1-06.jpg"].includes(name)) continue;
  const faces = s.get("analysis")?.faces ?? [];
  const roles = photoRoles(faces.map((f: any) => f.bbox));
  console.log(name);
  faces.forEach((f: any, i: number) => console.log("  ", f.characterId ?? "—", roles[i], faceProminence(f.bbox, faces.map((x: any) => x.bbox)).score.toFixed(3), f.bbox.map((n: number) => n.toFixed(2)).join(","), f.prominence));
}
