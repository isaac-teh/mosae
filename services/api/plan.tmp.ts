import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ projectId: "demo-mosae" });
const p = getFirestore().doc("projects/D39lB6XloGxzzXNcYP0B");
const jobs = await p.collection("jobs").get();
for (const j of jobs.docs) console.log("job", j.get("type"), j.get("status"), j.get("reason") ?? "");
const cur = (await p.get()).get("currentProposalId");
if (!cur) { console.log("no proposal yet"); process.exit(0); }
const prop = (await p.collection("storyProposals").doc(cur).get()).data()!;
const assets = new Map((await p.collection("assets").get()).docs.map((d) => [d.id, d.data()]));
const shots = new Map((await p.collection("shots").get()).docs.map((d) => [d.id, assets.get(d.get("assetId"))?.fileName]));
console.log("proposal", cur, prop.title);
for (const c of prop.chapters) console.log(" ", c.title, "→", c.momentIds.map((id: string) => shots.get(prop.moments.find((m: any) => m.id === id)?.shotId)).join(", "));
console.log("leftOut", (prop.leftOut ?? []).map((l: any) => `${shots.get(l.shotId)}: ${l.reason}`));
const cast = (await p.collection("cast").doc("current").get()).data();
console.log("cast", cast?.people?.map((x: any) => `${x.personId} ${x.role} subj=${x.subjectCount}`), "focus", cast?.focus);
