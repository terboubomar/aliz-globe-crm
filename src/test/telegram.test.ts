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
    catalog: async () => (await import("@/lib/catalog")).toCatalog(undefined, undefined),
    rpcError: (e: { message?: string } | null) => {
      if (e) throw new Error(e.message);
    },
  };
});

const actions = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/functions/tickets.server", () => ({
  ticketActionCore: async (...args: unknown[]) => {
    actions.calls.push(args);
    return { ok: true };
  },
}));

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
const sent: {
  chat_id: string;
  text: string;
  reply_markup?: unknown;
  message_id?: number;
  method: string;
}[] = [];
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
  actions.calls.length = 0;
  db.enabled = true;
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: "123456:" + "A".repeat(30),
    TELEGRAM_BOT_USERNAME: "aliz_crm_bot",
    TELEGRAM_WEBHOOK_SECRET: "s".repeat(40),
    PUBLIC_APP_ORIGIN: "https://crm.example.com",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      sent.push({ ...JSON.parse(init.body), method: url.split("/").pop() });
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
        acknowledged_at: null,
        version: 3,
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
    expect((await tg.handleUpdate(msg(111, "/cases"), now))?.text).toContain("<code>7</code>");
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

  it("sends the 09:00 summary to admins only, and a shift reminder within the hour before, once", async () => {
    await link(AGENT, 111);
    await link(ADMIN, 999);
    sent.length = 0;
    await tg.runScheduled(new Date("2026-11-01T06:10:00Z")); // 09:10 Riyadh
    expect(sent.filter((m) => m.text.includes("ملخص")).map((m) => m.chat_id)).toEqual(["999"]);
    expect(sent.filter((m) => m.text.includes("تذكير"))).toHaveLength(0);
    sent.length = 0;
    const before = new Date("2026-11-01T08:00:00Z"); // 11:00 Riyadh, shift at 12:00
    await tg.runScheduled(before);
    await tg.runScheduled(before);
    expect(sent.filter((m) => m.text.includes("تذكير"))).toHaveLength(1);
    expect(sent.filter((m) => m.text.includes("ملخص"))).toHaveLength(0);
  });
});

const press = (chat: number, data: string) => ({
  callback_query: {
    id: "cb1",
    data,
    from: { id: chat, is_bot: false },
    message: { message_id: 42, chat: { id: chat, type: "private" } },
  },
});

describe("received button", () => {
  it("starts work on the owner's own complaint, as that person", async () => {
    await link(AGENT, 111);
    await tg.notifyAssigned(TICKET, AGENT.id);
    expect(JSON.stringify(sent.at(-1)!.reply_markup)).toContain(`ack:${TICKET}`);
    sent.length = 0;
    const r = await tg.handleUpdate(press(111, "ack:" + TICKET));
    expect(r?.method).toBe("answerCallbackQuery");
    expect(r?.text).toContain("تم الاستلام");
    expect(actions.calls).toHaveLength(1);
    const [, actor, id, action, body] = actions.calls[0]!;
    expect((actor as { id: string }).id).toBe(AGENT.id);
    expect([id, action, (body as { version: number }).version]).toEqual([TICKET, "start", 3]);
    // The button is removed, the open link stays.
    const edit = sent.find((m) => m.method === "editMessageReplyMarkup")!;
    expect(edit.message_id).toBe(42);
    expect(JSON.stringify(edit.reply_markup)).not.toContain("ack:");
  });

  it("refuses anyone who is not the owner, unlinked chats and unknown buttons", async () => {
    await link(ADMIN, 999);
    expect((await tg.handleUpdate(press(999, "ack:" + TICKET)))?.text).toContain(
      "لم تعد مسندة إليك",
    );
    expect((await tg.handleUpdate(press(555, "ack:" + TICKET)))?.text).toContain("غير مرتبط");
    expect((await tg.handleUpdate(press(999, "close:" + TICKET)))?.text).toBe("");
    expect(actions.calls).toHaveLength(0);
  });
});

describe("menu and admin tools", () => {
  it("shows menu buttons, answers them like commands, and escapes names", async () => {
    db.tables["brands"] = [{ id: "waqf", name: "<b>واقف</b>" }];
    await link(AGENT, 111);
    const help = await tg.handleUpdate(msg(111, "/help"));
    const keys = JSON.stringify(help?.["reply_markup"]);
    expect(keys).toContain("📋 شكاواي");
    expect(keys).not.toContain("بدون مسؤول");
    const cases = await tg.handleUpdate(msg(111, "📋 شكاواي"));
    expect(cases?.text).toContain("<code>7</code>");
    expect(cases?.text).toContain("&lt;b&gt;واقف");
    expect(JSON.stringify(cases?.["reply_markup"])).toContain(`ticket=${TICKET}`);
    expect(cases?.["parse_mode"]).toBe("HTML");
  });

  it("lists unassigned complaints and sends a test message for super admins only", async () => {
    await link(AGENT, 111);
    await link(ADMIN, 999);
    expect((await tg.handleUpdate(msg(111, "/unassigned")))?.text).toContain("لمسؤول النظام فقط");
    expect((await tg.handleUpdate(msg(999, "📥 بدون مسؤول")))?.text).toContain("لها مسؤول");
    db.tables["tickets"]![0]!["resolution_owner"] = null;
    expect((await tg.handleUpdate(msg(999, "/unassigned")))?.text).toContain("<code>7</code>");
    const help = await tg.handleUpdate(msg(999, "/help"));
    expect(JSON.stringify(help?.["reply_markup"])).toContain("بدون مسؤول");
    sent.length = 0;
    await tg.testMessage(ADMIN as never);
    expect(sent[0]!.chat_id).toBe("999");
    expect(sent[0]!.text).toContain("رسالة تجريبية");
    await tg.disconnect(ADMIN as never);
    await expect(tg.testMessage(ADMIN as never)).rejects.toThrow("اربط حسابك");
  });
});

