import { describe, expect, it } from "vitest";
import { ago, deadlineLabel, greeting, nextDeadline } from "@/lib/dashboard";

const now = Date.parse("2026-10-31T09:00:00Z");
const at = (min: number) => new Date(now + min * 60000).toISOString();

describe("staff dashboard helpers", () => {
  it("finds the nearest open deadline", () => {
    const d = nextDeadline(
      [
        { dueAt: at(30), completedAt: null },
        { dueAt: at(10), completedAt: null },
        { dueAt: at(-50), completedAt: at(-60) },
      ],
      now,
    );
    expect(d).toEqual({ minutes: 10, late: false });
    expect(deadlineLabel(d!)).toBe("متبقي 10 د");
    expect(deadlineLabel(nextDeadline([{ dueAt: at(-90), completedAt: null }], now)!)).toBe(
      "متأخرة 2 س",
    );
    expect(nextDeadline([], now)).toBeNull();
  });
  it("says how long ago", () => {
    expect(ago(at(0), now)).toBe("الآن");
    expect(ago(at(-25), now)).toBe("منذ 25 د");
    expect(ago(at(-60 * 26), now)).toBe("منذ 1 ي");
  });
  it("greets by Riyadh time", () => {
    expect(greeting(new Date("2026-10-31T05:00:00Z"))).toBe("صباح الخير");
    expect(greeting(new Date("2026-10-31T15:00:00Z"))).toBe("مساء الخير");
  });
});
