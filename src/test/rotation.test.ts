import { describe, expect, it } from "vitest";
import {
  assignmentFor,
  coverage,
  defaultPlan,
  weekEntries,
  type RotationPlan,
} from "@/lib/rotation";

// Weekly rotation: shifts and days off move every week, nobody's days are
// overwritten, and night shifts never clash with the next day off.

const plan = (members: string[], over: Partial<RotationPlan> = {}): RotationPlan => ({
  ...defaultPlan("2026-11-01"),
  enabled: true,
  members,
  ...over,
});
const team = ["a", "b", "c", "d"];

describe("rotation", () => {
  it("moves everyone to the next shift each week", () => {
    const p = plan(team);
    expect(team.map((_, i) => assignmentFor(p, i, 0).shift.id)).toEqual([
      "morning",
      "evening",
      "morning",
      "evening",
    ]);
    expect(team.map((_, i) => assignmentFor(p, i, 1).shift.id)).toEqual([
      "evening",
      "morning",
      "evening",
      "morning",
    ]);
    expect(assignmentFor(p, 0, 2).shift.id).toBe("morning");
  });

  it("spreads days off across the team and moves them a day each week", () => {
    const p = plan(["a", "b", "c", "d", "e", "f", "g"]);
    const week0 = p.members.map((_, i) => assignmentFor(p, i, 0).offDays[0]);
    expect(new Set(week0).size).toBe(7);
    expect(assignmentFor(p, 0, 1).offDays).toEqual([(week0[0]! + 1) % 7]);
    const two = plan(team, { daysOff: 2 });
    expect(assignmentFor(two, 0, 0).offDays).toHaveLength(2);
  });

  it("builds a full week: 6 shifts and 1 day off per person", () => {
    const { entries } = weekEntries(plan(team), "2026-11-01");
    for (const id of team) {
      const own = entries.filter((e) => e.userId === id);
      expect(own).toHaveLength(7);
      expect(own.filter((e) => e.dayOff)).toHaveLength(1);
    }
    const morning = entries.find((e) => e.userId === "a" && !e.dayOff)!;
    expect(new Date(morning.start).toISOString()).toMatch(/T07:00:00/); // 10:00 Riyadh
    expect(morning.breakStart).not.toBeNull();
  });

  it("never overlaps a night shift with the next day off", () => {
    for (let w = 0; w < 7; w++) {
      const sunday = new Date(Date.parse("2026-11-01T12:00:00Z") + w * 7 * 864e5)
        .toISOString()
        .slice(0, 10);
      const all = [
        ...weekEntries(
          plan(team),
          new Date(Date.parse(sunday + "T12:00:00Z") - 7 * 864e5).toISOString().slice(0, 10),
        ).entries,
        ...weekEntries(plan(team), sunday).entries,
      ];
      for (const id of team) {
        const own = all
          .filter((e) => e.userId === id)
          .sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
        for (let i = 1; i < own.length; i++)
          expect(Date.parse(own[i]!.start)).toBeGreaterThanOrEqual(Date.parse(own[i - 1]!.end));
      }
    }
  });

  it("leaves days that already have a shift untouched", () => {
    const busy = (userId: string, from: string) => userId === "a" && from.startsWith("2026-11-02");
    const { entries, skipped } = weekEntries(plan(team), "2026-11-01", busy);
    expect(skipped).toEqual([{ userId: "a", day: "2026-11-02" }]);
    expect(entries.filter((e) => e.userId === "a")).toHaveLength(6);
  });

  it("marks leads only on working days, and reports coverage per shift", () => {
    const { entries } = weekEntries(plan(team, { leads: ["b"] }), "2026-11-01");
    expect(entries.filter((e) => e.userId === "b" && e.lead)).toHaveLength(6);
    expect(entries.some((e) => e.userId === "b" && e.dayOff && e.lead)).toBe(false);
    const cov = coverage(plan(["a"]), "2026-11-01");
    expect(cov.some((c) => c.shiftId === "evening" && c.count === 0)).toBe(true);
  });
});
