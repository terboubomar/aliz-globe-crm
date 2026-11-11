import { beforeEach, describe, expect, it, vi } from "vitest";

// Customer receipts over WhatsApp and email. The database is an in-memory fake of
// the few query shapes receipts.server.ts uses; crypto is identity so payloads can
// be inspected. Synthetic data only.

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  settings: { whatsapp: true, emailReceipts: true },
}));

vi.mock("@/functions/crypto.server", () => ({
  decrypt: async (v: string) => v,
  encrypt: async (v: string) => v,
  keyedHash: async (v: string) => "h:" + v,
  sha256: async (v: string) => "s:" + v,
}));
vi.mock("@/functions/core.server", () => {
  type F = (r: Row) => boolean;
  const query = (table: string) => {
    const rows = () => (db.tables[table] ??= []);
    const filters: F[] = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let countOnly = false;
    let limit = Infinity;
    const run = () => {
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") hit.forEach((r) => Object.assign(r, patch));
      return hit.slice(0, limit);
    };
    const q = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => {
        countOnly = !!o?.head;
        return q;
      },
      insert: (r: Row) => {
        const dup = r["key"] !== undefined && rows().some((x) => x["key"] === r["key"]);
        const row = { id: `row-${rows().length + 1}`, created_at: new Date().toISOString(), ...r };
        if (!dup) rows().push(row);
        const res = { error: dup ? { message: "duplicate" } : null };
        return Object.assign(Promise.resolve(res), {
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: dup ? null : row, error: res.error }),
          }),
        });
      },
      upsert: (r: Row) => {
        const i = rows().findIndex((x) => x["key"] === r["key"]);
        if (i >= 0) rows()[i] = r;
        else rows().push(r);
        return Promise.resolve({ error: null });
      },
      update: (p: Row) => {
        op = "update";
        patch = p;
        return q;
      },
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      not: (k: string) => (filters.push((r) => r[k] != null), q),
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), q),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      like: (k: string, v: string) => {
        const re = new RegExp(
          "^" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$",
        );
        filters.push((r) => re.test(String(r[k])));
        return q;
      },
      gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), q),
      lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => {
        const data = run();
        return Promise.resolve(
          countOnly ? { count: data.length, error: null } : { data, error: null },
        ).then(ok);
      },
    };
    return q;
  };
  return {
    admin: async () => ({ from: query }),
    settings: async () => db.settings,
  };
});

import {
  applyWhatsAppStatuses,
  emailContent,
  missingConfig,
  queueAndSend,
  queueUpdate,
  runQueue,
} from "@/functions/receipts.server";

const receipt = {
  number: "AG-2026-000007",
  brand: "واقف",
  branch: "فرع الاختبار",
  receivedAt: "2026-10-28T08:00:00Z",
  category: "تأخير",
  description: "الطلب وصل متأخر <b>جداً</b>",
  customerName: "",
  externalOrder: "",
  platform: "",
  source: "QR",
  trackingPath: "/track/abcdefghijklmnopqrstuvwx",
};
let n = 0;
function ticket(phone = "966500000001", email = "customer@example.invalid") {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  (db.tables["tickets"] ??= []).push({
    id,
    receipt_enc: JSON.stringify(receipt),
    customer_enc: JSON.stringify({ name: "", phone, email }),
    phone_hash: "h:phone:" + phone,
  });
  return id;
}
const outbox = (key: string) => db.tables["outbox"]?.find((r) => r["key"] === key);
const reply = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const config = {
  PUBLIC_APP_ORIGIN: "https://crm.example.com",
  WHATSAPP_ACCESS_TOKEN: "test-token",
  WHATSAPP_PHONE_NUMBER_ID: "123456",
  WHATSAPP_APP_SECRET: "test-secret",
  WHATSAPP_VERIFY_TOKEN: "test-verify",
  WHATSAPP_TEMPLATE_NAME: "aliz_complaint_received",
  WHATSAPP_TEMPLATE_APPROVED: "true",
  LOVABLE_API_KEY: "test-key",
  EMAIL_SENDER_DOMAIN: "notify.example.com",
};
beforeEach(() => {
  for (const k of [
    "BEVATEL_API_TOKEN",
    "BEVATEL_BASE_URL",
    "BEVATEL_ACCOUNT_ID",
    "BEVATEL_INBOX_ID",
  ])
    delete process.env[k];
  db.tables = {};
  db.settings = { whatsapp: true, emailReceipts: true };
  for (const [k, v] of Object.entries(config)) process.env[k] = v;
});

