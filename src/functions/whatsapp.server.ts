// Server-only: WhatsApp to customers through Bevatel, a Chatwoot-based inbox.
// Import dynamically from handlers. Never called from the browser.
import { admin, settings } from "./core.server";
import { decrypt, encrypt } from "./crypto.server";
import type { Receipt } from "./tickets.server";

/*
 * Three approved Meta templates (UTILITY, Arabic), variables in a fixed order:
 *   received: reference, brand, branch, time received (DD/MM/YYYY HH:mm Riyadh),
 *             reason, order number, details, tracking link
 *   resolved: reference, brand, tracking link
 *   closed:   reference, brand
 * Each one is sent through the Chatwoot API of Bevatel:
 *   contact (search by phone, else create) → its WhatsApp inbox link →
 *   the open conversation in that inbox (else a new one) → a template message.
 * Every attempt is written to whatsapp_messages (masked phone, encrypted
 * values and replies). The same template goes out automatically once per
 * complaint; an admin can resend.
 */

export type Template = "received" | "resolved" | "closed";
export const TEMPLATES: Record<Template, { name: string; text: string }> = {
  received: {
    name: "aliz_complaint_received",
    text: "شكراً لتواصلك معنا، تم استلام طلبك رقم {{1}}.\nالعلامة: {{2}}\nالفرع: {{3}}\nوقت الاستلام: {{4}}\nالسبب: {{5}}\nرقم الطلب: {{6}}\nالتفاصيل: {{7}}\nتابع حالة طلبك من هنا:\n{{8}}\nشكراً لك.",
  },
  resolved: {
    name: "aliz_complaint_resolved",
    text: "تحديث على طلبك رقم {{1}} لدى {{2}}:\nتمت معالجة الطلب، وسيتواصل معك فريقنا للتأكد من رضاك.\nتفاصيل الحالة:\n{{3}}\nشكراً لتواصلك معنا.",
  },
  closed: {
    name: "aliz_complaint_closed",
    text: "تم إغلاق طلبك رقم {{1}} لدى {{2}}.\nشكراً لتواصلك معنا، يسعدنا خدمتك دائماً.",
  },
};

const env = (k: string) => (process.env[k] ?? "").trim();
const DEFAULT_ORIGIN = "https://alizglobecrm.lovable.app";

export function bevatelConfigured() {
  return !!env("BEVATEL_API_TOKEN");
}

/** What is missing before anything can be sent. Names only, never values. */
export function missingBevatel(forAutomatic: boolean) {
  const missing: string[] = [];
  if (!env("BEVATEL_API_TOKEN")) missing.push("BEVATEL_API_TOKEN");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(baseUrl())) missing.push("BEVATEL_BASE_URL");
  if (!/^\d+$/.test(env("BEVATEL_ACCOUNT_ID"))) missing.push("BEVATEL_ACCOUNT_ID");
  if (!/^\d+$/.test(env("BEVATEL_INBOX_ID"))) missing.push("BEVATEL_INBOX_ID");
  if (forAutomatic && env("WHATSAPP_TEMPLATE_APPROVED") !== "true")
    missing.push("WHATSAPP_TEMPLATE_APPROVED");
  return missing;
}

