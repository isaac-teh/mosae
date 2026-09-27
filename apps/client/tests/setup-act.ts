// React 19.2.x does not export `act` from the main entry, so component tests
// that import `{ act } from "react"` fail with "act is not a function".
// vi.mock is auto-hoisted by vitest above every test file's imports, so this
// patches react before any test module resolves it.
import { vi } from "vitest";

vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  const { act } = await import("react-dom/test-utils");
  return { ...actual, act };
});
