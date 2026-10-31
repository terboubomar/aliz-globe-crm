import { describe, expect, it } from "vitest";
import { trackMessage, trackStep } from "@/lib/tracking-steps";

describe("customer tracking steps", () => {
  it("maps the team's states to four steps", () => {
    expect(trackStep("NEW")).toEqual({ step: 0, finished: false });
    expect(trackStep("ASSIGNED").step).toBe(1);
    expect(trackStep("IN_PROGRESS").step).toBe(2);
    expect(trackStep("RESOLVED")).toEqual({ step: 3, finished: false });
    expect(trackStep("CLOSED")).toEqual({ step: 3, finished: true });
    expect(trackStep("SOMETHING_NEW").step).toBe(0);
  });
  it("gives a plain message", () => {
    expect(trackMessage("CLOSED").tone).toBe("done");
    expect(trackMessage("ACKNOWLEDGED").title).toContain("نعمل");
  });
});
