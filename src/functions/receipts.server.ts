import { normalizePhone } from "@/lib/domain";
import { receiptTime } from "@/aliz/complaint-receipt";
import { admin, settings } from "./core.server";
import { decrypt, keyedHash, sha256 } from "./crypto.server";
import type { Receipt } from "./tickets.server";

/*
 * Customer receipts: one WhatsApp message and/or one email per complaint, only
 * when the customer agreed and the channel is switched on and configured.
 *
 * State lives in the existing `outbox` table, so no schema change is needed:
 *   receipt:<channel>:<ticketId>   one row per complaint and channel; status is the delivery state
 *   wamid:<sha256(messageId)>      maps a WhatsApp delivery report back to its complaint
 *   limit:<channel>:<hash>:<id>    counts receipts per phone/email for the hourly limit
 *   update:whatsapp:<event>:<id>   one row per complaint update (resolved, closed) sent on WhatsApp
 *   bvcontact:<hash>               the Bevatel contact id (in status) for a phone number
 *
 * WhatsApp goes through Bevatel when BEVATEL_API_KEY is set (messages then also
 * show in the Bevatel inbox), otherwise straight to Meta's Cloud API.
 * The recipient and message are rebuilt from the complaint's encrypted fields at
 * send time, so no personal data is stored in the outbox.
 */

export type Channel = "whatsapp" | "email";
const TYPE: Record<Channel, string> = {
  whatsapp: "CUSTOMER_RECEIPT_WHATSAPP",
  email: "CUSTOMER_RECEIPT_EMAIL",
};
export const HELD = "HELD_PROVIDER_NOT_CONFIGURED";
const RETRIES = ["QUEUED", "QUEUED_RETRY_1", "QUEUED_RETRY_2"];
const PER_RECIPIENT_PER_HOUR = 5;
const HOUR = 3600_000;

const env = (k: string) => process.env[k] ?? "";

/** Messages a customer can get on WhatsApp for one complaint. */
export type WhatsAppEvent = "received" | "resolved" | "closed";
export const provider = () => (env("BEVATEL_API_KEY") ? "bevatel" : "meta");
const BEVATEL_TEMPLATES: Record<WhatsAppEvent, [string, string]> = {
  received: ["BEVATEL_TEMPLATE_RECEIVED", "aliz_complaint_received"],
  resolved: ["BEVATEL_TEMPLATE_RESOLVED", "aliz_complaint_resolved"],
  closed: ["BEVATEL_TEMPLATE_CLOSED", "aliz_complaint_closed"],
};
export const bevatelTemplate = (event: WhatsAppEvent) =>
  env(BEVATEL_TEMPLATES[event][0]) || BEVATEL_TEMPLATES[event][1];

function publicOrigin() {
  try {
    const u = new URL(env("PUBLIC_APP_ORIGIN"));
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return u.protocol === "https:" && !local && !u.username && !u.password ? u.origin : "";
  } catch {
    return "";
  }
}

/** What is still missing before a channel can send. Names only, never values. */
export function missingConfig(channel: Channel) {
  const missing: string[] = [];
  if (!publicOrigin()) missing.push("PUBLIC_HTTPS_APP_ORIGIN");
  if (channel === "whatsapp" && provider() === "bevatel") {
    if (env("WHATSAPP_TEMPLATE_APPROVED") !== "true") missing.push("WHATSAPP_TEMPLATE_APPROVED");
    for (const event of ["received", "resolved", "closed"] as const)
      if (!/^[a-z0-9_]{1,512}$/.test(bevatelTemplate(event))) missing.push("VALID_TEMPLATE_NAME");
  } else if (channel === "whatsapp") {
    for (const k of [
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN",
      "WHATSAPP_TEMPLATE_NAME",
    ])
      if (!env(k)) missing.push(k);
    if (env("WHATSAPP_TEMPLATE_APPROVED") !== "true") missing.push("WHATSAPP_TEMPLATE_APPROVED");
    if (env("WHATSAPP_PHONE_NUMBER_ID") && !/^\d+$/.test(env("WHATSAPP_PHONE_NUMBER_ID")))
      missing.push("VALID_PHONE_NUMBER_ID");
    if (env("WHATSAPP_TEMPLATE_NAME") && !/^[a-z0-9_]{1,512}$/.test(env("WHATSAPP_TEMPLATE_NAME")))
      missing.push("VALID_TEMPLATE_NAME");
    if (!/^v\d+\.\d+$/.test(env("WHATSAPP_API_VERSION") || "v23.0"))
      missing.push("VALID_API_VERSION");
  } else {
    if (!env("LOVABLE_API_KEY")) missing.push("LOVABLE_API_KEY");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(env("EMAIL_SENDER_DOMAIN")))
      missing.push("EMAIL_SENDER_DOMAIN");
  }
  return missing;
}

