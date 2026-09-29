import { describe, expect, it } from "vitest";
import { redactImageSource } from "./imageDiagnostic.js";

describe("redactImageSource", () => {
  it("keeps the failing URL path while removing signed query parameters", () => {
    expect(redactImageSource("https://storage.example/bucket/photo.jpg?X-Goog-Signature=secret&token=secret#fragment"))
      .toBe("https://storage.example/bucket/photo.jpg");
  });
});
