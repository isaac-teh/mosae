import { describe, expect, it } from "vitest";
import { directionFocus } from "./directionFocus";
import type { ChatInput } from "./types";
const person = (personId: string, name: string | null = null, role: string | null = null, skipped = false): NonNullable<ChatInput["people"]>[number] => ({ personId, name, role, skipped, momentCount: 1, sampleShotIds: [], days: [] });
describe("directionFocus", () => {
  it("defaults to the sole named person", () => expect(directionFocus([person("a", "Mia")])).toMatchObject({ selected: "a", label: "Mia" }));
  it("uses contextual aggregate labels", () => {
    expect(directionFocus([])).toMatchObject({ selected: "family", label: "The moments" });
    expect(directionFocus([person("a"), person("b")])).toMatchObject({ selected: "family", label: "Everyone" });
  });
  it("uses a chosen role or neutral fallback and excludes skipped people", () => {
    expect(directionFocus([person("a", null, "parent"), person("b", "Ben", null, true)])).toMatchObject({ selected: "a", label: "Parent" });
    expect(directionFocus([person("a")]).label).toBe("This person");
  });
  it("preserves valid explicit choices across refresh and invalidates merged IDs", () => {
    expect(directionFocus([person("a"), person("b")], "a", true).selected).toBe("a");
    expect(directionFocus([person("b")], "a", true).selected).toBe("b");
    expect(directionFocus([person("a")], "family", true).selected).toBe("family");
  });
});