/** Live means: switched on in Settings and fully configured. */
export async function liveChannels() {
  const s = await settings();
  return {
    whatsapp: s.whatsapp && missingConfig("whatsapp").length === 0,
    email: s.emailReceipts && missingConfig("email").length === 0,
  };
}

/**
 * Called right after a new complaint is stored. Records the customer's request for
 * each channel they agreed to, then tries to send at once. Never throws: a receipt
 * problem must not fail the complaint itself.
 */
export async function queueAndSend(
  ticketId: string,
  want: { whatsapp?: string | undefined; email?: string | undefined },
  fetcher: typeof fetch = fetch,
) {
  const out: Partial<Record<Channel, string>> = {};
  try {
    const db = await admin();
    const live = await liveChannels();
    for (const channel of ["whatsapp", "email"] as const) {
      const to = want[channel];
      if (!to) continue;
      let status = live[channel] ? "QUEUED" : HELD;
      if (status === "QUEUED") {
        const who = await keyedHash(`receipt:${channel}:${to}`);
        const { count } = await db
          .from("outbox")
          .select("id", { count: "exact", head: true })
          .like("key", `limit:${channel}:${who}:%`)
          .gte("created_at", new Date(Date.now() - HOUR).toISOString());
        if ((count ?? 0) >= PER_RECIPIENT_PER_HOUR) status = "RATE_LIMITED";
        else
          await db.from("outbox").insert({
            key: `limit:${channel}:${who}:${ticketId}`,
            type: "RECEIPT_LIMIT_REF",
            ticket_id: ticketId,
            status: "REF",
          });
      }
      await db.from("outbox").insert({
        key: `receipt:${channel}:${ticketId}`,
        type: TYPE[channel],
        ticket_id: ticketId,
        status,
      });
      out[channel] = status === HELD ? "NOT_CONFIGURED" : status;
      if (status === "QUEUED") out[channel] = await deliver(channel, ticketId, fetcher);
    }
  } catch {
    /* The cron run picks up anything left queued. */
  }
  return out;
}

type Job = { key: string; status: string; ticket_id: string };

/** Claim one queued receipt and send it. Returns the new status. */
export async function deliver(
  channel: Channel,
  ticketId: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  return deliverKey(`receipt:${channel}:${ticketId}`, channel, ticketId, "received", fetcher);
}

async function deliverKey(
  key: string,
  channel: Channel,
  ticketId: string,
  event: WhatsAppEvent,
  fetcher: typeof fetch,
): Promise<string> {
  const db = await admin();
  // Compare-and-swap claim, so two runs never send the same receipt.
  const { data: row } = await db
    .from("outbox")
    .select("status,created_at")
    .eq("key", key)
    .maybeSingle();
  const before = RETRIES.indexOf(row?.status ?? "");
  if (!row || before < 0) return "SKIPPED";
  const { data: claimed } = await db
    .from("outbox")
    .update({ status: "SENDING" })
    .eq("key", key)
    .eq("status", row.status)
    .select("key");
  if (!claimed?.length) return "SKIPPED";
  const job = row;
  const set = (status: string) =>
    db.from("outbox").update({ status }).eq("key", key).eq("status", "SENDING");
  if (+new Date(job.created_at) < Date.now() - HOUR) {
    await set("EXPIRED");
    return "EXPIRED";
  }
  const { data: t } = await db
    .from("tickets")
    .select("receipt_enc,customer_enc")
    .eq("id", ticketId)
    .maybeSingle();
  if (!t?.receipt_enc || !t.customer_enc) {
    await set("FAILED");
    return "FAILED";
  }
  const receipt = JSON.parse(await decrypt(t.receipt_enc)) as Receipt;
  const customer = JSON.parse(await decrypt(t.customer_enc)) as {
    name?: string;
    phone?: string;
    email?: string;
  };
  try {
    const result =
      channel === "whatsapp"
        ? provider() === "bevatel"
          ? await sendBevatel(ticketId, event, customer, receipt, fetcher)
          : await sendWhatsApp(ticketId, customer.phone ?? "", receipt, fetcher, event)
        : await sendEmail(ticketId, customer.email ?? "", receipt, fetcher);
    if (result.ok) {
      if (result.messageId)
        await db.from("outbox").insert({
          key: "wamid:" + (await sha256(result.messageId)),
          type: "WHATSAPP_MESSAGE_REF",
          ticket_id: ticketId,
          status: "REF",
        });
      await set("ACCEPTED");
      return "ACCEPTED";
    }
    const next =
      result.retry && before < 2
        ? `QUEUED_RETRY_${before + 1}`
        : result.ambiguous
          ? "UNKNOWN"
          : "FAILED";
    await set(next);
    return next.startsWith("QUEUED") ? "QUEUED" : next;
  } catch {
    // Timed out or the connection dropped: the provider may have sent it. Never resend.
    await set("UNKNOWN");
    return "UNKNOWN";
  }
}

