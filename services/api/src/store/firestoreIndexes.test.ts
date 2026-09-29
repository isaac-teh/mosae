import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Index = {
  collectionGroup: string;
  queryScope: string;
  fields: { fieldPath: string; order?: string; arrayConfig?: string }[];
};

describe("Firestore composite indexes", () => {
  it("covers every API query that combines filters and ordering", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "../../firestore.indexes.json"), "utf8")) as { indexes: Index[] };
    const indexKey = (index: Index) => JSON.stringify(index);
    const actual = new Set(config.indexes.map(indexKey));
    const required: Index[] = [
      {
        collectionGroup: "taskOutbox",
        queryScope: "COLLECTION_GROUP",
        fields: [
          { fieldPath: "state", order: "ASCENDING" },
          { fieldPath: "updatedAt", order: "ASCENDING" },
        ],
      },
      {
        collectionGroup: "shots",
        queryScope: "COLLECTION_GROUP",
        fields: [
          { fieldPath: "assetId", order: "ASCENDING" },
          { fieldPath: "index", order: "ASCENDING" },
        ],
      },
    ];

    for (const index of required) expect(actual, `missing index: ${JSON.stringify(index)}`).toContain(indexKey(index));
  });
});
