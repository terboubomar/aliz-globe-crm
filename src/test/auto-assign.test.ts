import { beforeEach, describe, expect, it, vi } from "vitest";

// Automatic assignment: the new complaint goes to the on-shift agent with the
// fewest open cases; with nobody on shift it waits for the next shift.
// Synthetic data only.

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpc: vi.fn(),
  autoAssign: true,
}));

vi.mock("@/functions/core.server", () => {
  const query = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const run = () => (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      gte: (k: string, v: string) => (
        filters.push((r) => +new Date(String(r[k])) >= +new Date(v)),
        q
      ),
      lte: (k: string, v: string) => (
        filters.push((r) => +new Date(String(r[k])) <= +new Date(v)),
        q
      ),
      gt: (k: string, v: string) => (
        filters.push((r) => +new Date(String(r[k])) > +new Date(v)),
        q
      ),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(ok),
    };
    return q;
  };
  return {
    admin: async () => ({ from: query, rpc: db.rpc }),
    settings: async () => ({
      autoAssign: db.autoAssign,
      sla: {
        p1First: 10,
        p1Ack: 15,
        p2First: 30,
        p2Ack: 60,
        p2Remedy: 1440,
        p3First: 60,
        p3Ack: 120,
        p3Remedy: 2880,
      },
    }),
  };
});

import { autoAssign, pickAgent } from "@/functions/assign.server";

const now = new Date("2026-10-28T12:00:00Z");
const agent = (user_id: string, name: string, extra: Row = {}) => ({
  user_id,
  name,
  role: "AGENT",
  enabled: true,
  brand_ids: ["waqf"],
  branch_ids: [],
  ...extra,
});
const openCase = (owner: string, state = "IN_PROGRESS") => ({
  id: crypto.randomUUID(),
  resolution_owner: owner,
  state,
  created_at: "2026-10-20T08:00:00Z",
});
const shift = (user_id: string, extra: Row = {}) => ({
  user_id,
  start_at: "2026-10-28T08:00:00Z",
  end_at: "2026-10-28T16:00:00Z",
  day_off: false,
  cancelled_at: null,
  break_start: null,
  break_end: null,
  ...extra,
});
const NEW_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  db.autoAssign = true;
  db.rpc.mockReset().mockResolvedValue({ error: null });
  db.tables = {
    tickets: [
      {
        id: NEW_ID,
        brand_id: "waqf",
        branch_id: null,
        state: "NEW",
        version: 0,
        priority: "P3",
        received_at: now.toISOString(),
        resolution_owner: null,
        sla_policy: null,
        created_at: now.toISOString(),
      },
    ],
    user_roles: [],
    shifts: [],
  };
});

describe("choosing the agent", () => {
  it("gives the case to the agent with the fewest open cases", () => {
    const c = (id: string, open: number) => ({ id, name: id, open, recent: 0, onShift: true });
    expect(pickAgent([c("a", 3), c("b", 2)])?.id).toBe("b");
    expect(pickAgent([c("a", 3), c("b", 0), c("c", 1)])?.id).toBe("b");
  });

  it("only picks agents on shift, and breaks ties by fewest cases today", () => {
    expect(
      pickAgent([
        { id: "off", name: "a", open: 0, recent: 0, onShift: false },
        { id: "on", name: "b", open: 4, recent: 0, onShift: true },
      ])?.id,
    ).toBe("on");
    expect(
      pickAgent([
        { id: "busy-today", name: "a", open: 1, recent: 5, onShift: true },
        { id: "quiet-today", name: "b", open: 1, recent: 1, onShift: true },
      ])?.id,
    ).toBe("quiet-today");
    expect(pickAgent([{ id: "off", name: "a", open: 0, recent: 0, onShift: false }])).toBeNull();
  });
});

describe("assigning a new complaint", () => {
  it("assigns to the least-loaded agent covering the brand and audits it", async () => {
    db.tables["user_roles"] = [
      agent("a3", "Agent Three"),
      agent("a2", "Agent Two"),
      agent("other-brand", "Other", { brand_ids: ["kabab"] }),
      agent("disabled", "Disabled", { enabled: false }),
    ];
    db.tables["tickets"]!.push(
      openCase("a3"),
      openCase("a3"),
      openCase("a3"),
      openCase("a2"),
      openCase("a2"),
    );
    db.tables["tickets"]!.push(openCase("a2", "CLOSED"), openCase("a2", "RESOLVED"));
    db.tables["shifts"] = [shift("a3"), shift("a2"), shift("other-brand")];
    expect(await autoAssign(NEW_ID, now)).toBe("a2");
    const call = db.rpc.mock.calls[0]![1];
    expect(call).toMatchObject({
      _id: NEW_ID,
      _version: 0,
      _actor: "SYSTEM",
      _events: [{ type: "AUTO_ASSIGNED" }],
      p: { state: "ASSIGNED", resolution_owner: "a2", communications_owner: "a2" },
    });
    expect(call._timers).toHaveLength(1);
    expect(call._timers[0]).toMatchObject({ op: "upsert", milestone: "ACKNOWLEDGMENT" });
  });

  it("waits when nobody is on shift", async () => {
    db.tables["user_roles"] = [agent("a1", "Agent")];
    db.tables["shifts"] = [
      shift("a1", { start_at: "2026-10-28T13:00:00Z", end_at: "2026-10-28T21:00:00Z" }),
    ];
    expect(await autoAssign(NEW_ID, now)).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("restarts every deadline from assignment after waiting for a shift", async () => {
    db.tables["tickets"]![0]!["received_at"] = "2026-10-28T02:00:00Z";
    db.tables["user_roles"] = [agent("a1", "Agent")];
    db.tables["shifts"] = [shift("a1")];
    expect(await autoAssign(NEW_ID, now)).toBe("a1");
    const timers = db.rpc.mock.calls[0]![1]._timers as { milestone: string; due_at: string }[];
    expect(timers.map((t) => t.milestone).sort()).toEqual([
      "ACKNOWLEDGMENT",
      "FIRST_ACTION",
      "REMEDY",
    ]);
    const first = timers.find((t) => t.milestone === "FIRST_ACTION")!;
    expect(first.due_at).toBe(new Date(+now + 60 * 60_000).toISOString());
  });

  it("skips agents on a break or off shift when someone else is working", async () => {
    db.tables["user_roles"] = [
      agent("break", "On break"),
      agent("off", "Off shift"),
      agent("working", "Working"),
    ];
    db.tables["tickets"]!.push(openCase("working"), openCase("working"));
    db.tables["shifts"] = [
      shift("break", { break_start: "2026-10-28T11:30:00Z", break_end: "2026-10-28T12:30:00Z" }),
      shift("working"),
    ];
    expect(await autoAssign(NEW_ID, now)).toBe("working");
  });

  it("leaves the case for a manager when switched off or nobody covers it", async () => {
    db.tables["user_roles"] = [agent("a1", "Agent")];
    db.autoAssign = false;
    expect(await autoAssign(NEW_ID, now)).toBeNull();
    db.autoAssign = true;
    db.tables["user_roles"] = [agent("a1", "Agent", { brand_ids: ["kabab"] })];
    expect(await autoAssign(NEW_ID, now)).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