type SendResult = { ok: boolean; messageId?: string; retry?: boolean; ambiguous?: boolean };

const text = (s: string, max = 100) => s.replace(/\s+/g, " ").trim().slice(0, max) || "غير محدد";
const trackingUrl = (r: Receipt) => new URL(r.trackingPath, publicOrigin()).toString();

export function whatsappPayload(
  ticketId: string,
  phone: string,
  r: Receipt,
  event: WhatsAppEvent = "received",
) {
  const update = { number: r.number, brand: text(r.brand), tracking_url: trackingUrl(r) };
  const parameters: Record<string, string> =
    event === "resolved"
      ? update
      : event === "closed"
        ? { number: r.number, brand: text(r.brand) }
        : {
            number: r.number,
            brand: text(r.brand),
            branch: text(r.branch),
            received_at: receiptTime(r.receivedAt),
            category: text(r.category),
            order: text(r.externalOrder),
            summary: text(r.description, 180),
            tracking_url: trackingUrl(r),
          };
  const name =
    event === "received"
      ? env("WHATSAPP_TEMPLATE_NAME")
      : env(event === "resolved" ? "WHATSAPP_TEMPLATE_RESOLVED" : "WHATSAPP_TEMPLATE_CLOSED");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizePhone(phone),
    type: "template",
    biz_opaque_callback_data: ticketId,
    template: {
      name,
      language: { code: env("WHATSAPP_TEMPLATE_LANGUAGE") || "ar" },
      components: [
        {
          type: "body",
          parameters: Object.entries(parameters).map(([parameter_name, value]) => ({
            type: "text",
            parameter_name,
            text: value,
          })),
        },
      ],
    },
  };
}

