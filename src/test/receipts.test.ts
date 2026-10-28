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
        if (rows().some((x) => x["key"] === r["key"]))
          return Promise.resolve({ error: { message: "duplicate" } });
        rows().push({ created_at: new Date().toISOString(), ...r });
        return Promise.resolve({ error: null });
      },
      update: (p: Row) => {
        op = "update";
        patch = p;
        return q;
      },
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
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
