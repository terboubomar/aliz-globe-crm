import {
  DomainError,
  can,
  inScope,
  normalizePhone,
  saudiMobile,
  slaMilestones,
  ticketNumber,
  type Actor,
} from "@/lib/domain";
import {
  MAX_MESSAGE,
  parseWebhook,
  preview,
  threadId,
  transcript,
  windowOpen,
  type Attachment,
  type InboxEvent,
  type Platform,
} from "@/lib/meta-inbox";
import { admin, catalog, rpcError, settings } from "./core.server";
import { decrypt, encrypt, keyedHash, randomToken, sha256 } from "./crypto.server";

/*
 * Meta inbox: Instagram DMs and Facebook Messenger in the CRM.
 *
 * Connecting: a super admin presses "Connect Meta", signs in with Facebook and
 * picks the brands' Pages (with their Instagram accounts). Each Page's access
 * token is stored encrypted and the Page is subscribed to message webhooks.
 * Each Page is then matched to a brand.
 *
 * Messages arrive through the signed webhook (/api/public/webhooks/meta) and
 * are kept encrypted. The complaints team works them as a shared inbox: open
 * a chat, reply (inside Meta's 24-hour window, or up to 7 days with the
 * human-agent tag), take it, close it, or turn it into a complaint.
 *
 * Secrets: META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN; PUBLIC_APP_ORIGIN
 * for the sign-in return address. Optional META_GRAPH_VERSION.
 */

const env = (k: string) => process.env[k] ?? "";
const NIL = "00000000-0000-0000-0000-000000000000";
const version = () =>
  /^v\d+\.\d+$/.test(env("META_GRAPH_VERSION")) ? env("META_GRAPH_VERSION") : "v23.0";
const graph = (path: string) => `https://graph.facebook.com/${version()}/${path}`;
const SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_messages",
  "business_management",
];
const HUMAN_AGENT_MS = 7 * 24 * 3600_000;

function origin() {
  try {
    const u = new URL(env("PUBLIC_APP_ORIGIN"));
    return u.protocol === "https:" && !u.username ? u.origin : "";
  } catch {
    return "";
  }
}
export const callbackUrl = () => origin() + "/api/public/meta/callback";
export const webhookUrl = () => origin() + "/api/public/webhooks/meta";

export function missingConfig() {
  const missing: string[] = [];
  if (!/^\d{5,20}$/.test(env("META_APP_ID"))) missing.push("META_APP_ID");
  if (env("META_APP_SECRET").length < 16) missing.push("META_APP_SECRET");
  if (env("META_VERIFY_TOKEN").length < 16) missing.push("META_VERIFY_TOKEN");
  if (!origin()) missing.push("PUBLIC_APP_ORIGIN");
  return missing;
}

function superOnly(a: Actor) {
  if (a.role !== "SUPER_ADMIN") throw new DomainError("FORBIDDEN", 403, "متاح لمدير النظام فقط");
}
function canInbox(a: Actor) {
  return can(a, "contact") || a.role === "SUPER_ADMIN";
}