async function sendWhatsApp(
  ticketId: string,
  phone: string,
  r: Receipt,
  fetcher: typeof fetch,
  event: WhatsAppEvent = "received",
): Promise<SendResult> {
  if (!phone || !r.trackingPath) return { ok: false };
  const payload = whatsappPayload(ticketId, phone, r, event);
  if (!payload.template.name) return { ok: false };
  const res = await fetcher(
    `https://graph.facebook.com/${env("WHATSAPP_API_VERSION") || "v23.0"}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    },
  );
  const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
  const messageId = body.messages?.[0]?.id;
  if (res.ok && messageId) return { ok: true, messageId };
  return { ok: false, retry: res.status === 429, ambiguous: res.ok || res.status >= 500 };
}

/*
 * Bevatel (https://developers.bevatel.com): the customer is a Bevatel contact,
 * and the message is an approved WhatsApp template sent on the WhatsApp channel,
 * so it also appears in the Bevatel inbox. Template variables are positional:
 *   received: number, brand, branch, received_at, category, order, summary, tracking_url
 *   resolved: number, brand, tracking_url
 *   closed:   number, brand
 */
const BEVATEL = "https://api.bevatel.com/v1";

export function bevatelParams(event: WhatsAppEvent, r: Receipt) {
  if (event === "resolved") return [r.number, text(r.brand), trackingUrl(r)];
  if (event === "closed") return [r.number, text(r.brand)];
  return [
    r.number,
    text(r.brand),
    text(r.branch),
    receiptTime(r.receivedAt),
    text(r.category),
    text(r.externalOrder),
    text(r.description, 180),
    trackingUrl(r),
  ];
}

type BevatelBody = { data?: unknown; details?: { data?: unknown } };
/** Lists come back under `details.data` in Bevatel's schema and under `data` in its examples. */
const listOf = (b: BevatelBody) =>
  (Array.isArray(b.data) ? b.data : Array.isArray(b.details?.data) ? b.details.data : []) as Record<
    string,
    unknown
  >[];

async function bevatel(path: string, fetcher: typeof fetch, body?: unknown) {
  const res = await fetcher(BEVATEL + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${env("BEVATEL_API_KEY")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  });
  return { res, json: (await res.json().catch(() => ({}))) as BevatelBody };
}

let bevatelCache: { channel?: string; templates: Record<string, string> } = { templates: {} };
export function resetBevatelCache() {
  bevatelCache = { templates: {} };
}

/** The WhatsApp channel: BEVATEL_CHANNEL_ID, or the only active WhatsApp channel. */
async function bevatelChannel(fetcher: typeof fetch) {
  if (env("BEVATEL_CHANNEL_ID")) return env("BEVATEL_CHANNEL_ID");
  if (bevatelCache.channel) return bevatelCache.channel;
  const { res, json } = await bevatel("/conversations/channels?page=1&limit=100", fetcher);
  if (!res.ok) return "";
  const wa = listOf(json).filter(
    (c) => c["is_active"] !== false && /whats/i.test(String(c["channel_type"] ?? "")),
  );
  if (wa.length !== 1) return "";
  return (bevatelCache.channel = String(wa[0]!["id"] ?? ""));
}

async function bevatelTemplateId(name: string, channel: string, fetcher: typeof fetch) {
  const cached = bevatelCache.templates[channel + ":" + name];
  if (cached) return cached;
  const q = new URLSearchParams({ channel_id: channel, name, page: "1", limit: "50" });
  const { res, json } = await bevatel("/messages/whatsapp/templates?" + q, fetcher);
  if (!res.ok) return "";
  const t = listOf(json).find(
    (x) => x["name"] === name && /approved/i.test(String(x["status"] ?? "")),
  );
  const id = String(t?.["_id"] ?? t?.["id"] ?? "");
  if (id) bevatelCache.templates[channel + ":" + name] = id;
  return id;
}

/** The customer's Bevatel contact, created once and remembered by phone hash. */
async function bevatelContact(
  ticketId: string,
  phone: string,
  name: string,
  fetcher: typeof fetch,
) {
  const db = await admin();
  const e164 = "+" + normalizePhone(phone);
  const key = "bvcontact:" + (await keyedHash("bevatel:" + e164));
  const { data: known } = await db.from("outbox").select("status").eq("key", key).maybeSingle();
  if (known?.status) return known.status as string;
  const { res, json } = await bevatel("/contacts", fetcher, {
    full_name: name.trim().slice(0, 100) || "عميل " + e164.slice(-4),
    phone_number: e164,
    type: "external",
  });
  let id = res.ok ? String((json.data as { id?: string } | undefined)?.id ?? "") : "";
  if (!id && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
    // Already a contact: find it by phone (the API has no phone search).
    const digits = e164.replace(/\D/g, "");
    for (let page = 1; page <= 40 && !id; page++) {
      const list = await bevatel(`/contacts?page=${page}&per_page=100`, fetcher);
      if (!list.res.ok) break;
      const rows = listOf(list.json);
      const hit = rows.find((c) => String(c["phone_number"] ?? "").replace(/\D/g, "") === digits);
      if (hit) id = String(hit["id"] ?? "");
      if (rows.length < 100) break;
    }
  }
  if (id)
    await db
      .from("outbox")
      .insert({ key, type: "BEVATEL_CONTACT_REF", ticket_id: ticketId, status: id });
  return id;
}

async function sendBevatel(
  ticketId: string,
  event: WhatsAppEvent,
  customer: { name?: string; phone?: string },
  r: Receipt,
  fetcher: typeof fetch,
): Promise<SendResult> {
  if (!customer.phone || !r.trackingPath) return { ok: false };
  // Lookups before the send are safe to retry: nothing has gone to the customer yet.
  let channel: string, templateId: string, contactId: string;
  try {
    channel = await bevatelChannel(fetcher);
    templateId = channel ? await bevatelTemplateId(bevatelTemplate(event), channel, fetcher) : "";
    contactId = templateId
      ? await bevatelContact(ticketId, customer.phone, customer.name ?? "", fetcher)
      : "";
  } catch {
    return { ok: false, retry: true };
  }
  if (!channel || !templateId || !contactId) return { ok: false, retry: true };
  const { res, json } = await bevatel("/messages/whatsapp/template", fetcher, {
    contactId,
    channelId: channel,
    whatsappTemplateId: templateId,
    whatsAppContent: { body_params: bevatelParams(event, r) },
    virtualId: `${event}-${ticketId}`,
  });
  if (res.ok) {
    const d = (json.data ?? {}) as { id?: string; _id?: string; messageId?: string };
    const messageId = d.messageId ?? d._id ?? d.id;
    return messageId ? { ok: true, messageId: String(messageId) } : { ok: true };
  }
  return { ok: false, retry: res.status === 429, ambiguous: res.status >= 500 };
}

/**
 * After a complaint is resolved or closed: send the customer a WhatsApp update,
 * only when they asked for WhatsApp on this complaint and the channel is live.
 * Never throws.
 */
export async function queueUpdate(
  ticketId: string,
  event: Exclude<WhatsAppEvent, "received">,
  fetcher: typeof fetch = fetch,
) {
  try {
    const live = await liveChannels();
    if (!live.whatsapp) return "NOT_CONFIGURED";
    const db = await admin();
    const { data: consent } = await db
      .from("outbox")
      .select("status")
      .eq("key", `receipt:whatsapp:${ticketId}`)
      .maybeSingle();
    if (!consent || [HELD, "RATE_LIMITED"].includes(consent.status)) return "NOT_REQUESTED";
    const key = `update:whatsapp:${event}:${ticketId}`;
    const { error } = await db
      .from("outbox")
      .insert({ key, type: "CUSTOMER_UPDATE_WHATSAPP", ticket_id: ticketId, status: "QUEUED" });
    if (error) return "DUPLICATE";
    return await deliverKey(key, "whatsapp", ticketId, event, fetcher);
  } catch {
    return "FAILED";
  }
}

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export function emailContent(r: Receipt) {
  const link = new URL(r.trackingPath, publicOrigin()).toString();
  const rows: [string, string][] = [
    ["رقم الشكوى", r.number],
    ["العلامة", r.brand],
    ["الفرع", r.branch],
    ["وقت الاستقبال (الرياض)", receiptTime(r.receivedAt)],
    ["التصنيف", r.category],
    ["رقم الطلب", r.externalOrder || "غير محدد"],
    ["تفاصيل المشكلة", r.description],
  ];
  const subject = `تم استلام شكواك ${r.number}`;
  const text = [
    subject,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "للتفاصيل الكاملة ومتابعة الشكوى:",
    link,
  ].join("\n");
  const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f6f4f1;font-family:Tahoma,Arial,sans-serif;color:#1f1b18">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border:1px solid #e6e0d8;border-radius:12px;padding:24px">
<h1 style="margin:0 0 16px;font-size:20px">${escape(subject)}</h1>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6">
${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b625a;width:40%;vertical-align:top">${escape(k)}</td><td style="padding:6px 0">${escape(v)}</td></tr>`).join("\n")}
</table>
<p style="margin:20px 0 0"><a href="${escape(link)}" style="display:inline-block;background:#b62e30;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">متابعة الشكوى</a></p>
</div>
<p style="font-size:12px;color:#6b625a;margin:16px 4px 0">وصلتك هذه الرسالة لأنك طلبت تأكيد الشكوى عبر البريد. لا ترد على هذه الرسالة.</p>
</div></body></html>`;
  return { subject, text, html };
}

async function sendEmail(
  ticketId: string,
  email: string,
  r: Receipt,
  fetcher: typeof fetch,
): Promise<SendResult> {
  if (!email || !r.trackingPath) return { ok: false };
  const domain = env("EMAIL_SENDER_DOMAIN");
  const { subject, text, html } = emailContent(r);
  const res = await fetcher("https://api.lovable.dev/v1/messaging/email/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `receipt-email-${ticketId}`,
    },
    body: JSON.stringify({
      to: email,
      from: `"${(env("EMAIL_SENDER_NAME") || "Aliz Globe").replace(/["\\\r\n]/g, "")}" <no-reply@${domain}>`,
      sender_domain: domain,
      subject,
      html,
      text,
      purpose: "transactional",
      label: "complaint_receipt",
      idempotency_key: `receipt-email-${ticketId}`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return { ok: true };
  return { ok: false, retry: res.status === 429 || res.status >= 500 };
}

