import { execFileSync } from "node:child_process";

if (!process.env.FACE_SERVICE_ACCESS_TOKEN) process.env.FACE_SERVICE_ACCESS_TOKEN = execFileSync("gcloud", ["auth", "print-identity-token"], { encoding: "utf8" }).trim();
const { reprocessProjectFaces } = await import("../src/scripts/reprocessFaces.js");
const projectId = process.argv[2];
if (!projectId) throw new Error("Usage: npm run reprocess:faces -w services/api -- <projectId> (requires Firebase Admin credentials)");
console.log(JSON.stringify(await reprocessProjectFaces(projectId), null, 2));
