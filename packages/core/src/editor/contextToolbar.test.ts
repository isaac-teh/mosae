import { describe, expect, it } from "vitest";
import { contextToolbar } from "./contextToolbar";

describe("contextToolbar", () => {
  it("shows whole-film actions when no clip is selected", () => {
    expect(contextToolbar("none")).toEqual(["Ask"]);
  });

  it("shows remove and replace for a selected photo or video", () => {
    expect(contextToolbar("slot")).toEqual(["Remove", "Replace"]);
  });

  it("shows remove and layout for a selected collage", () => {
    expect(contextToolbar("collage")).toEqual(["Remove", "Layout"]);
  });

  it("shows cell-specific actions while one collage cell is selected", () => {
    expect(contextToolbar("collageCell")).toEqual(["Remove", "ReplaceCell"]);
  });

  it("shows volume and replace for selected audio", () => {
    expect(contextToolbar("audio")).toEqual(["Volume", "Replace"]);
  });
});
