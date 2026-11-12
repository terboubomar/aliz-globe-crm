import { describe, expect, it } from "vitest";
import {
  isLocalScriptLoadError,
  isStaleModuleError,
  shouldReloadAfterStaleModule,
} from "@/lib/stale-reload";

const BASE = "http://localhost:8080/";

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

describe("isLocalScriptLoadError", () => {
  it("recognises this app's own script files, relative or absolute", () => {
    expect(isLocalScriptLoadError("/@oj-start/client-entry.js", BASE)).toBe(true);
    expect(isLocalScriptLoadError("http://localhost:8080/src/routes/index.tsx", BASE)).toBe(true);
  });

  it("ignores third-party scripts and scripts without a source", () => {
    expect(isLocalScriptLoadError("https://cdn.example.com/analytics.js", BASE)).toBe(false);
    expect(isLocalScriptLoadError("", BASE)).toBe(false);
    expect(isLocalScriptLoadError(undefined, BASE)).toBe(false);
  });
});

describe("shouldReloadAfterStaleModule", () => {
  const now = 1_000_000;

  it("allows the first three reloads inside the window", () => {
    expect(shouldReloadAfterStaleModule([], now)).toBe(true);
    expect(shouldReloadAfterStaleModule([now - 1000], now)).toBe(true);
    expect(shouldReloadAfterStaleModule([now - 2000, now - 1000, now - 500], now)).toBe(true);
  });

  it("stops after three reloads in the same minute", () => {
    expect(shouldReloadAfterStaleModule([now - 3000, now - 2000, now - 1000], now)).toBe(false);
  });

  it("gives a fresh budget once the window has passed", () => {
    expect(
      shouldReloadAfterStaleModule([now - 61_000, now - 60_500, now - 60_001], now),
    ).toBe(true);
  });
});
