import { beforeEach, describe, expect, it, vi } from "vitest";

// Applying an uploaded template: it must actually save shifts (it used to save
// nothing because a template has no generator shift patterns), and "replace"
// must clear the old schedule from that week onward but never past shifts.

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, saved: [] as Row[] }));

vi.mock("@/functions/core.server", () => {
  const query = (table: string) => {
    const rows = () => (db.tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const run = () => {
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (patch) hit.forEach((r) => Object.assign(r, patch));
      return hit;
    };
    const time = (v: unknown) => Date.parse(String(v));
    const q = {
      select: () => q,
      update: (p: Row) => ((patch = p), q),
      upsert: (r: Row) => {
        const i = rows().findIndex((x) => x["key"] === r["key"]);
        if (i >= 0) rows()[i] = r;
        else rows().push(r);
        return Promise.resolve({ error: null });
      },
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      lt: (k: string, v: string) => (filters.push((r) => time(r[k]) < time(v)), q),
      gt: (k: string, v: string) => (filters.push((r) => time(r[k]) > time(v)), q),
      gte: (k: string, v: string) => (filters.push((r) => time(r[k]) >= time(v)), q),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok),
    };
    return q;
  };
  const rpc = async (name: string, args: { _entries?: Row[] }) => {
    if (name === "save_shifts_tx") {
      for (const e of args._entries ?? []) {
        const clash = (db.tables["shifts"] ?? []).some(
          (s) =>
            !s["cancelled_at"] &&
            s["user_id"] === e["user_id"] &&
            Date.parse(String(s["start_at"])) < Date.parse(String(e["end_at"])) &&
            Date.parse(String(s["end_at"])) > Date.parse(String(e["start_at"])),
        );
        if (clash)
          return {
            data: null,
            error: { message: "conflicting key value violates exclusion constraint" },
          };
      }
      for (const e of args._entries ?? [])
        (db.tables["shifts"] ??= []).push({ ...e, cancelled_at: null });
      db.saved.push(...(args._entries ?? []));
      return { data: args._entries?.length ?? 0, error: null };
    }
    return { data: null, error: null };
  };
  return {
    admin: async () => ({ from: query, rpc }),
    rpcError: (e: { message?: string } | null) => {
      if (e) throw new Error(e.message);
    },
    settings: async () => ({}),
  };
});

import { clearFrom, generateWeek } from "@/functions/rotation.server";
import type { RotationPlan } from "@/lib/rotation";

const SUN = "2026-11-01";
const shift = (user_id: string, start: string, end: string) => ({
  user_id,
  start_at: start,
  end_at: end,
  cancelled_at: null,
});
const plan: RotationPlan & { updatedBy: string } = {
  enabled: true,
  shifts: [],
  members: ["enas", "aljaouhara"],
  daysOff: 1,
  anchor: SUN,
  weeksAhead: 2,
  updatedBy: "00000000-0000-4000-8000-000000000001",
  template: {
    rotate: false,
    rows: [
      {
        userId: "enas",
        lead: false,
        days: Array(7).fill({
          start: "12:00",
          end: "21:00",
          breakStart: "15:00",
          breakEnd: "16:00",
        }),
      },
      {
        userId: "aljaouhara",
        lead: false,
        days: Array(7).fill({
          start: "17:00",
          end: "02:00",
          breakStart: "18:00",
          breakEnd: "19:00",
        }),
      },
    ],
  },
};

beforeEach(() => {
  db.saved = [];
  db.tables = {
    app_settings: [],
    // Left over from the generator: an evening shift on Sunday of that week.
    shifts: [shift("aljaouhara", "2026-11-01T15:00:00Z", "2026-11-01T23:00:00Z")],
  };
});

describe("applying a template", () => {
  it("saves the template's shifts (it used to save nothing)", async () => {
    const r = await generateWeek(plan, SUN, plan.updatedBy);
    expect(r.saved).toBe(13);
    expect(r.skipped).toBe(1);
    expect(db.saved.filter((e) => e["user_id"] === "enas")).toHaveLength(7);
  });

  it("replaces the old schedule from that week onward, never the past", async () => {
    db.tables["shifts"]!.push(shift("aljaouhara", "2026-10-25T15:00:00Z", "2026-10-25T23:00:00Z"));
    const cleared = await clearFrom(plan, SUN, plan.updatedBy, new Date("2026-10-29T12:00:00Z"));
    expect(cleared).toBe(1);
    const r = await generateWeek(plan, SUN, plan.updatedBy);
    expect(r).toEqual({ saved: 14, skipped: 0, notified: 0 });
    const past = db.tables["shifts"]!.find((s) => s["start_at"] === "2026-10-25T15:00:00Z")!;
    expect(past["cancelled_at"]).toBeNull();
  });
});
