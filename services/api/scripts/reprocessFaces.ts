import { execFileSync } from "node:child_process";

if (!process.env.FACE_SERVICE_ACCESS_TOKEN) process.env.FACE_SERVICE_ACCESS_TOKEN = execFileSync("gcloud", ["auth", "print-identity-token"], { encoding: "utf8" }).trim();
const { reprocessProjectFaces } = await import("../src/scripts/reprocessFaces.js");
const projectId = process.argv[2];
const allowConfirmedCast = process.argv.includes("--allow-confirmed-cast");
if (!projectId) throw new Error("Usage: npm run reprocess:faces -w services/api -- <projectId> [--allow-confirmed-cast] (requires Firebase Admin credentials)");
console.log(JSON.stringify(await reprocessProjectFaces(projectId, { allowConfirmedCast }), null, 2));