/**
 * Cron run: retry queued receipts, expire ones older than an hour, and mark sends
 * that never finished as UNKNOWN (they are not resent).
 */
export async function runQueue(fetcher: typeof fetch = fetch) {
  const db = await admin();
  const now = Date.now();
  await db
    .from("outbox")
    .update({ status: "UNKNOWN" })
    .like("key", "receipt:%")
    .eq("status", "SENDING")
    .lt("created_at", new Date(now - 10 * 60_000).toISOString());
  await db
    .from("outbox")
    .update({ status: "EXPIRED" })
    .like("key", "receipt:%")
    .in("status", RETRIES)
    .lt("created_at", new Date(now - HOUR).toISOString());
  const live = await liveChannels();
  for (const stale of ["SENDING"] as const)
    await db
      .from("outbox")
      .update({ status: "UNKNOWN" })
      .like("key", "update:%")
      .eq("status", stale)
      .lt("created_at", new Date(now - 10 * 60_000).toISOString());
  await db
    .from("outbox")
    .update({ status: "EXPIRED" })
    .like("key", "update:%")
    .in("status", RETRIES)
    .lt("created_at", new Date(now - HOUR).toISOString());
  const [{ data: receipts }, { data: updates }] = await Promise.all([
    db
      .from("outbox")
      .select("key,status,ticket_id")
      .like("key", "receipt:%")
      .in("status", RETRIES)
      .order("created_at")
      .limit(20),
    db
      .from("outbox")
      .select("key,status,ticket_id")
      .like("key", "update:%")
      .in("status", RETRIES)
      .order("created_at")
      .limit(20),
  ]);
  const jobs = [...((receipts ?? []) as Job[]), ...((updates ?? []) as Job[])];
  let sent = 0;
  for (const job of jobs) {
    const parts = job.key.split(":");
    const channel = parts[1] as Channel;
    if (!live[channel]) continue;
    const status =
      parts[0] === "update"
        ? await deliverKey(job.key, channel, job.ticket_id, parts[2] as WhatsAppEvent, fetcher)
        : await deliver(channel, job.ticket_id, fetcher);
    if (status === "ACCEPTED") sent++;
  }
  return { processed: jobs.length, sent };
}