/* ------------------------------ Graph API ------------------------------ */
async function gGet<T>(path: string, token: string, fetcher: typeof fetch = fetch): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetcher(
    graph(path) + (token ? sep + "access_token=" + encodeURIComponent(token) : ""),
  );
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok || body.error) throw new DomainError("META_API", 400, metaError(body.error));
  return body;
}
async function gPost<T>(
  path: string,
  token: string,
  payload: unknown,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const res = await fetcher(graph(path) + "?access_token=" + encodeURIComponent(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  if (!res.ok || body.error) throw new DomainError("META_API", 400, metaError(body.error));
  return body;
}
function metaError(e?: { message?: string; code?: number; error_subcode?: number }) {
  if (e?.code === 10 || e?.error_subcode === 2018278)
    return "انتهت مهلة الرد التي يسمح بها Meta لهذه المحادثة (24 ساعة من آخر رسالة للعميل).";
  if (e?.code === 190) return "انتهت صلاحية ربط Meta؛ أعد الربط من الإعدادات.";
  if (e?.code === 200 || e?.code === 230)
    return "صلاحيات Meta غير كافية؛ أعد الربط ووافق على كل الصلاحيات.";
  return "خطأ من Meta" + (e?.code ? ` (${e.code})` : "");
}

/* ----------------------------- small store ----------------------------- */
async function getValue<T>(key: string): Promise<T | null> {
  const db = await admin();
  const { data } = await db.from("outbox").select("status").eq("key", key).maybeSingle();
  if (!data?.status) return null;
  try {
    return JSON.parse(await decrypt(data.status)) as T;
  } catch {
    return null;
  }
}
async function putValue(key: string, type: string, value: unknown) {
  const db = await admin();
  await db
    .from("outbox")
    .upsert(
      { key, type, ticket_id: NIL, status: await encrypt(JSON.stringify(value)) },
      { onConflict: "key" },
    );
}

/* ------------------------------ connecting ------------------------------ */
export async function beginConnect(a: Actor) {
  superOnly(a);
  const missing = missingConfig();
  if (missing.length)
    throw new DomainError(
      "META_NOT_CONFIGURED",
      400,
      "أكمل إعدادات Meta أولاً: " + missing.join("، "),
    );
  const state = randomToken();
  await putValue("mtstate:" + (await keyedHash("mtstate:" + state)), "META_STATE", {
    userId: a.id,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const q = new URLSearchParams({
    client_id: env("META_APP_ID"),
    redirect_uri: callbackUrl(),
    state,
    response_type: "code",
    scope: SCOPES.join(","),
  });
  return { url: `https://www.facebook.com/${version()}/dialog/oauth?${q}` };
}

type MePage = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

/** Facebook's redirect after sign-in: saves the Pages and subscribes them. Returns where to send the browser. */
export async function finishConnect(code: string, state: string, fetcher: typeof fetch = fetch) {
  const back = (r: string) => "/?view=settings&meta=" + r;
  if (!code || !state || state.length > 100) return back("failed");
  const db = await admin();
  const key = "mtstate:" + (await keyedHash("mtstate:" + state));
  const saved = await getValue<{ userId: string; expiresAt: string }>(key);
  await db.from("outbox").delete().eq("key", key);
  if (!saved || +new Date(saved.expiresAt) < Date.now()) return back("expired");
  try {
    const short = await gGet<{ access_token: string }>(
      "oauth/access_token?" +
        new URLSearchParams({
          client_id: env("META_APP_ID"),
          client_secret: env("META_APP_SECRET"),
          redirect_uri: callbackUrl(),
          code,
        }),
      "",
      fetcher,
    );
    // A long-lived user token gives Page tokens that do not expire.
    const long = await gGet<{ access_token: string }>(
      "oauth/access_token?" +
        new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: env("META_APP_ID"),
          client_secret: env("META_APP_SECRET"),
          fb_exchange_token: short.access_token,
        }),
      "",
      fetcher,
    );
    const pages = await gGet<{ data?: MePage[] }>(
      "me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100",
      long.access_token,
      fetcher,
    );
    let count = 0;
    for (const p of pages.data ?? []) {
      let subscribed = false;
      try {
        await gPost(
          `${p.id}/subscribed_apps`,
          p.access_token,
          { subscribed_fields: ["messages", "message_echoes"] },
          fetcher,
        );
        subscribed = true;
      } catch {
        subscribed = false;
      }
      const { data: existing } = await db
        .from("meta_pages")
        .select("brand_id")
        .eq("page_id", p.id)
        .maybeSingle();
      await db.from("meta_pages").upsert({
        page_id: p.id,
        name: p.name.slice(0, 120),
        ig_id: p.instagram_business_account?.id ?? null,
        ig_username: p.instagram_business_account?.username ?? null,
        brand_id: existing?.brand_id ?? null,
        token_enc: await encrypt(p.access_token),
        subscribed,
        connected_at: new Date().toISOString(),
      });
      count++;
    }
    await db.rpc("write_audit", {
      _actor: saved.userId,
      _action: "META_CONNECTED",
      _entity: String(count),
    });
    return back(count ? "connected" : "nopages");
  } catch {
    return back("failed");
  }
}

export async function setPageBrand(a: Actor, pageId: string, brandId: string | null) {
  superOnly(a);
  const db = await admin();
  const { error } = await db.from("meta_pages").update({ brand_id: brandId }).eq("page_id", pageId);
  rpcError(error);
  await db.from("meta_threads").update({ brand_id: brandId }).eq("page_id", pageId);
  await db.rpc("write_audit", { _actor: a.id, _action: "META_PAGE_BRAND", _entity: pageId });
  return { ok: true };
}

/** Stops receiving and sending for a Page; its conversations stay for the record. */
export async function disconnectPage(a: Actor, pageId: string, fetcher: typeof fetch = fetch) {
  superOnly(a);
  const db = await admin();
  const { data: p } = await db
    .from("meta_pages")
    .select("token_enc")
    .eq("page_id", pageId)
    .maybeSingle();
  if (p?.token_enc) {
    try {
      const token = await decrypt(p.token_enc);
      await fetcher(
        graph(`${pageId}/subscribed_apps`) + "?access_token=" + encodeURIComponent(token),
        {
          method: "DELETE",
        },
      );
    } catch {
      /* Already removed on Meta's side. */
    }
  }
  await db.from("meta_pages").update({ token_enc: "", subscribed: false }).eq("page_id", pageId);
  await db.rpc("write_audit", { _actor: a.id, _action: "META_PAGE_DISCONNECTED", _entity: pageId });
  return { ok: true };
}

export async function status(a: Actor) {
  superOnly(a);
  const db = await admin();
  const [{ data: pages }, last, { count }] = await Promise.all([
    db
      .from("meta_pages")
      .select("page_id,name,ig_id,ig_username,brand_id,subscribed,token_enc")
      .order("name"),
    getValue<{ at: string }>("meta:last"),
    db.from("meta_threads").select("id", { count: "exact", head: true }),
  ]);
  return {
    missing: missingConfig(),
    callbackUrl: origin() ? callbackUrl() : "",
    webhookUrl: origin() ? webhookUrl() : "",
    pages: (pages ?? []).map((p) => ({
      pageId: p.page_id,
      name: p.name,
      igId: p.ig_id,
      igUsername: p.ig_username,
      brandId: p.brand_id,
      connected: !!p.token_enc && p.subscribed,
    })),
    lastMessageAt: last?.at ?? null,
    threads: count ?? 0,
  };
}

/* ------------------------------- webhook ------------------------------- */
async function customerName(
  platform: Platform,
  customerId: string,
  token: string,
  fetcher: typeof fetch,
) {
  try {
    if (platform === "IG") {
      const r = await gGet<{ name?: string; username?: string }>(
        `${customerId}?fields=name,username`,
        token,
        fetcher,
      );
      return (r.name || (r.username ? "@" + r.username : "")).slice(0, 80);
    }
    const r = await gGet<{ first_name?: string; last_name?: string }>(
      `${customerId}?fields=first_name,last_name`,
      token,
      fetcher,
    );
    return [r.first_name, r.last_name].filter(Boolean).join(" ").slice(0, 80);
  } catch {
    return "";
  }
}

async function encAttachments(list: Attachment[]) {
  return Promise.all(
    list.map(async (a) => ({ type: a.type, url: a.url ? await encrypt(a.url) : "" })),
  );
}

/** Stores the messages from one verified webhook call. Unknown Pages are ignored. */
export async function receive(body: unknown, fetcher: typeof fetch = fetch) {
  const events = parseWebhook(body);
  if (!events.length) return { stored: 0 };
  const db = await admin();
  let stored = 0;
  for (const ev of events) {
    const { data: page } = await db
      .from("meta_pages")
      .select("page_id,brand_id,token_enc")
      .eq(ev.platform === "FB" ? "page_id" : "ig_id", ev.accountId)
      .maybeSingle();
    if (!page?.token_enc) continue;
    if (await storeEvent(ev, page, fetcher)) stored++;
  }
  if (stored) await putValue("meta:last", "META_LAST", { at: new Date().toISOString() });
  return { stored };
}

async function storeEvent(
  ev: InboxEvent,
  page: { page_id: string; brand_id: string | null; token_enc: string },
  fetcher: typeof fetch,
) {
  const db = await admin();
  const id = threadId(ev.platform, ev.accountId, ev.customerId);
  const { data: thread } = await db
    .from("meta_threads")
    .select("id,unread,customer_name_enc")
    .eq("id", id)
    .maybeSingle();
  if (!thread) {
    const name = await customerName(
      ev.platform,
      ev.customerId,
      await decrypt(page.token_enc),
      fetcher,
    );
    await db.from("meta_threads").upsert(
      {
        id,
        platform: ev.platform,
        page_id: page.page_id,
        brand_id: page.brand_id,
        customer_id: ev.customerId,
        customer_name_enc: name ? await encrypt(name) : null,
        last_message_at: ev.at,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  }
  // The message id makes this safe to receive twice (Meta retries, and echoes our own replies).
  const { error } = await db.from("meta_messages").insert({
    id: ev.mid,
    thread_id: id,
    direction: ev.direction,
    text_enc: ev.text ? await encrypt(ev.text) : null,
    attachments: (await encAttachments(ev.attachments)) as never,
    sent_by: ev.direction === "OUT" ? "META_APP" : null,
    created_at: ev.at,
  });
  if (error) return false;
  const patch: Record<string, unknown> = {
    last_message_at: ev.at,
    last_text_enc: await encrypt(
      (ev.direction === "OUT" ? "أنت: " : "") + preview(ev.text, ev.attachments),
    ),
  };
  if (ev.direction === "IN")
    Object.assign(patch, {
      last_customer_at: ev.at,
      unread: (thread?.unread ?? 0) + 1,
      status: "OPEN",
    });
  await db
    .from("meta_threads")
    .update(patch as never)
    .eq("id", id);
  return true;
}

/* ------------------------------ staff side ------------------------------ */
type ThreadRow = {
  id: string;
  platform: string;
  page_id: string;
  brand_id: string | null;
  customer_name_enc: string | null;
  last_text_enc: string | null;
  last_message_at: string;
  last_customer_at: string | null;
  unread: number;
  status: string;
  taken_by: string | null;
  ticket_id: string | null;
};
const THREAD_COLS =
  "id,platform,page_id,brand_id,customer_name_enc,last_text_enc,last_message_at,last_customer_at,unread,status,taken_by,ticket_id";

const visible = (a: Actor, brandId: string | null) =>
  brandId ? inScope(a, { brandId, branchId: null }) : a.role === "SUPER_ADMIN";

async function presentThread(
  t: ThreadRow,
  pages: Map<string, string>,
  numbers: Map<string, string>,
) {
  return {
    id: t.id,
    platform: t.platform as Platform,
    pageName: pages.get(t.page_id) ?? "",
    brandId: t.brand_id,
    customer: t.customer_name_enc ? await decrypt(t.customer_name_enc) : "",
    lastText: t.last_text_enc ? await decrypt(t.last_text_enc) : "",
    lastMessageAt: t.last_message_at,
    lastCustomerAt: t.last_customer_at,
    windowOpen: windowOpen(t.last_customer_at),
    unread: t.unread,
    status: t.status,
    takenBy: t.taken_by,
    ticketId: t.ticket_id,
    ticketNumber: t.ticket_id ? (numbers.get(t.ticket_id) ?? null) : null,
  };
}
export type PresentedThread = Awaited<ReturnType<typeof presentThread>>;

async function lookups(rows: ThreadRow[]) {
  const db = await admin();
  const { data: pages } = await db.from("meta_pages").select("page_id,name");
  const ids = rows.map((r) => r.ticket_id).filter(Boolean) as string[];
  const { data: tickets } = ids.length
    ? await db.from("tickets").select("id,sequence,created_at").in("id", ids)
    : { data: [] as { id: string; sequence: number; created_at: string }[] };
  return {
    pages: new Map((pages ?? []).map((p) => [p.page_id, p.name])),
    numbers: new Map(
      (tickets ?? []).map((t) => [t.id, ticketNumber(t.sequence, new Date(t.created_at))]),
    ),
  };
}

export async function listThreads(
  a: Actor,
  f: { filter: "open" | "unread" | "mine" | "closed"; brandId?: string | undefined },
) {
  if (!canInbox(a))
    throw new DomainError("FORBIDDEN", 403, "صندوق الرسائل متاح لفريق خدمة العملاء");
  const db = await admin();
  let q = db
    .from("meta_threads")
    .select(THREAD_COLS)
    .order("last_message_at", { ascending: false })
    .limit(200);
  if (f.filter === "closed") q = q.eq("status", "CLOSED");
  else q = q.eq("status", "OPEN");
  if (f.filter === "unread") q = q.gt("unread", 0);
  if (f.filter === "mine") q = q.eq("taken_by", a.id);
  if (f.brandId) q = q.eq("brand_id", f.brandId);
  const { data, error } = await q;
  rpcError(error);
  const rows = ((data ?? []) as ThreadRow[]).filter((t) => visible(a, t.brand_id));
  const l = await lookups(rows);
  return Promise.all(rows.map((r) => presentThread(r, l.pages, l.numbers)));
}

/** Open conversations with unread messages, for the menu badge. */
export async function unreadCount(a: Actor) {
  if (!canInbox(a)) return { unread: 0 };
  const db = await admin();
  const { data } = await db
    .from("meta_threads")
    .select("brand_id")
    .eq("status", "OPEN")
    .gt("unread", 0)
    .limit(500);
  return { unread: (data ?? []).filter((t) => visible(a, t.brand_id)).length };
}

async function loadThread(a: Actor, id: string) {
  if (!canInbox(a))
    throw new DomainError("FORBIDDEN", 403, "صندوق الرسائل متاح لفريق خدمة العملاء");
  const db = await admin();
  const { data } = await db.from("meta_threads").select(THREAD_COLS).eq("id", id).maybeSingle();
  const t = data as ThreadRow | null;
  if (!t || !visible(a, t.brand_id))
    throw new DomainError("NOT_FOUND", 404, "المحادثة غير موجودة ضمن نطاقك");
  return t;
}

async function messagesOf(id: string) {
  const db = await admin();
  const { data } = await db
    .from("meta_messages")
    .select("id,direction,text_enc,attachments,sent_by,created_at")
    .eq("thread_id", id)
    .order("created_at", { ascending: true })
    .limit(300);
  return Promise.all(
    (data ?? []).map(async (m) => ({
      id: m.id,
      direction: m.direction as "IN" | "OUT",
      text: m.text_enc ? await decrypt(m.text_enc) : "",
      attachments: await Promise.all(
        ((m.attachments as { type: string; url: string }[] | null) ?? []).map(async (x) => ({
          type: x.type,
          url: x.url ? await decrypt(x.url) : "",
        })),
      ),
      sentBy: m.sent_by,
      at: m.created_at,
    })),
  );
}

/** Opening a chat marks it read. */
export async function getThread(a: Actor, id: string) {
  const t = await loadThread(a, id);
  const db = await admin();
  if (t.unread) await db.from("meta_threads").update({ unread: 0 }).eq("id", id);
  const l = await lookups([t]);
  return {
    thread: await presentThread({ ...t, unread: 0 }, l.pages, l.numbers),
    messages: await messagesOf(id),
  };
}

export async function reply(a: Actor, id: string, text: string, fetcher: typeof fetch = fetch) {
  const t = await loadThread(a, id);
  const body = text.trim().slice(0, MAX_MESSAGE);
  if (!body) throw new DomainError("MESSAGE_REQUIRED", 400, "اكتب نص الرسالة");
  const db = await admin();
  const { data: page } = await db
    .from("meta_pages")
    .select("token_enc")
    .eq("page_id", t.page_id)
    .maybeSingle();
  if (!page?.token_enc)
    throw new DomainError("META_DISCONNECTED", 400, "الصفحة غير مربوطة؛ أعد ربط Meta من الإعدادات");
  const customerId = t.id.split(":").slice(2).join(":");
  const sinceCustomer = t.last_customer_at ? Date.now() - +new Date(t.last_customer_at) : Infinity;
  if (sinceCustomer >= HUMAN_AGENT_MS)
    throw new DomainError(
      "WINDOW_CLOSED",
      400,
      "مرّ أكثر من 7 أيام على آخر رسالة من العميل؛ لا يسمح Meta بالرد حتى يراسلنا العميل مجدداً.",
    );
  const payload = {
    recipient: { id: customerId },
    message: { text: body },
    // Within 24 hours a normal reply; after that, Meta's human-agent tag (up to 7 days).
    ...(windowOpen(t.last_customer_at)
      ? { messaging_type: "RESPONSE" }
      : { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }),
  };
  const out = await gPost<{ message_id?: string }>(
    `${t.page_id}/messages`,
    await decrypt(page.token_enc),
    payload,
    fetcher,
  );
  const now = new Date().toISOString();
  await db.from("meta_messages").upsert(
    {
      id: out.message_id || "crm:" + randomToken(12),
      thread_id: id,
      direction: "OUT",
      text_enc: await encrypt(body),
      attachments: [] as never,
      sent_by: a.id,
      created_at: now,
    },
    { onConflict: "id" },
  );
  await db
    .from("meta_threads")
    .update({
      last_message_at: now,
      last_text_enc: await encrypt("أنت: " + preview(body, [])),
      unread: 0,
      taken_by: t.taken_by ?? a.id,
    })
    .eq("id", id);
  return { ok: true };
}

export async function setThread(
  a: Actor,
  id: string,
  change: "take" | "release" | "close" | "reopen",
) {
  const t = await loadThread(a, id);
  const db = await admin();
  const patch =
    change === "take"
      ? { taken_by: a.id }
      : change === "release"
        ? { taken_by: null }
        : change === "close"
          ? { status: "CLOSED", unread: 0 }
          : { status: "OPEN" };
  const { error } = await db.from("meta_threads").update(patch).eq("id", t.id);
  rpcError(error);
  return { ok: true };
}

/** Turns a chat into a complaint (the agent who does it records it, like a phone complaint). */
export async function convert(
  a: Actor,
  id: string,
  input: {
    category: string;
    otherDetail?: string | undefined;
    branchId: string | null;
    unknownReason?: string | undefined;
    priority: "P1" | "P2" | "P3";
    phone?: string | undefined;
    note: string;
  },
) {
  const t = await loadThread(a, id);
  if (!can(a, "create"))
    throw new DomainError("FORBIDDEN", 403, "تسجيل الشكاوى غير متاح لهذا الدور");
  if (t.ticket_id)
    throw new DomainError("ALREADY_CONVERTED", 409, "هذه المحادثة مرتبطة بشكوى بالفعل");
  if (!t.brand_id)
    throw new DomainError("BRAND_REQUIRED", 400, "اربط صفحة Meta بعلامة تجارية من الإعدادات أولاً");
  if (!input.branchId && (input.unknownReason ?? "").trim().length < 3)
    throw new DomainError("BRANCH_REQUIRED", 400, "حدد الفرع أو سبب عدم معرفته");
  const db = await admin();
  if (input.branchId) {
    const { data: br } = await db
      .from("branches")
      .select("id")
      .eq("id", input.branchId)
      .eq("brand_id", t.brand_id)
      .maybeSingle();
    if (!br) throw new DomainError("INVALID_BRANCH", 400, "الفرع لا يتبع علامة هذه الصفحة");
  }
  const lists = await catalog();
  const reason = lists.categories.find((c) => c.id === input.category && c.active);
  if (!reason) throw new DomainError("INVALID_CATEGORY", 400, "اختر سبب الشكوى من القائمة");
  const { asksDetail } = await import("@/lib/catalog");
  const detail = asksDetail(reason) ? (input.otherDetail ?? "").replace(/\s+/g, " ").trim() : "";
  if (asksDetail(reason) && detail.length < 3)
    throw new DomainError("DETAIL_REQUIRED", 400, "اكتب نوع المشكلة عند اختيار «أخرى»");
  let phone = "";
  if (input.phone?.trim()) {
    phone = normalizePhone(input.phone);
    if (!saudiMobile.test(input.phone.replace(/[\s-]/g, "")))
      throw new DomainError("INVALID_PHONE", 400, "رقم الجوال غير صحيح");
  }
  const priority = reason.urgent ? "P1" : input.priority;
  const customer = t.customer_name_enc ? await decrypt(t.customer_name_enc) : "";
  const chat = transcript(
    (await messagesOf(id)).map((m) => ({
      direction: m.direction,
      text: m.text,
      attachments: m.attachments,
      at: m.at,
    })),
    customer,
  );
  const channel = t.platform === "IG" ? "إنستغرام" : "ماسنجر";
  const description = [
    detail ? `نوع المشكلة: ${detail}` : "",
    input.note.trim(),
    `— محادثة ${channel} —`,
    chat,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5000);
  const s = await settings();
  const { data: seq, error: seqErr } = await db.rpc("next_ticket_sequence");
  rpcError(seqErr);
  const now = new Date();
  const number = ticketNumber(Number(seq), now);
  const [{ data: brand }, branchRow] = await Promise.all([
    db.from("brands").select("name").eq("id", t.brand_id).maybeSingle(),
    input.branchId
      ? db.from("branches").select("name").eq("id", input.branchId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const receipt = {
    number,
    brand: brand?.name ?? "",
    branch: branchRow?.data?.name ?? "غير محدد",
    receivedAt: now.toISOString(),
    category: detail ? `${reason.label}: ${detail}` : reason.label,
    description,
    customerName: customer,
    externalOrder: "",
    platform: "",
    source: channel,
    trackingPath: "",
  };
  const { data, error } = await db.rpc("create_ticket_tx", {
    p: {
      idem_key: "meta:" + id + ":" + now.getTime(),
      request_hash: await sha256(id),
      sequence: seq,
      brand_id: t.brand_id,
      branch_id: input.branchId,
      unknown_reason: input.branchId ? null : input.unknownReason,
      source: "SOCIAL_DM",
      category: input.category,
      priority,
      description_enc: await encrypt(description),
      receipt_enc: await encrypt(JSON.stringify(receipt)),
      customer_enc: await encrypt(JSON.stringify({ name: customer, phone })),
      phone_hash: phone ? await keyedHash("phone:" + phone) : null,
      external_order: null,
      platform: null,
      communications_owner: a.id,
      creator: a.id,
      received_at: now.toISOString(),
      sla_policy: s.sla,
      actor: a.id,
      event_type: "SOCIAL_DM_CREATED",
      timers: slaMilestones(priority, now, s.sla),
      access_hash: null,
      response_enc: await encrypt("{}"),
    } as never,
  });
  rpcError(error);
  const out = data as { replay: boolean; id?: string };
  if (!out.id) throw new DomainError("CREATE_FAILED", 500, "تعذر إنشاء الشكوى");
  await db
    .from("meta_threads")
    .update({ ticket_id: out.id, taken_by: t.taken_by ?? a.id })
    .eq("id", id);
  const who = await (await import("./assign.server")).autoAssign(out.id);
  const tg = await import("./telegram.server");
  if (who) await tg.notifyAssigned(out.id, who);
  await tg.notifyNewComplaint(out.id);
  return { id: out.id, number };
}