describe("configuration", () => {
  it("lists what is missing by name, and needs an approved template", () => {
    expect(missingConfig("whatsapp")).toEqual([]);
    delete process.env["WHATSAPP_TEMPLATE_APPROVED"];
    process.env["PUBLIC_APP_ORIGIN"] = "http://localhost:3000";
    expect(missingConfig("whatsapp")).toEqual([
      "PUBLIC_HTTPS_APP_ORIGIN",
      "WHATSAPP_TEMPLATE_APPROVED",
    ]);
    delete process.env["EMAIL_SENDER_DOMAIN"];
    expect(missingConfig("email")).toContain("EMAIL_SENDER_DOMAIN");
  });

  it("holds the request without sending while a channel is off", async () => {
    db.settings.whatsapp = false;
    const fetcher = reply(200);
    const id = ticket();
    expect(await queueAndSend(id, { whatsapp: "966500000001" }, fetcher)).toEqual({
      whatsapp: "NOT_CONFIGURED",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(outbox(`receipt:whatsapp:${id}`)?.["status"]).toBe("HELD_PROVIDER_NOT_CONFIGURED");
  });
});

describe("WhatsApp receipt", () => {
  it("sends the approved template with the complaint details and tracking link", async () => {
    const fetcher = reply(200, { messages: [{ id: "wamid.1" }] });
    const id = ticket();
    expect(await queueAndSend(id, { whatsapp: "966500000001" }, fetcher)).toEqual({
      whatsapp: "ACCEPTED",
    });
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v23.0/123456/messages");
    const body = JSON.parse(init.body);
    expect(body.to).toBe("966500000001");
    expect(body.template.name).toBe("aliz_complaint_received");
    const params = Object.fromEntries(
      body.template.components[0].parameters.map((p: { parameter_name: string; text: string }) => [
        p.parameter_name,
        p.text,
      ]),
    );
    expect(params).toMatchObject({
      number: "AG-2026-000007",
      brand: "واقف",
      order: "غير محدد",
      tracking_url: "https://crm.example.com/track/abcdefghijklmnopqrstuvwx",
    });
    expect(outbox(`receipt:whatsapp:${id}`)?.["status"]).toBe("ACCEPTED");
  });

  it("retries a rate-limited send twice, then gives up", async () => {
    const id = ticket();
    const busy = reply(429);
    expect((await queueAndSend(id, { whatsapp: "966500000001" }, busy)).whatsapp).toBe("QUEUED");
    await runQueue(busy);
    expect(outbox(`receipt:whatsapp:${id}`)?.["status"]).toBe("QUEUED_RETRY_2");
    await runQueue(busy);
    expect(outbox(`receipt:whatsapp:${id}`)?.["status"]).toBe("FAILED");
    expect(busy).toHaveBeenCalledTimes(3);
  });

  it("never resends when the outcome is unknown", async () => {
    const id = ticket();
    const dropped = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect((await queueAndSend(id, { whatsapp: "966500000001" }, dropped)).whatsapp).toBe(
      "UNKNOWN",
    );
    await runQueue(dropped);
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it("sends at most five receipts per number per hour", async () => {
    const fetcher = reply(200, { messages: [{ id: "wamid.x" }] });
    const results = [];
    for (let i = 0; i < 6; i++)
      results.push((await queueAndSend(ticket(), { whatsapp: "966500000009" }, fetcher)).whatsapp);
    expect(results.slice(0, 5).every((s) => s === "ACCEPTED")).toBe(true);
    expect(results[5]).toBe("RATE_LIMITED");
  });

  it("applies delivery reports forward only, and only for the right recipient", async () => {
    const id = ticket();
    await queueAndSend(
      id,
      { whatsapp: "966500000001" },
      reply(200, { messages: [{ id: "wamid.7" }] }),
    );
    const report = (status: string, recipient = "966500000001") => ({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "123456" },
                statuses: [{ id: "wamid.7", status, recipient_id: recipient }],
              },
            },
          ],
        },
      ],
    });
    await applyWhatsAppStatuses(report("read", "966500000002"));
    expect(outbox(`receipt:whatsapp:${id}`)?.["status"]).toBe("ACCEPTED");
    await applyWhatsAppStatuses(report("read"));
    await applyWhatsAppStatuses(report("delivered"));
    expect(outbox(`receipt:whatsapp:${id}`)?.["status"]).toBe("READ");
  });
});

