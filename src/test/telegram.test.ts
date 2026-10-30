import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Telegram bot: linking with confirmation, staff commands, assignment and new
// complaint alerts, and the hourly reminders. Synthetic data only.

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, enabled: true }));

vi.mock("@/functions/crypto.server", () => ({
  encrypt: async (v: string) => "enc:" + v,
  decrypt: async (v: string) => v.slice(4),
  keyedHash: async (v: string) =>
    createHash("sha256")
      .update("k" + v)
      .digest("hex"),
  randomToken: () => "CODE_" + Math.random().toString(36).slice(2).padEnd(20, "x"),
}));
vi.mock("@/functions/core.server", () => {
  const time = (v: unknown) => Date.parse(String(v));
  const query = (table: string) => {
    const rows = () => (db.tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let head = false;
    let del = false;
    let limit = Infinity;
    const run = () => {
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (del) db.tables[table] = rows().filter((r) => !hit.includes(r));
      return hit.slice(0, limit);
    };
    const q = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
      insert: (r: Row) => {
        if (rows().some((x) => x["key"] !== undefined && x["key"] === r["key"]))
          return Promise.resolve({ error: { message: "duplicate key" } });
        rows().push(r);
        return Promise.resolve({ error: null });
      },
      upsert: (r: Row) => {
        const i = rows().findIndex((x) => x["key"] === r["key"]);
        if (i >= 0) rows()[i] = r;
        else rows().push(r);
        return Promise.resolve({ error: null });
      },
      delete: () => ((del = true), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      not: (k: string, _op: string, v: unknown) => (filters.push((r) => (r[k] ?? null) !== v), q),
      like: (k: string, v: string) => {
        const re = new RegExp(
          "^" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$",
        );
        filters.push((r) => re.test(String(r[k])));
        return q;
      },
      lt: (k: string, v: string) => (filters.push((r) => time(r[k]) < time(v)), q),
      lte: (k: string, v: string) => (filters.push((r) => time(r[k]) <= time(v)), q),
      gt: (k: string, v: string) => (filters.push((r) => time(r[k]) > time(v)), q),
      gte: (k: string, v: string) => (filters.push((r) => time(r[k]) >= time(v)), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => {
        const data = run();
        return Promise.resolve(
          head ? { count: data.length, error: null } : { data, error: null },
        ).then(ok);
      },
    };
    return q;
  };
  return {
    admin: async () => ({ from: query, rpc: async () => ({ error: null }) }),
    settings: async () => ({ telegram: db.enabled }),
    rpcError: (e: { message?: string } | null) => {
      if (e) throw new Error(e.message);
    },
  };
});

import * as tg from "@/functions/telegram.server";

const AGENT = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "Enas",
  role: "AGENT",
  brandIds: ["waqf"],
  branchIds: [],
};
const ADMIN = {
  id: "00000000-0000-4000-8000-00000000000b",
  name: "Omar",
  role: "SUPER_ADMIN",
  brandIds: [],
  branchIds: [],
};
const TICKET = "00000000-0000-4000-8000-0000000000c1";
const sent: { chat_id: string; text: string; reply_markup?: unknown }[] = [];
const msg = (chat: number, text: string, from: Partial<{ username: string }> = {}) => ({
  message: {
    text,
    from: { id: chat, is_bot: false, ...from },
    chat: { id: chat, type: "private" },
  },
});
async function link(actor: typeof AGENT, chat: number) {
  const { url } = await tg.beginLink(actor as never);
  const code = new URL(url).searchParams.get("start")!;
  await tg.handleUpdate(msg(chat, "/start " + code, { username: actor.name.toLowerCase() }));
  const state = await tg.accountState(actor as never);
  await tg.confirmLink(actor as never, state.pending!.fingerprint);
}

beforeEach(() => {
  sent.length = 0;
  db.enabled = true;
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: "123456:" + "A".repeat(30),
    TELEGRAM_BOT_USERNAME: "aliz_crm_bot",
    TELEGRAM_WEBHOOK_SECRET: "s".repeat(40),
    PUBLIC_APP_ORIGIN: "https://crm.example.com",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    }),
  );
  db.tables = {
    outbox: [],
    user_roles: [AGENT, ADMIN].map((a) => ({
      user_id: a.id,
      name: a.name,
      role: a.role,
      enabled: true,
    })),
    brands: [{ id: "waqf", name: "واقف" }],
    branches: [{ id: "b1", name: "العليا" }],
    tickets: [
      {
        id: TICKET,
        sequence: 7,
        created_at: "2026-11-01T09:00:00Z",
        brand_id: "waqf",
        branch_id: "b1",
        priority: "P1",
        category: "DELAY",
        state: "ASSIGNED",
        source: "PUBLIC_QR",
        resolution_owner: AGENT.id,
        received_at: "2026-11-01T09:00:00Z",
      },
    ],
    shifts: [
      {
        id: "s1",
        user_id: AGENT.id,
        start_at: "2026-11-01T09:00:00Z",
        end_at: "2026-11-01T18:00:00Z",
        break_start: "2026-11-01T12:00:00Z",
        break_end: "2026-11-01T13:00:00Z",
        day_off: false,
        lead: false,
        cancelled_at: null,
      },
    ],
    ticket_timers: [],
  };
});

