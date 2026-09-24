/**
 * Regenerate `src/compose/golden/timeline.json` from `golden/input.json`.
 *
 * The golden file is a deliberate artefact: run this only for a change to
 * composition you meant to make, and read the diff before committing it.
 * Usage: npx tsx services/api/scripts/regenGolden.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCompose, type ComposeJob } from "../src/compose/runCompose.js";
import type { Asset } from "../src/compose/buildCandidates.js";
import type { StoryProposal } from "@mosae/contracts";

const here = (name: string) => fileURLToPath(new URL(`../src/compose/golden/${name}`, import.meta.url));

const input = JSON.parse(readFileSync(here("input.json"), "utf8")) as {
  job: Omit<ComposeJob, "proposal">;
  proposal: StoryProposal;
  catalog: Record<string, Asset>;
  response: unknown;
};

const result = await runCompose(
  { ...input.job, proposal: input.proposal },
  {
    generateStructured: async () => input.response,
    soundtrackIds: new Set(["soundtrack-dusk"]),
    assets: new Map(Object.entries(input.catalog)),
  },
);

if (!result.ok) {
  console.error("golden input failed to compose:", result.reasons.join("; "));
  process.exit(1);
}

writeFileSync(here("timeline.json"), `${JSON.stringify(result.timeline, null, 2)}\n`);
console.log("wrote golden/timeline.json");
