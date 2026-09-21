import { describe, expect, it } from "vitest";
import { DUP_MAX_BITS, groupNearDuplicates, type DupCandidate } from "./duplicates.js";

const same = "00ff00ff00ff00ff";
const photo = (id: string, localTime: string | null, dHash: string | null = same, sharpness = 50): DupCandidate => ({ id, kind: "photo", dHash, sharpness, localTime });

describe("groupNearDuplicates", () => {
  it("groups a burst and makes the sharpest shot the primary", () => {
    const groups = groupNearDuplicates([
      photo("a", "2026-05-03T09:00:00", same, 40),
      photo("b", "2026-05-03T09:00:02", same, 90),
      photo("c", "2026-05-03T09:00:05", same, 60),
    ]);
    expect(groups).toEqual([{ primaryId: "b", memberIds: ["a", "c"] }]);
  });

  it("breaks a sharpness tie by the smaller id", () => {
    expect(groupNearDuplicates([photo("z", "2026-05-03T09:00:00"), photo("m", "2026-05-03T09:00:01")])).toEqual([{ primaryId: "m", memberIds: ["z"] }]);
  });

  it("does not group identical images taken more than ten seconds apart", () => {
    expect(groupNearDuplicates([photo("a", "2026-05-03T09:00:00"), photo("b", "2026-05-03T09:00:11")])).toEqual([]);
  });

  it("does not group different images taken within the window", () => {
    expect(groupNearDuplicates([photo("a", "2026-05-03T09:00:00", "0000000000000000"), photo("b", "2026-05-03T09:00:01", "ffffffffffffffff")])).toEqual([]);
  });

  it("accepts a hash distance of exactly the limit and rejects one bit more", () => {
    expect(DUP_MAX_BITS).toBe(6);
    const base = "0000000000000000";
    const six = "000000000000003f";
    const seven = "000000000000007f";
    expect(groupNearDuplicates([photo("a", "2026-05-03T09:00:00", base), photo("b", "2026-05-03T09:00:01", six)])).toHaveLength(1);
    expect(groupNearDuplicates([photo("a", "2026-05-03T09:00:00", base), photo("b", "2026-05-03T09:00:01", seven)])).toEqual([]);
  });

  it("joins a chain of near-duplicates into one group", () => {
    const groups = groupNearDuplicates([
      photo("a", "2026-05-03T09:00:00", "0000000000000000"),
      photo("b", "2026-05-03T09:00:08", "000000000000003f"),
      photo("c", "2026-05-03T09:00:15", "0000000000000fff"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds.length + 1).toBe(3);
  });

  it("ignores videos, undated photos and photos with no hash", () => {
    const groups = groupNearDuplicates([
      { id: "v", kind: "video", dHash: same, sharpness: 1, localTime: "2026-05-03T09:00:00" },
      photo("u1", null),
      photo("u2", null),
      photo("n1", "2026-05-03T09:00:00", null),
      photo("n2", "2026-05-03T09:00:01", null),
    ]);
    expect(groups).toEqual([]);
  });

  it("returns nothing for a single photo or no photos", () => {
    expect(groupNearDuplicates([photo("a", "2026-05-03T09:00:00")])).toEqual([]);
    expect(groupNearDuplicates([])).toEqual([]);
  });
});
