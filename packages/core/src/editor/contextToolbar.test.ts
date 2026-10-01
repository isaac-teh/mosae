import { describe, expect, it } from "vitest";
import { contextToolbar } from "./contextToolbar";

describe("contextToolbar", () => {
  it("shows whole-film actions when no clip is selected", () => {
    expect(contextToolbar("none")).toEqual(["Music", "Add", "Ask"]);
  });

  it("shows slot actions and deselect for a selected photo or video", () => {
    expect(contextToolbar("slot")).toEqual(["Deselect", "Replace", "Duplicate", "Ask", "Delete"]);
  });

  it("shows collage layout and motion actions without Ask", () => {
    expect(contextToolbar("collage")).toEqual(["Deselect", "Layout", "Motion", "Duplicate", "Delete"]);
  });
});