const baseUrl = () => (env("BEVATEL_BASE_URL") || "https://chat.bevatel.com").replace(/\/+$/, "");
function origin() {
  try {
    const u = new URL(env("PUBLIC_APP_ORIGIN") || DEFAULT_ORIGIN);
    return u.protocol === "https:" ? u.origin : DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/** +9665XXXXXXXX, or "" when the number is not a Saudi mobile. */
export function saudiE164(raw: string) {
  let d = String(raw ?? "").replace(/[\s\-()]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = "966" + d.slice(1);
  else if (/^5\d{8}$/.test(d)) d = "966" + d;
  return /^9665\d{8}$/.test(d) ? "+" + d : "";
}
export const maskPhone = (e164: string) => (e164 ? e164.slice(0, 6) + "•••" + e164.slice(-3) : "");

/** One template value: no line breaks or tabs, at most 900 characters, never empty. */
export function cleanParam(v: unknown) {
  const s = String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, 900);
  return s || "-";
}

/** DD/MM/YYYY HH:mm in Riyadh time. */
export function riyadhTime(iso: string) {
  const d = new Date(+new Date(iso) + 3 * 3600_000);
  if (Number.isNaN(+d)) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function templateParams(template: Template, r: Receipt) {
  const link = r.trackingPath ? new URL(r.trackingPath, origin()).toString() : "";
  const values =
    template === "resolved"
      ? [r.number, r.brand, link]
      : template === "closed"
        ? [r.number, r.brand]
        : [
            r.number,
            r.brand,
            r.branch,
            riyadhTime(r.receivedAt),
            r.category,
            r.externalOrder,
            r.description,
            link,
          ];
  return Object.fromEntries(values.map((v, i) => [String(i + 1), cleanParam(v)]));
}

export const renderTemplate = (template: Template, params: Record<string, string>) =>
  TEMPLATES[template].text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[n] ?? "-");

/** How template values are sent: Bevatel versions expect one or the other. */
export type Format = "flat" | "body";
/** "text": a plain message without the template, for tests only (WhatsApp delivers it only
 * within 24 hours of the customer's last message). It shows whether Bevatel sends API
 * messages at all. */
export type SendFormat = Format | "text";
export const isFormat = (v: unknown): v is Format => v === "flat" || v === "body";

export function messagePayload(
  template: Template,
  params: Record<string, string>,
  format: SendFormat = "flat",
) {
  if (format === "text")
    return { content: renderTemplate(template, params), message_type: "outgoing" };
  return {
    content: renderTemplate(template, params),
    message_type: "outgoing",
    template_params: {
      name: TEMPLATES[template].name,
      category: "UTILITY",
      language: "ar",
      processed_params: format === "body" ? { body: params } : params,
    },
  };
}

class BevatelError extends Error {
  constructor(
    message: string,
    public response: unknown,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;
async function call(fetcher: typeof fetch, method: string, path: string, body?: unknown) {
  const res = await fetcher(`${baseUrl()}/api/v1/accounts/${env("BEVATEL_ACCOUNT_ID")}${path}`, {
    method,
    headers: {
      api_access_token: env("BEVATEL_API_TOKEN"),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* keep the raw text */
  }
  if (!res.ok) throw new BevatelError(`${method} ${path.split("?")[0]} → ${res.status}`, json);
  return json as Json;
}
/** Chatwoot wraps most replies in `payload`; take the list or the object inside. */
const listIn = (j: Json) =>
  (Array.isArray(j["payload"]) ? j["payload"] : Array.isArray(j) ? j : []) as Json[];
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

async function findOrCreateContact(fetcher: typeof fetch, phone: string, name: string) {
  const found = listIn(
    await call(fetcher, "GET", `/contacts/search?q=${encodeURIComponent(phone)}`),
  ).find((c) => digits(c["phone_number"]) === digits(phone));
  if (found) return { id: String(found["id"]), contactInboxes: found["contact_inboxes"] };
  const created = await call(fetcher, "POST", "/contacts", {
    name: name.trim().slice(0, 100) || "عميل " + phone.slice(-4),
    phone_number: phone,
    inbox_id: Number(env("BEVATEL_INBOX_ID")),
  });
  const p = (created["payload"] ?? created) as Json;
  const contact = (p["contact"] ?? p) as Json;
  if (!contact["id"]) throw new BevatelError("Contact not created", created);
  return {
    id: String(contact["id"]),
    contactInboxes: p["contact_inbox"] ? [p["contact_inbox"]] : contact["contact_inboxes"],
  };
}

/** The contact's source id in the WhatsApp inbox (needed to open a conversation). */
async function sourceIdFor(
  fetcher: typeof fetch,
  contactId: string,
  phone: string,
  known: unknown,
) {
  const inbox = Number(env("BEVATEL_INBOX_ID"));
  const pick = (list: unknown) =>
    (Array.isArray(list) ? (list as Json[]) : []).find(
      (ci) => Number((ci["inbox"] as Json | undefined)?.["id"] ?? ci["inbox_id"]) === inbox,
    )?.["source_id"];
  const fromKnown = pick(known);
  if (fromKnown) return String(fromKnown);
  try {
    const shown = await call(fetcher, "GET", `/contacts/${contactId}`);
    const c = (shown["payload"] ?? shown) as Json;
    const fromShow = pick(c["contact_inboxes"]);
    if (fromShow) return String(fromShow);
  } catch {
    /* fall through and create the link */
  }
  const made = await call(fetcher, "POST", `/contacts/${contactId}/contact_inboxes`, {
    inbox_id: inbox,
    source_id: digits(phone),
  });
  return String(((made["payload"] ?? made) as Json)["source_id"] ?? digits(phone));
}

export type SendOutcome = {
  status: "sent" | "failed" | "skipped";
  error?: string | undefined;
  response?: unknown;
  conversationId?: string | undefined;
  messageId?: string | undefined;
};

/** Send one template to one number through Bevatel. Never throws. */
export async function sendToPhone(
  phone: string,
  name: string,
  template: Template,
  params: Record<string, string>,
  fetcher: typeof fetch = fetch,
  format: SendFormat = "flat",
): Promise<SendOutcome & { contactId?: string | undefined }> {
  let contactId: string | undefined;
  try {
    const contact = await findOrCreateContact(fetcher, phone, name);
    contactId = contact.id;
    const inbox = Number(env("BEVATEL_INBOX_ID"));
    const convs = listIn(await call(fetcher, "GET", `/contacts/${contact.id}/conversations`))
      .filter((c) => Number(c["inbox_id"]) === inbox)
      .sort((a, b) => Number(b["id"]) - Number(a["id"]));
    const open = convs.find((c) => c["status"] !== "resolved") ?? convs[0];
    const message = messagePayload(template, params, format);
    if (open) {
      const sent = await call(fetcher, "POST", `/conversations/${open["id"]}/messages`, message);
      return {
        status: "sent",
        contactId,
        conversationId: String(open["id"]),
        messageId: sent["id"] ? String(sent["id"]) : undefined,
        response: sent,
      };
    }
    const sourceId = await sourceIdFor(fetcher, contact.id, phone, contact.contactInboxes);
    const conv = await call(fetcher, "POST", "/conversations", {
      source_id: sourceId,
      inbox_id: inbox,
      contact_id: Number(contact.id) || contact.id,
      message,
    });
    const msgs = Array.isArray(conv["messages"]) ? (conv["messages"] as Json[]) : [];
    return {
      status: "sent",
      contactId,
      conversationId: conv["id"] ? String(conv["id"]) : undefined,
      messageId: msgs[0]?.["id"] ? String(msgs[0]["id"]) : undefined,
      response: conv,
    };
  } catch (e) {
    const timeout = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
    return {
      status: "failed",
      contactId,
      error: timeout
        ? "انتهت المهلة دون رد من Bevatel (قد تكون الرسالة أُرسلت)"
        : e instanceof Error
          ? e.message
          : "خطأ غير معروف",
      response: e instanceof BevatelError ? e.response : undefined,
    };
  }
}

async function log(row: {
  complaintId: string | null;
  template: Template;
  isTest?: boolean | undefined;
  manual?: boolean | undefined;
  phone?: string;
  params?: Record<string, string>;
  outcome: SendOutcome & { contactId?: string | undefined };
  actor: string;
  format?: SendFormat;
}) {
  const db = await admin();
  const keep = row.outcome.status === "failed" || row.isTest;
  const { data } = await db
    .from("whatsapp_messages" as never)
    .insert({
      complaint_id: row.complaintId,
      template: row.template,
      is_test: !!row.isTest,
      format: row.format ?? "flat",
      manual: !!row.manual,
      phone_masked: row.phone ? maskPhone(row.phone) : null,
      params_enc: row.params ? await encrypt(JSON.stringify(row.params)) : null,
      bevatel_contact_id: row.outcome.contactId ?? null,
      bevatel_conversation_id: row.outcome.conversationId ?? null,
      bevatel_message_id: row.outcome.messageId ?? null,
      status: row.outcome.status,
      error: row.outcome.error ?? null,
      response_enc:
        keep && row.outcome.response !== undefined
          ? await encrypt(JSON.stringify(row.outcome.response).slice(0, 20_000))
          : null,
      actor: row.actor,
    } as never)
    .select("id")
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Automatic sending: switched on in Settings, configured, and a test reached a phone. */
export async function automaticReady() {
  const s = await settings();
  if (!s.whatsapp) return "واتساب موقوف في الإعدادات";
  const missing = missingBevatel(true);
  if (missing.length) return "إعدادات ناقصة: " + missing.join("، ");
  return "";
}

/**
 * Send a template for a complaint. Automatic sends happen once per complaint and
 * template, only when the customer chose WhatsApp; `manual` (admin resend) skips
 * the once-only rule. Never throws; returns the logged status.
 */
export async function sendForComplaint(
  complaintId: string,
  template: Template,
  opts: { actor: string; manual?: boolean; fetcher?: typeof fetch } = { actor: "SYSTEM" },
): Promise<SendOutcome> {
  const fetcher = opts.fetcher ?? fetch;
  try {
    const db = await admin();
    const blocked = await automaticReady();
    if (blocked && !opts.manual) {
      await log({
        complaintId,
        template,
        outcome: { status: "skipped", error: blocked },
        actor: opts.actor,
      });
      return { status: "skipped", error: blocked };
    }
    if (opts.manual && missingBevatel(false).length) {
      const error = "إعدادات ناقصة: " + missingBevatel(false).join("، ");
      await log({
        complaintId,
        template,
        manual: true,
        outcome: { status: "skipped", error },
        actor: opts.actor,
      });
      return { status: "skipped", error };
    }
    if (!opts.manual) {
      const { data: done } = await db
        .from("whatsapp_messages" as never)
        .select("id")
        .eq("complaint_id", complaintId)
        .eq("template", template)
        .eq("status", "sent")
        .eq("manual", false)
        .eq("is_test", false)
        .maybeSingle();
      if (done) return { status: "skipped", error: "أُرسلت هذه الرسالة من قبل" };
    }
    const { data: t } = await db
      .from("tickets")
      .select("receipt_enc,customer_enc")
      .eq("id", complaintId)
      .maybeSingle();
    if (!t?.receipt_enc || !t.customer_enc) {
      const error = "لا توجد بيانات تواصل للعميل";
      await log({
        complaintId,
        template,
        manual: opts.manual,
        outcome: { status: "skipped", error },
        actor: opts.actor,
      });
      return { status: "skipped", error };
    }
    const receipt = JSON.parse(await decrypt(t.receipt_enc)) as Receipt;
    const customer = JSON.parse(await decrypt(t.customer_enc)) as { name?: string; phone?: string };
    const phone = saudiE164(customer.phone ?? "");
    if (!phone) {
      const error = "رقم الجوال غير صالح لواتساب";
      await log({
        complaintId,
        template,
        manual: opts.manual,
        outcome: { status: "failed", error },
        actor: opts.actor,
      });
      return { status: "failed", error };
    }
    const params = templateParams(template, receipt);
    const format = await savedFormat();
    const outcome = await sendToPhone(
      phone,
      customer.name ?? "",
      template,
      params,
      fetcher,
      format,
    );
    await log({
      complaintId,
      template,
      manual: opts.manual,
      phone,
      params,
      outcome,
      actor: opts.actor,
      format,
    });
    return outcome;
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "خطأ غير معروف" };
  }
}

export const SAMPLE_PARAMS = (template: Template) =>
  templateParams(template, {
    number: "AG-2026-000123",
    brand: "برجر واقف",
    branch: "برجر واقف - الدمام",
    receivedAt: new Date().toISOString(),
    category: "تأخر الطلب",
    externalOrder: "482915",
    description: "وصل الطلب بعد ساعة",
    trackingPath: "/track/sample",
    customerName: "",
    platform: "",
    source: "QR",
  });

/** Settings → واتساب: send a template with sample values; returns Bevatel's raw reply. */
export async function sendTest(
  phoneRaw: string,
  template: Template,
  actor: string,
  fetcher: typeof fetch = fetch,
  format: SendFormat = "flat",
) {
  const missing = missingBevatel(false);
  if (missing.length)
    return {
      id: null,
      status: "skipped" as const,
      error: "إعدادات ناقصة: " + missing.join("، "),
      response: null,
    };
  const phone = saudiE164(phoneRaw);
  if (!phone)
    return {
      id: null,
      status: "failed" as const,
      error: "اكتب رقم جوال سعودي صحيح مثل 0512345678",
      response: null,
    };
  const params = SAMPLE_PARAMS(template);
  const outcome = await sendToPhone(phone, "اختبار CRM", template, params, fetcher, format);
  const id = await log({
    complaintId: null,
    template,
    isTest: true,
    phone,
    params,
    outcome,
    actor,
    format,
  });
  return {
    id,
    status: outcome.status,
    error: outcome.error ?? null,
    response: outcome.response ?? null,
  };
}

/** The layout of the last confirmed test; automatic sends use it. */
export async function savedFormat(): Promise<Format> {
  const db = await admin();
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "bevatel_template_format")
    .maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return isFormat(v) ? v : "flat";
}

/** The admin saw the test message arrive on their phone: its layout becomes the one used. */
export async function confirmTest(id: string) {
  const db = await admin();
  const { data } = await db
    .from("whatsapp_messages" as never)
    .update({ confirmed_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("is_test", true)
    .eq("status", "sent")
    .neq("format", "text")
    .select("id,format");
  const row = (data as { format?: unknown }[] | null)?.[0];
  if (!row) return false;
  await db.from("app_settings").upsert({
    key: "bevatel_template_format",
    value: isFormat(row.format) ? row.format : "flat",
    updated_at: new Date().toISOString(),
  } as never);
  return true;
}

/**
 * Ask Bevatel what became of a sent message. Bevatel accepts a message first and
 * hands it to WhatsApp afterwards, so a refusal (for example a template mismatch)
 * only shows up here, as status "failed" with WhatsApp's error.
 */
export async function deliveryStatus(id: string, fetcher: typeof fetch = fetch) {
  const db = await admin();
  const { data } = await db
    .from("whatsapp_messages" as never)
    .select("bevatel_conversation_id,bevatel_message_id")
    .eq("id", id)
    .maybeSingle();
  const row = data as { bevatel_conversation_id?: string; bevatel_message_id?: string } | null;
  if (!row?.bevatel_conversation_id || !row.bevatel_message_id)
    return { status: "unknown", error: "لا يوجد رقم رسالة لدى Bevatel لهذه المحاولة", raw: null };
  try {
    const conv = row.bevatel_conversation_id,
      msg = row.bevatel_message_id;
    const after = await call(
      fetcher,
      "GET",
      `/conversations/${conv}/messages?after=${Number(msg) - 1}`,
    );
    let found = listIn(after).find((m) => String(m["id"]) === msg);
    if (!found)
      found = listIn(await call(fetcher, "GET", `/conversations/${conv}/messages`)).find(
        (m) => String(m["id"]) === msg,
      );
    if (!found) return { status: "unknown", error: "لم تُعثر على الرسالة في المحادثة", raw: null };
    const attrs = (found["content_attributes"] ?? {}) as Json;
    const external = attrs["external_error"];
    return {
      status: String(found["status"] ?? "unknown"),
      error: external ? String(external) : null,
      raw: JSON.stringify(
        {
          id: found["id"],
          status: found["status"],
          content_attributes: found["content_attributes"],
          additional_attributes: found["additional_attributes"],
          source_id: found["source_id"],
        },
        null,
        2,
      ),
    };
  } catch (e) {
    return {
      status: "unknown",
      error: e instanceof Error ? e.message : "تعذر الاتصال بـ Bevatel",
      raw: e instanceof BevatelError ? JSON.stringify(e.response, null, 2) : null,
    };
  }
}

export async function testConfirmed() {
  const db = await admin();
  const { count } = await db
    .from("whatsapp_messages" as never)
    .select("id", { count: "exact", head: true })
    .eq("is_test", true)
    .eq("status", "sent")
    .not("confirmed_at", "is", null);
  return (count ?? 0) > 0;
}

export async function statusSummary() {
  const db = await admin();
  const s = await settings();
  const [{ data: recent }, confirmed] = await Promise.all([
    db
      .from("whatsapp_messages" as never)
      .select("id,template,is_test,manual,phone_masked,status,error,confirmed_at,created_at")
      .order("created_at", { ascending: false })
      .limit(15),
    testConfirmed(),
  ]);
  return {
    enabled: s.whatsapp,
    missing: missingBevatel(true),
    testConfirmed: confirmed,
    recent: (recent ?? []) as unknown as {
      id: string;
      template: Template;
      is_test: boolean;
      manual: boolean;
      phone_masked: string | null;
      status: string;
      error: string | null;
      confirmed_at: string | null;
      created_at: string;
    }[],
  };
}

/** The WhatsApp log of one complaint, newest first. */
export async function complaintLog(complaintId: string) {
  const db = await admin();
  const { data } = await db
    .from("whatsapp_messages" as never)
    .select("id,template,manual,phone_masked,status,error,response_enc,created_at")
    .eq("complaint_id", complaintId)
    .order("created_at", { ascending: false })
    .limit(30);
  const rows = (data ?? []) as unknown as {
    id: string;
    template: Template;
    manual: boolean;
    phone_masked: string | null;
    status: string;
    error: string | null;
    response_enc: string | null;
    created_at: string;
  }[];
  return Promise.all(
    rows.map(async ({ response_enc, ...r }) => ({
      ...r,
      response: response_enc ? await decrypt(response_enc).catch(() => null) : null,
    })),
  );
}

/**
 * Diagnosis for the Settings test: what kind of inbox Bevatel has, and the last
 * messages of the test conversation (including ones sent from Bevatel's own
 * screen), so their fields can be compared. Contents are cut short.
 */
export async function diagnose(id: string, fetcher: typeof fetch = fetch) {
  const db = await admin();
  const { data } = await db
    .from("whatsapp_messages" as never)
    .select("bevatel_conversation_id")
    .eq("id", id)
    .eq("is_test", true)
    .maybeSingle();
  const conv = (data as { bevatel_conversation_id?: string } | null)?.bevatel_conversation_id;
  const out: Record<string, unknown> = {};
  try {
    const inbox = await call(fetcher, "GET", `/inboxes/${env("BEVATEL_INBOX_ID")}`);
    const i = (inbox["payload"] ?? inbox) as Json;
    out["inbox"] = {
      id: i["id"],
      name: i["name"],
      channel_type: i["channel_type"],
      provider: i["provider"],
      phone_number: i["phone_number"],
      message_templates: Array.isArray(i["message_templates"])
        ? (i["message_templates"] as Json[])
            .filter((t) => String(t["name"] ?? "").startsWith("aliz_"))
            .map((t) => ({ name: t["name"], language: t["language"], status: t["status"] }))
        : undefined,
    };
  } catch (e) {
    out["inbox_error"] = e instanceof BevatelError ? e.response : String(e);
  }
  if (conv)
    try {
      const msgs = listIn(await call(fetcher, "GET", `/conversations/${conv}/messages`));
      out["conversation"] = conv;
      out["last_messages"] = msgs.slice(-6).map((m) => ({
        id: m["id"],
        message_type: m["message_type"],
        status: m["status"],
        source_id: m["source_id"],
        content: String(m["content"] ?? "").slice(0, 120),
        content_attributes: m["content_attributes"],
        additional_attributes: m["additional_attributes"],
        sender_type: (m["sender"] as Json | undefined)?.["type"] ?? m["sender_type"],
        created_at: m["created_at"],
      }));
    } catch (e) {
      out["messages_error"] = e instanceof BevatelError ? e.response : String(e);
    }
  return JSON.stringify(out, null, 2);
}
