import { describe, expect, it } from "vitest";
import { isStaleModuleError } from "@/lib/stale-reload";

describe("isStaleModuleError", () => {
  it("matches the stale chunk fetch failure", () => {
    expect(
      isStaleModuleError(
        "Failed to fetch dynamically imported module: https://example.com/src/routes/index.tsx?tsr-split=component",
      ),
    ).toBe(true);
    expect(isStaleModuleError("error loading dynamically imported module")).toBe(true);
  });

  it("ignores ordinary network and app errors", () => {
    expect(isStaleModuleError("Failed to fetch")).toBe(false);
    expect(isStaleModuleError("NetworkError when attempting to fetch resource.")).toBe(false);
    expect(isStaleModuleError("Cannot read properties of null")).toBe(false);
    expect(isStaleModuleError("")).toBe(false);
  });
});