describe("email receipt", () => {
  it("sends one transactional email through Lovable with the details escaped", async () => {
    const fetcher = reply(200, { success: true });
    const id = ticket();
    expect(await queueAndSend(id, { email: "customer@example.invalid" }, fetcher)).toEqual({
      email: "ACCEPTED",
    });
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.lovable.dev/v1/messaging/email/send");
    expect(init.headers["Idempotency-Key"]).toBe(`receipt-email-${id}`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      to: "customer@example.invalid",
      sender_domain: "notify.example.com",
      purpose: "transactional",
      subject: "تم استلام شكواك AG-2026-000007",
    });
    expect(body.html).toContain("&lt;b&gt;جداً&lt;/b&gt;");
    expect(body.html).not.toContain("<b>جداً");
    expect(body.text).toContain("https://crm.example.com/track/abcdefghijklmnopqrstuvwx");
  });

  it("builds a right-to-left Arabic message", () => {
    expect(emailContent(receipt).html).toContain('dir="rtl"');
  });
});

describe("WhatsApp through Bevatel (Chatwoot API)", () => {
  type Call = {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
    token: string | null;
  };
  /** A fake Chatwoot API. `exists`: the contact is already there; `open`: it has a conversation. */
  function chatwoot(opts: { exists?: boolean; open?: boolean; sendStatus?: number } = {}) {
    const calls: Call[] = [];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      const token = new Headers(init.headers).get("api_access_token");
      const method = init.method ?? "GET";
      calls.push({ url, method, body, token });
      const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
      const path = new URL(url).pathname.replace("/api/v1/accounts/29441", "");
      if (path === "/contacts/search")
        return ok({
          payload: opts.exists
            ? [
                {
                  id: 7,
                  phone_number: "+966500000001",
                  contact_inboxes: [{ inbox: { id: 87741 }, source_id: "src-old" }],
                },
              ]
            : [],
        });
      if (path === "/contacts" && method === "POST")
        return ok({
          payload: {
            contact: { id: 8, phone_number: body?.["phone_number"] },
            contact_inbox: { inbox: { id: 87741 }, source_id: "src-new" },
          },
        });
      if (/^\/contacts\/\d+\/conversations$/.test(path))
        return ok({
          payload: opts.open
            ? [
                { id: 54, inbox_id: 1, status: "open" },
                { id: 55, inbox_id: 87741, status: "open" },
              ]
            : [],
        });
      if (opts.sendStatus && method === "POST" && path.startsWith("/conversations"))
        return new Response(JSON.stringify({ error: "template not found" }), {
          status: opts.sendStatus,
        });
      if (path === "/conversations/56/messages" && method === "GET")
        return ok({
          meta: {},
          payload: [
            {
              id: 1000,
              status: "failed",
              content_attributes: {
                external_error: "(#132000) Number of parameters does not match",
              },
            },
          ],
        });
      if (path === "/inboxes/87741")
        return ok({
          id: 87741,
          name: "WhatsApp",
          channel_type: "Channel::Whatsapp",
          provider: "whatsapp_cloud",
          message_templates: [
            ...(["received", "resolved", "closed"] as const).map((t) => ({
              name: "aliz_complaint_" + t,
              language: "ar",
              status: "APPROVED",
              category: "UTILITY",
              components: [
                {
                  type: "BODY",
                  text: "نص القالب {{1}} {{2}}",
                  example: { body_text: [["a", "b"]] },
                },
              ],
            })),
            { name: "other", language: "en", status: "APPROVED" },
          ],
        });
      if (path === "/conversations/55/messages") return ok({ id: 999 });
      if (path === "/conversations" && method === "POST")
        return ok({ id: 56, messages: [{ id: 1000 }] });
      return new Response("{}", { status: 404 });
    });
    return { fetcher: fetcher as unknown as typeof fetch, calls };
  }
  const sends = (calls: Call[]) =>
    calls.filter((c) => c.method === "POST" && c.url.includes("/conversations"));
  const logged = () => db.tables["whatsapp_messages"] ?? [];

  beforeEach(() => {
    process.env["BEVATEL_API_TOKEN"] = "test-bevatel-token";
    void import("@/functions/whatsapp.server").then((w) => w.resetTemplateCache());
    process.env["BEVATEL_BASE_URL"] = "https://chat.bevatel.com";
    process.env["BEVATEL_ACCOUNT_ID"] = "29441";
    process.env["BEVATEL_INBOX_ID"] = "87741";
    for (const k of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"])
      delete process.env[k];
  });

  it("needs the Bevatel secrets and an approved template, by name only", () => {
    expect(missingConfig("whatsapp")).toEqual([]);
    delete process.env["WHATSAPP_TEMPLATE_APPROVED"];
    delete process.env["BEVATEL_INBOX_ID"];
    expect(missingConfig("whatsapp")).toEqual(["BEVATEL_INBOX_ID", "WHATSAPP_TEMPLATE_APPROVED"]);
  });

  it("creates the contact, opens a conversation and sends the received template", async () => {
    const { fetcher, calls } = chatwoot();
    const id = ticket("0500000001");
    expect(await queueAndSend(id, { whatsapp: "0500000001" }, fetcher)).toEqual({
      whatsapp: "ACCEPTED",
    });
    expect(calls.every((c) => c.token === "test-bevatel-token")).toBe(true);
    expect(calls[0]!.url).toBe(
      "https://chat.bevatel.com/api/v1/accounts/29441/contacts/search?q=%2B966500000001",
    );
    const created = calls.find((c) => c.url.endsWith("/contacts") && c.method === "POST")!;
    expect(created.body).toMatchObject({ phone_number: "+966500000001", inbox_id: 87741 });
    const [send] = sends(calls);
    expect(send!.url).toMatch(/\/conversations$/);
    expect(send!.body).toMatchObject({ source_id: "src-new", inbox_id: 87741, contact_id: 8 });
    const message = send!.body!["message"] as {
      content: string;
      message_type: string;
      template_params: {
        name: string;
        category: string;
        language: string;
        processed_params: Record<string, unknown> & { body: Record<string, string> };
        components: Record<string, unknown>;
      };
    };
    expect(message.message_type).toBe("outgoing");
    // Exactly what Bevatel's own chat screen sends.
    expect(message.template_params.processed_params).toMatchObject({
      header: {},
      headerMedia: { link: "", filename: "" },
      products_catalog: null,
      header_location: {},
      flow_type: null,
    });
    expect(message.template_params.components).toEqual({
      "0": { type: "BODY", text: "نص القالب {{1}} {{2}}", example: { body_text: [["a", "b"]] } },
    });
    expect(message.template_params).toMatchObject({
      name: "aliz_complaint_received",
      category: "UTILITY",
      language: "ar",
    });
    const p = message.template_params.processed_params.body;
    expect(Object.keys(p)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(p["1"]).toBe("AG-2026-000007");
    expect(p["4"]).toBe("28/10/2026 11:00");
    expect(p["6"]).toBe("-");
    expect(p["8"]).toBe("https://crm.example.com/track/abcdefghijklmnopqrstuvwx");
    expect(message.content).toContain("تم استلام طلبك رقم AG-2026-000007.");
    expect(message.content).not.toContain("{{");
    const [row] = logged();
    expect(row).toMatchObject({
      complaint_id: id,
      template: "received",
      status: "sent",
      phone_masked: "+96650•••001",
      bevatel_conversation_id: "56",
      bevatel_message_id: "1000",
      is_test: false,
      manual: false,
    });
    expect(row!["response_enc"]).toBeNull();
  });

  it("uses the customer's open conversation in the WhatsApp inbox", async () => {
    const { fetcher, calls } = chatwoot({ exists: true, open: true });
    await queueAndSend(ticket(), { whatsapp: "966500000001" }, fetcher);
    expect(calls.some((c) => c.url.endsWith("/contacts") && c.method === "POST")).toBe(false);
    expect(sends(calls).map((c) => new URL(c.url).pathname)).toEqual([
      "/api/v1/accounts/29441/conversations/55/messages",
    ]);
    expect(logged()[0]).toMatchObject({ bevatel_conversation_id: "55", bevatel_message_id: "999" });
  });

  it("sends resolved and closed once, only to customers who asked for WhatsApp", async () => {
    const { fetcher, calls } = chatwoot({ exists: true, open: true });
    const asked = ticket();
    await queueAndSend(asked, { whatsapp: "966500000001" }, fetcher);
    expect(await queueUpdate(asked, "resolved", fetcher)).toBe("ACCEPTED");
    expect(await queueUpdate(asked, "closed", fetcher)).toBe("ACCEPTED");
    expect(await queueUpdate(asked, "closed", fetcher)).toBe("DUPLICATE");
    const names = sends(calls).map(
      (c) => (c.body!["template_params"] as { name: string; processed_params: object }).name,
    );
    expect(names).toEqual([
      "aliz_complaint_received",
      "aliz_complaint_resolved",
      "aliz_complaint_closed",
    ]);
    const resolved = sends(calls)[1]!.body!["template_params"] as {
      processed_params: { body: Record<string, string> };
    };
    expect(resolved.processed_params.body).toEqual({
      "1": "AG-2026-000007",
      "2": "واقف",
      "3": "https://crm.example.com/track/abcdefghijklmnopqrstuvwx",
    });
    // A second automatic send of the same template is refused even outside the outbox.
    const { sendForComplaint } = await import("@/functions/whatsapp.server");
    expect((await sendForComplaint(asked, "closed", { actor: "SYSTEM", fetcher })).status).toBe(
      "skipped",
    );
    // An admin can resend on purpose.
    expect(
      (await sendForComplaint(asked, "closed", { actor: "admin-1", manual: true, fetcher })).status,
    ).toBe("sent");
    expect(logged().filter((r) => r["manual"])).toHaveLength(1);
    const silent = ticket("966500000002");
    expect(await queueUpdate(silent, "resolved", fetcher)).toBe("NOT_REQUESTED");
  });

  it("logs Bevatel's full reply when a send fails, and does not resend", async () => {
    const id = ticket();
    const { fetcher } = chatwoot({ sendStatus: 422 });
    expect((await queueAndSend(id, { whatsapp: "966500000001" }, fetcher)).whatsapp).toBe("FAILED");
    const [row] = logged();
    expect(row).toMatchObject({ status: "failed", error: "POST /conversations → 422" });
    expect(String(row!["response_enc"])).toContain("template not found");
  });

  it("sends nothing while WhatsApp is switched off", async () => {
    db.settings.whatsapp = false;
    const { fetcher, calls } = chatwoot();
    expect(await queueAndSend(ticket(), { whatsapp: "966500000001" }, fetcher)).toEqual({
      whatsapp: "NOT_CONFIGURED",
    });
    expect(calls).toHaveLength(0);
  });

  it("sends a test with sample values and records the confirmation", async () => {
    const w = await import("@/functions/whatsapp.server");
    const { fetcher, calls } = chatwoot();
    expect((await w.sendTest("12345", "closed", "admin-1", fetcher)).status).toBe("failed");
    expect(calls).toHaveLength(0);
    const test = await w.sendTest("+966 50 000 0009", "received", "admin-1", fetcher);
    expect(test).toMatchObject({ status: "sent", error: null, response: { id: 56 } });
    const p = (
      sends(calls)[0]!.body!["message"] as {
        template_params: { processed_params: { body: Record<string, string> } };
      }
    ).template_params.processed_params.body;
    expect([p["1"], p["2"], p["3"], p["5"], p["6"], p["7"], p["8"]]).toEqual([
      "AG-2026-000123",
      "برجر واقف",
      "برجر واقف - الدمام",
      "تأخر الطلب",
      "482915",
      "وصل الطلب بعد ساعة",
      "https://crm.example.com/track/sample",
    ]);
    expect(await w.testConfirmed()).toBe(false);
    expect(await w.confirmTest(test.id!)).toBe(true);
    expect(await w.testConfirmed()).toBe(true);
  });

  it("tries the second layout, checks delivery, and keeps the confirmed layout", async () => {
    const w = await import("@/functions/whatsapp.server");
    const { fetcher, calls } = chatwoot();
    const test = await w.sendTest("0500000009", "closed", "admin-1", fetcher, "body");
    const sent = sends(calls)[0]!.body!["message"] as {
      template_params: { processed_params: unknown };
    };
    expect(sent.template_params.processed_params).toEqual({
      body: { "1": "AG-2026-000123", "2": "برجر واقف" },
    });
    expect(await w.deliveryStatus(test.id!, fetcher)).toMatchObject({
      status: "failed",
      error: "(#132000) Number of parameters does not match",
    });
    expect(await w.savedFormat()).toBe("bevatel");
    await w.confirmTest(test.id!);
    expect(await w.savedFormat()).toBe("body");
    // Automatic sends now use the confirmed layout.
    const id = ticket();
    await queueAndSend(id, { whatsapp: "966500000001" }, fetcher);
    const auto = sends(calls).at(-1)!.body!["message"] as {
      template_params: { processed_params: Record<string, unknown> };
    };
    expect(Object.keys(auto.template_params.processed_params)).toEqual(["body"]);
  });

  it("sends a plain test message without the template, which cannot be confirmed", async () => {
    const w = await import("@/functions/whatsapp.server");
    const { fetcher, calls } = chatwoot();
    const test = await w.sendTest("0500000009", "closed", "admin-1", fetcher, "text");
    const sent = sends(calls)[0]!.body!["message"] as Record<string, unknown>;
    expect(sent["template_params"]).toBeUndefined();
    expect(sent["content"]).toContain("تم إغلاق طلبك رقم AG-2026-000123");
    expect(await w.confirmTest(test.id!)).toBe(false);
    expect(await w.testConfirmed()).toBe(false);
  });

  it("reports the inbox type and the test conversation's last messages", async () => {
    const w = await import("@/functions/whatsapp.server");
    const { fetcher } = chatwoot();
    const test = await w.sendTest("0500000009", "closed", "admin-1", fetcher);
    const report = JSON.parse(await w.diagnose(test.id!, fetcher));
    expect(report.inbox).toMatchObject({
      channel_type: "Channel::Whatsapp",
      provider: "whatsapp_cloud",
      message_templates: expect.arrayContaining([
        { name: "aliz_complaint_received", language: "ar", status: "APPROVED" },
      ]),
    });
    expect(report.conversation).toBe("56");
    expect(report.last_messages[0]).toMatchObject({ id: 1000, status: "failed" });
  });

  it("reports a message that never left Bevatel, and refuses a template Bevatel lacks", async () => {
    const w = await import("@/functions/whatsapp.server");
    const { fetcher } = chatwoot({ exists: true, open: true });
    const test = await w.sendTest("0500000009", "closed", "admin-1", fetcher);
    const stuck = vi.fn(
      async () =>
        new Response(JSON.stringify({ payload: [{ id: 999, status: "sent", source_id: null }] })),
    ) as unknown as typeof fetch;
    expect((await w.deliveryStatus(test.id!, stuck)).status).toBe("queued");
    w.resetTemplateCache();
    const empty = vi.fn(async (url: string, init: RequestInit) =>
      String(url).includes("/inboxes/")
        ? new Response(JSON.stringify({ message_templates: [] }))
        : fetcher(url, init),
    ) as unknown as typeof fetch;
    const missing = await w.sendTest("0500000009", "closed", "admin-1", empty);
    expect(missing.status).toBe("failed");
    expect(missing.error).toContain("aliz_complaint_closed");
    w.resetTemplateCache();
  });

  it("cleans numbers and values", async () => {
    const w = await import("@/functions/whatsapp.server");
    expect(
      ["0512345678", "966512345678", "+966512345678", "00966512345678", "512345678"].map(
        w.saudiE164,
      ),
    ).toEqual(Array(5).fill("+966512345678"));
    expect(w.saudiE164("0112345678")).toBe("");
    expect(w.cleanParam("  سطر\nثاني\t ")).toBe("سطر ثاني");
    expect(w.cleanParam("")).toBe("-");
    expect(w.cleanParam("x".repeat(1000))).toHaveLength(900);
    expect(w.riyadhTime("2026-12-31T22:05:00Z")).toBe("01/01/2027 01:05");
  });
});