describe("deadlines", () => {
  it("warns the owner before the deadline, then the owner and admins once it is missed", async () => {
    await link(AGENT, 111);
    await link(ADMIN, 999);
    db.tables["ticket_timers"] = [
      {
        ticket_id: TICKET,
        milestone: "ACKNOWLEDGMENT",
        warning_at: "2026-11-01T09:12:00Z",
        due_at: "2026-11-01T09:15:00Z",
        completed_at: null,
      },
    ];
    sent.length = 0;
    const warn = new Date("2026-11-01T09:13:00Z");
    await tg.runScheduled(warn);
    await tg.runScheduled(warn);
    const warned = sent.filter((m) => m.text?.includes("اقتربت مهلة"));
    expect(warned.map((m) => m.chat_id)).toEqual(["111"]);
    sent.length = 0;
    await tg.runScheduled(new Date("2026-11-01T09:20:00Z"));
    await tg.runScheduled(new Date("2026-11-01T09:30:00Z"));
    const late = sent.filter((m) => m.text?.includes("تجاوزت"));
    expect(late.map((m) => m.chat_id).sort()).toEqual(["111", "999"]);
    expect(late.find((m) => m.chat_id === "999")!.text).toContain("المسؤول: Enas");
    // Once the deadline is met, nothing more is sent.
    db.tables["ticket_timers"]![0]!["completed_at"] = "2026-11-01T09:40:00Z";
    db.tables["ticket_timers"]![0]!["due_at"] = "2026-11-01T09:45:00Z";
    sent.length = 0;
    await tg.runScheduled(new Date("2026-11-01T09:50:00Z"));
    expect(sent.filter((m) => m.text?.includes("مهلة"))).toHaveLength(0);
  });
});

describe("sending the weekly schedule", () => {
  // 2026-11-01 is a Sunday; "now" is that morning.
  const now = new Date("2026-11-01T05:00:00Z");
  it("sends each person their own week on demand and reports who is not linked", async () => {
    await link(AGENT, 111);
    sent.length = 0;
    db.tables["shifts"]!.push({
      id: "s2",
      user_id: ADMIN.id,
      start_at: "2026-11-02T09:00:00Z",
      end_at: "2026-11-02T18:00:00Z",
      break_start: null,
      break_end: null,
      day_off: false,
      lead: false,
      cancelled_at: null,
    });
    const r = await tg.sendWeek("2026-11-01", "manual", now);
    expect(r).toEqual({ sent: 1, scheduled: 2, notLinked: ["Omar"] });
    expect(sent[0]!.chat_id).toBe("111");
    expect(sent[0]!.text).toContain("جدول جديد");
    expect(sent[0]!.text).toContain("12:00–21:00");
    expect(sent[0]!.text).not.toContain("Omar");
    // Pressing the button again sends again.
    expect((await tg.sendWeek("2026-11-01", "manual", now)).sent).toBe(1);
    await expect(tg.sendWeek("2026-10-18", "manual", now)).rejects.toThrow("انتهى");
  });

  it("sends a generated schedule once, and again only when it changes", async () => {
    await link(AGENT, 111);
    sent.length = 0;
    expect((await tg.sendWeek("2026-11-01", "auto", now)).sent).toBe(1);
    expect((await tg.sendWeek("2026-11-01", "auto", now)).sent).toBe(0);
    db.tables["shifts"]![0]!["end_at"] = "2026-11-01T19:00:00Z";
    expect((await tg.sendWeek("2026-11-01", "auto", now)).sent).toBe(1);
    expect(sent.at(-1)!.text).toContain("تم تحديث جدولك");
  });

  it("skips Saturday's reminder when the same schedule went out that day", async () => {
    await link(AGENT, 111);
    db.tables["shifts"]![0]!["start_at"] = "2026-11-08T09:00:00Z";
    db.tables["shifts"]![0]!["end_at"] = "2026-11-08T18:00:00Z";
    const saturday = new Date("2026-11-07T17:30:00Z"); // 20:30 Riyadh
    await tg.sendWeek("2026-11-08", "auto", new Date("2026-11-07T10:00:00Z"));
    sent.length = 0;
    await tg.runScheduled(saturday);
    expect(sent.filter((m) => m.text?.includes("جدولك"))).toHaveLength(0);
  });
});

describe("custom wording", () => {
  it("uses the super admin's wording, escaped, with the extra line", async () => {
    tg.clearWordsCache();
    db.tables["app_settings"] = [
      {
        key: "telegram_templates",
        value: {
          assigned: "شكوى لك <عاجل>",
          assignedUrgent: "عاجلة جداً",
          assignedNote: "استلمها خلال 10 دقائق",
        },
      },
    ];
    await link(AGENT, 111);
    sent.length = 0;
    await tg.notifyAssigned(TICKET, AGENT.id);
    expect(sent[0]!.text).toContain("<b>عاجلة جداً</b>");
    expect(sent[0]!.text).toContain("استلمها خلال 10 دقائق");
    db.tables["tickets"]![0]!["priority"] = "P3";
    db.tables["tickets"]![0]!["state"] = "ACKNOWLEDGED";
    await tg.notifyAssigned(TICKET, AGENT.id);
    expect(sent[1]!.text).toContain("شكوى لك &lt;عاجل&gt;");
    tg.clearWordsCache();
  });
});
