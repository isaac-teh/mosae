import { reprocessProjectFaces } from "./reprocessFaces.js";

const projectId = process.env.REPROCESS_PROJECT_ID ?? process.argv[2];
if (!projectId) throw new Error("Usage: reprocessFacesJob <projectId>");
console.log(JSON.stringify(await reprocessProjectFaces(projectId), null, 2));
