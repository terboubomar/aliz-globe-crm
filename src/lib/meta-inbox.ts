/*
 * Meta inbox (Instagram DMs and Facebook Messenger): turning Meta's webhook
 * payloads into plain message events, and the rules around replying. Pure
 * functions so the server and the tests share them.
 */

export type Platform = "FB" | "IG";
export type Attachment = { type: string; url: string };
export type InboxEvent = {
  platform: Platform;
  /** The Facebook Page id, or the Instagram professional account id. */
  accountId: string;
  /** The customer's page-scoped (or Instagram-scoped) id. */
  customerId: string;
  mid: string;
  text: string;
  attachments: Attachment[];
  /** OUT = sent by the business (from the CRM or straight from the Meta apps). */
  direction: "IN" | "OUT";
  at: string;
};

export const MAX_MESSAGE = 1000;
/** Meta allows normal replies only within 24 hours of the customer's last message. */
export const WINDOW_MS = 24 * 3600_000;

type Raw = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: { type?: string; payload?: { url?: string } }[];
  };
};

/** Reads a webhook body; anything that is not a new message (reads, deliveries, reactions) is skipped. */
export function parseWebhook(body: unknown): InboxEvent[] {
  const b = (body ?? {}) as { object?: string; entry?: { id?: string; messaging?: Raw[] }[] };
  const platform: Platform | null =
    b.object === "page" ? "FB" : b.object === "instagram" ? "IG" : null;
  if (!platform || !Array.isArray(b.entry)) return [];
  const out: InboxEvent[] = [];
  for (const e of b.entry) {
    const accountId = String(e.id ?? "");
    for (const m of e.messaging ?? []) {
      const msg = m.message;
      if (!msg?.mid || msg.is_deleted || !accountId) continue;
      const echo = !!msg.is_echo;
      const customerId = String((echo ? m.recipient?.id : m.sender?.id) ?? "");
      if (!customerId || customerId === accountId) continue;
      const attachments = (msg.attachments ?? [])
        .map((a) => ({ type: String(a.type ?? "file"), url: String(a.payload?.url ?? "") }))
        .filter((a) => /^https:\/\//.test(a.url) || a.type !== "file")
        .slice(0, 10);
      const text = (msg.text ?? (msg.is_unsupported ? "[رسالة غير مدعومة]" : "")).slice(0, 4000);
      if (!text && !attachments.length) continue;
      out.push({
        platform,
        accountId,
        customerId,
        mid: msg.mid,
        text,
        attachments,
        direction: echo ? "OUT" : "IN",
        at: new Date(typeof m.timestamp === "number" ? m.timestamp : Date.now()).toISOString(),
      });
    }
  }
  return out;
}

/** One conversation per customer per Page / Instagram account. */
export const threadId = (platform: Platform, accountId: string, customerId: string) =>
  `${platform}:${accountId}:${customerId}`;

export function windowOpen(lastCustomerAt: string | null, now = new Date()) {
  return !!lastCustomerAt && +now - +new Date(lastCustomerAt) < WINDOW_MS;
}

const attachmentNames: Record<string, string> = {
  image: "صورة",
  video: "فيديو",
  audio: "رسالة صوتية",
  file: "ملف",
  share: "منشور مُشارك",
  story_mention: "إشارة في قصة",
  ig_reel: "ريلز",
  reel: "ريلز",
  sticker: "ملصق",
};
export const attachmentLabel = (type: string) => attachmentNames[type] ?? "مرفق";

/** A short preview for the conversation list. */
export function preview(text: string, attachments: Attachment[]) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t) return t.slice(0, 120);
  return attachments.length ? `[${attachmentLabel(attachments[0]!.type)}]` : "";
}

/** The chat written out for the complaint created from it (newest last, capped). */
export function transcript(
  messages: { direction: "IN" | "OUT"; text: string; attachments: Attachment[]; at: string }[],
  customer: string,
) {
  const lines = messages.slice(-30).map((m) => {
    const who = m.direction === "IN" ? customer || "العميل" : "الفريق";
    const body = m.text.trim() || preview("", m.attachments);
    return `${who}: ${body}`;
  });
  return lines.join("\n").slice(0, 3500);
}

export const platformNames: Record<Platform, string> = { FB: "ماسنجر", IG: "إنستغرام" };