describe("linking", () => {
  it("links only after the person confirms in the CRM, and one chat per person", async () => {
    const { url } = await tg.beginLink(AGENT as never);
    expect(url).toMatch(/^https:\/\/t\.me\/aliz_crm_bot\?start=/);
    const code = new URL(url).searchParams.get("start")!;
    const reply = await tg.handleUpdate(msg(111, "/start " + code, { username: "enas" }));
    expect(reply?.text).toContain("تأكيد الربط");
    let state = await tg.accountState(AGENT as never);
    expect(state.linked).toBe(false);
    expect(state.pending?.label).toBe("@enas");
    // The code works once.
    expect((await tg.handleUpdate(msg(222, "/start " + code)))?.text).toContain("غير صالح");
    await tg.confirmLink(AGENT as never, state.pending!.fingerprint);
    state = await tg.accountState(AGENT as never);
    expect(state.linked).toBe(true);
    // The same Telegram account cannot be linked to someone else.
    const other = await tg.beginLink(ADMIN as never);
    await tg.handleUpdate(msg(111, "/start " + new URL(other.url).searchParams.get("start")));
    const pending = (await tg.accountState(ADMIN as never)).pending!;
    await expect(tg.confirmLink(ADMIN as never, pending.fingerprint)).rejects.toThrow("مستخدم آخر");
  });

  it("refuses to link while the bot is off, and forgets the account on disconnect", async () => {
    db.enabled = false;
    await expect(tg.beginLink(AGENT as never)).rejects.toThrow("غير متاح");
    db.enabled = true;
    await link(AGENT, 111);
    await tg.disconnect(AGENT as never);
    expect((await tg.handleUpdate(msg(111, "/today")))?.text).toContain("غير مرتبط");
  });
});

describe("commands", () => {
  it("answers staff with their own shift and cases, and keeps admin commands for super admins", async () => {
    await link(AGENT, 111);
    const now = new Date("2026-11-01T08:00:00Z");
    expect((await tg.handleUpdate(msg(111, "/today"), now))?.text).toContain("12:00–21:00");
    expect((await tg.handleUpdate(msg(111, "/cases"), now))?.text).toContain("AG-2026-000007");
    expect((await tg.handleUpdate(msg(111, "/summary"), now))?.text).toContain("لمسؤول النظام فقط");
    await link(ADMIN, 999);
    expect((await tg.handleUpdate(msg(999, "/summary"), now))?.text).toContain("مفتوحة الآن: 1");
  });

  it("ignores groups, forwarded and bot messages", async () => {
    await link(AGENT, 111);
    const group = {
      message: {
        text: "/today",
        from: { id: 111, is_bot: false },
        chat: { id: -5, type: "group" },
      },
    };
    expect(await tg.handleUpdate(group)).toBeNull();
    expect(
      await tg.handleUpdate({ message: { ...msg(111, "/today").message, forward_origin: {} } }),
    ).toBeNull();
  });
});

describe("alerts", () => {
  it("tells the owner once, with a link and no customer details", async () => {
    await link(AGENT, 111);
    sent.length = 0;
    await tg.notifyAssigned(TICKET, AGENT.id);
    await tg.notifyAssigned(TICKET, AGENT.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("شكوى عاجلة أُسندت إليك");
    expect(sent[0]!.text).toContain("العليا");
    expect(JSON.stringify(sent[0]!.reply_markup)).toContain(`ticket=${TICKET}`);
  });

  it("tells super admins about new complaints and who got them", async () => {
    await link(ADMIN, 999);
    sent.length = 0;
    await tg.notifyNewComplaint(TICKET);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chat_id).toBe("999");
    expect(sent[0]!.text).toContain("أُسندت تلقائياً إلى: Enas");
  });

  it("sends a shift reminder about an hour before, once, and the 09:00 summary to admins only", async () => {
    await link(AGENT, 111);
    await link(ADMIN, 999);
    sent.length = 0;
    const before = new Date("2026-11-01T08:00:00Z"); // 11:00 Riyadh, shift at 12:00
    await tg.runScheduled(before);
    await tg.runScheduled(before);
    expect(sent.filter((m) => m.text.includes("تذكير"))).toHaveLength(1);
    sent.length = 0;
    await tg.runScheduled(new Date("2026-11-01T06:10:00Z")); // 09:10 Riyadh
    expect(sent.filter((m) => m.text.includes("ملخص")).map((m) => m.chat_id)).toEqual(["999"]);
  });
});
