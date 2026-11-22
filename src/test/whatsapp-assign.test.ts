import { beforeEach, describe, expect, it, vi } from "vitest";

/* A tiny in-memory stand-in for the database calls the assignment makes. */
type Row = Record<string, unknown>;
const db = {
  users: [] as Row[],
  assignments: [] as Row[],
  upserts: [] as Row[],
};
function query(table: string) {
  let inFilter: { col: string; vals: unknown[] } | null = null;
  let upsert: { row: Row; ignore: boolean } | null = null;
  const q = {
    select: () => q,
    eq: () => q,
    gte: () => q,
    in: (col: string, vals: unknown[]) => ((inFilter = { col, vals }), q),
    upsert: (row: Row, opts: { ignoreDuplicates?: boolean }) => (
      (upsert = { row, ignore: !!opts?.ignoreDuplicates }),
      q
    ),
    delete: () => q,
    then: (done: (r: { data: Row[]; error: null }) => void) => {
      if (table === "user_roles") return done({ data: db.users, error: null });
      if (upsert) {
        db.upserts.push(upsert.row);
        const taken = db.assignments.some(
          (a) => a["conversation_id"] === upsert!.row["conversation_id"],
        );
        if (taken && upsert.ignore) return done({ data: [], error: null });
        db.assignments.push(upsert.row);
        return done({ data: [upsert.row], error: null });
      }
      const rows = inFilter
        ? db.assignments.filter((a) => inFilter!.vals.includes(a[inFilter!.col]))
        : db.assignments;
      return done({ data: rows, error: null });
    },
  };
  return q;
}
const settings = vi.fn(async () => ({ autoAssign: true }));
vi.mock("@/functions/core.server", () => ({
  admin: async () => ({ from: query }),
  settings: () => settings(),
}));
vi.mock("@/functions/crypto.server", () => ({ encrypt: vi.fn(), decrypt: vi.fn() }));
const onShift = vi.fn(async () => new Set<string>(["a1", "a2"]));
vi.mock("@/functions/assign.server", async (load) => ({
  ...(await load<typeof import("@/functions/assign.server")>()),
  onShiftNow: () => onShift(),
}));
const notify = vi.fn(async () => {});
vi.mock("@/functions/telegram.server", () => ({ notifyWhatsappAssigned: notify }));

const conv = (id: number, minutesAgo: number) => ({
  id,
  inbox_id: 7,
  status: "open",
  can_reply: true,
  last_activity_at: Math.floor(Date.now() / 1000) - minutesAgo * 60,
  meta: { sender: { name: "عميل " + id, phone_number: "+9665000000" + id } },
  messages: [],
});
const bevatel = (list: unknown[]) =>
  (async () =>
    new Response(JSON.stringify({ data: { meta: { all_count: list.length }, payload: list } }), {
      status: 200,
    })) as unknown as typeof fetch;

beforeEach(() => {
  vi.stubEnv("BEVATEL_API_TOKEN", "t");
  vi.stubEnv("BEVATEL_ACCOUNT_ID", "3");
  vi.stubEnv("BEVATEL_INBOX_ID", "7");
  db.users = [
    { user_id: "a1", name: "أحمد", role: "AGENT" },
    { user_id: "a2", name: "بدر", role: "AGENT" },
  ];
  db.assignments = [{ conversation_id: "1", assignee: "a1" }];
  db.upserts = [];
  notify.mockClear();
  onShift.mockResolvedValue(new Set(["a1", "a2"]));
  settings.mockResolvedValue({ autoAssign: true });
});

describe("auto-assigning new WhatsApp chats", () => {
  it("gives each unowned chat to the on-shift agent with the fewest open chats, oldest first", async () => {
    const { assignNew } = await import("@/functions/inbox.server");
    const n = await assignNew(bevatel([conv(1, 50), conv(2, 30), conv(3, 5)]));
    expect(n).toBe(2);
    // Chat 2 (older) goes to Badr, who had no open chat; chat 3 then ties and
    // goes by name: Ahmad has 1 open + 1 recent, Badr 1 + 1, so Ahmad.
    expect(db.upserts.map((r) => [r["conversation_id"], r["assignee"], r["assigned_by"]])).toEqual([
      ["2", "a2", "SYSTEM"],
      ["3", "a1", "SYSTEM"],
    ]);
    expect(notify).toHaveBeenCalledWith("2", "a2", "عميل 2");
  });

  it("leaves chats waiting when nobody is on shift", async () => {
    onShift.mockResolvedValue(new Set());
    const { assignNew } = await import("@/functions/inbox.server");
    expect(await assignNew(bevatel([conv(2, 30)]))).toBe(0);
    expect(db.upserts).toHaveLength(0);
  });

  it("follows the auto-assignment switch", async () => {
    settings.mockResolvedValue({ autoAssign: false });
    const { assignNew } = await import("@/functions/inbox.server");
    expect(await assignNew(bevatel([conv(2, 30)]))).toBe(0);
    expect(db.upserts).toHaveLength(0);
  });

  it("does not take a chat another run already assigned", async () => {
    db.assignments.push({ conversation_id: "2", assignee: "a1" });
    const { assignNew } = await import("@/functions/inbox.server");
    expect(await assignNew(bevatel([conv(2, 30)]))).toBe(0);
  });
});
