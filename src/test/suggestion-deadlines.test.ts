import { describe, expect, it } from "vitest";
import { hasDeadlines } from "@/lib/domain";

describe("deadlines", () => {
  it("apply to complaints but not to customer suggestions", () => {
    expect(hasDeadlines("DELAY")).toBe(true);
    expect(hasDeadlines("C_K3M9Q2")).toBe(true);
    expect(hasDeadlines("SUGGESTION")).toBe(false);
  });
});
