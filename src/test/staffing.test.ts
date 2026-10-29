import { describe, expect, it } from "vitest";
import { assignmentFor, defaultPlan, weekEntries } from "@/lib/rotation";
import { designShifts, generate, recommendedTeam, window } from "@/lib/staffing";

// Schedule generator: team size + hours + opening hours + peak -> shifts and a
// rotation with one day off a week. Peak 20:00-01:00 as the business set it.
const base = { hours: 8, open: "12:00", close: "02:00", peakStart: "20:00", peakEnd: "01:00" };

describe("schedule generator", () => {
  it("handles closing and peak after midnight", () => {
    expect(window(base)).toEqual({ open: 720, close: 1560, peakStart: 1200, peakEnd: 1500 });
  });

  it("covers opening to closing with 8-hour shifts and breaks outside the peak", () => {
    const { shifts, slots } = designShifts({ ...base, employees: 6 });
    expect(shifts[0]!.start).toBe("12:00");
    expect(shifts.at(-1)!.end).toBe("02:00");
    expect(slots).toHaveLength(6);
    for (const s of shifts) {
      expect(s.breakStart).toBeTruthy();
      const h = Number(s.breakStart!.slice(0, 2));
      expect(h >= 20 || h < 1).toBe(false);
    }
  });

  it("puts more people in the peak than at opening, with 1 day off each", () => {
    const g = generate({ ...base, employees: 6 }, []);
    const at = (t: string) => g.rows.find((r) => r.time === t)!;
    expect(at("21:00").avg).toBeGreaterThan(at("13:00").avg);
    expect(g.uncovered).toEqual([]);
    expect(g.thinPeak).toEqual([]);
  });

  it("recommends a minimum team and flags gaps when the team is too small", () => {
    const min = recommendedTeam(base)!;
    expect(min).toBeGreaterThan(1);
    expect(generate({ ...base, employees: min - 1 }, []).uncovered.length).toBeGreaterThan(0);
  });

  it("rotates people through the generated shifts each week", () => {
    const { shifts, slots } = designShifts({ ...base, employees: 6 });
    const plan = {
      ...defaultPlan("2026-11-01"),
      shifts,
      slots,
      members: ["a", "b", "c", "d", "e", "f"],
    };
    const seen = new Set([0, 1, 2, 3, 4, 5].map((w) => assignmentFor(plan, 0, w).shift.id));
    expect(seen.size).toBe(shifts.length);
    // The peak-weighted spread holds every week.
    for (const w of [0, 3]) {
      const ids = plan.members.map((_, i) => assignmentFor(plan, i, w).shift.id).sort();
      expect(ids).toEqual([...slots].sort());
    }
    const { entries } = weekEntries(plan, "2026-11-01");
    expect(entries.filter((e) => e.userId === "a" && e.dayOff)).toHaveLength(1);
  });
});