const order = ["SENDING", "UNKNOWN", "ACCEPTED", "SENT", "DELIVERED", "READ"];
/** Apply delivery reports from Meta's webhook. Only moves forward; ignores unknown messages. */
export async function applyWhatsAppStatuses(body: unknown) {
  const db = await admin();
  const entries =
    (
      body as {
        entry?: {
          changes?: {
            field?: string;
            value?: {
              metadata?: { phone_number_id?: string };
              statuses?: { id?: string; status?: string; recipient_id?: string }[];
            };
          }[];
        }[];
      }
    )?.entry ?? [];
  for (const entry of entries)
    for (const change of entry.changes ?? []) {
      if (
        change.field !== "messages" ||
        change.value?.metadata?.phone_number_id !== env("WHATSAPP_PHONE_NUMBER_ID")
      )
        continue;
      for (const s of change.value.statuses ?? []) {
        const next = (
          { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" } as Record<
            string,
            string
          >
        )[s.status ?? ""];
        if (!next || !s.id) continue;
        const { data: ref } = await db
          .from("outbox")
          .select("ticket_id")
          .eq("key", "wamid:" + (await sha256(s.id)))
          .maybeSingle();
        if (!ref) continue;
        const { data: t } = await db
          .from("tickets")
          .select("phone_hash")
          .eq("id", ref.ticket_id)
          .maybeSingle();
        if (
          !t?.phone_hash ||
          t.phone_hash !== (await keyedHash("phone:" + normalizePhone(s.recipient_id ?? "")))
        )
          continue;
        const allowed =
          next === "FAILED"
            ? order.slice(0, 4)
            : order.slice(0, order.indexOf(next)).concat(next === "SENT" ? [] : ["FAILED"]);
        await db
          .from("outbox")
          .update({ status: next })
          .eq("key", `receipt:whatsapp:${ref.ticket_id}`)
          .in("status", allowed);
      }
    }
}

/** Counts per status for the Settings panel. No personal data. */
export async function channelStatus(channel: Channel) {
  const db = await admin();
  const s = await settings();
  const { data } = await db
    .from("outbox")
    .select("status")
    .eq("type", TYPE[channel])
    .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
    .limit(5000);
  const statuses: Record<string, number> = {};
  for (const r of data ?? []) {
    const k = r.status.startsWith("QUEUED") ? "QUEUED" : r.status;
    statuses[k] = (statuses[k] ?? 0) + 1;
  }
  const missing = missingConfig(channel);
  const enabled = channel === "whatsapp" ? s.whatsapp : s.emailReceipts;
  return {
    enabled,
    ready: enabled && missing.length === 0,
    missing,
    statuses,
    provider: channel === "whatsapp" ? provider() : "lovable",
  };
}
