import { describe, expect, it } from "vitest";
import { reorderSlots } from "./reorderSlots";

describe("reorderSlots", () => {
  it("moves an item forward without mutating the source", () => {
    const values = ["a", "b", "c", "d"];
    expect(reorderSlots(values, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(values).toEqual(["a", "b", "c", "d"]);
  });

  it("moves an item backward and clamps the target index", () => {
    expect(reorderSlots(["a", "b", "c"], 2, -3)).toEqual(["c", "a", "b"]);
    expect(reorderSlots(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
  });

  it("leaves the order alone for no-op or invalid source indexes", () => {
    expect(reorderSlots(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(reorderSlots(["a", "b"], 4, 0)).toEqual(["a", "b"]);
  });
});
