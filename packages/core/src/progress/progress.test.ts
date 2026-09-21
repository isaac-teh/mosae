import { describe, expect, it } from "vitest";
import { computeProgress, describeProgress } from "./progress";

describe("computeProgress", () => {
  it("counts ingested and failed assets as done", () => {
    expect(computeProgress({ status: "processing", ingested: 5, failed: 1 }, 10)).toMatchObject({ done: 6, total: 10, failed: 1, ready: false, finished: false });
  });

  it("never reports a total smaller than the work already done", () => {
    expect(computeProgress({ status: "processing", ingested: 12, failed: 0 }, 10).total).toBe(12);
  });

  it("treats a missing project status as still processing", () => {
    expect(computeProgress({ status: null, ingested: 0, failed: 0 }, 3)).toMatchObject({ status: "processing", finished: false });
  });

  it("marks ready and ready_with_errors as ready and finished, and failed as finished only", () => {
    expect(computeProgress({ status: "ready", ingested: 3, failed: 0 }, 3)).toMatchObject({ ready: true, finished: true });
    expect(computeProgress({ status: "ready_with_errors", ingested: 2, failed: 1 }, 3)).toMatchObject({ ready: true, finished: true });
    expect(computeProgress({ status: "failed", ingested: 0, failed: 3 }, 3)).toMatchObject({ ready: false, finished: true });
  });
});

describe("describeProgress", () => {
  const base = { total: 10, done: 4, failed: 0, ready: false, finished: false };

  it("shows how many memories are done while processing", () => {
    expect(describeProgress({ ...base, status: "processing" })).toBe("Getting your memories ready: 4 of 10");
  });

  it("says the memories are ready, and mentions skipped files with correct grammar", () => {
    expect(describeProgress({ ...base, status: "ready", ready: true, finished: true })).toBe("Your memories are ready.");
    expect(describeProgress({ ...base, status: "ready_with_errors", ready: true, finished: true, failed: 1 })).toBe("Your memories are ready. 1 file couldn't be read and was skipped.");
    expect(describeProgress({ ...base, status: "ready_with_errors", ready: true, finished: true, failed: 3 })).toBe("Your memories are ready. 3 files couldn't be read and were skipped.");
  });

  it("asks the user to try again when nothing could be read", () => {
    expect(describeProgress({ ...base, status: "failed", finished: true, failed: 10 })).toBe("We couldn't read any of your files. Please try uploading again.");
  });
});
