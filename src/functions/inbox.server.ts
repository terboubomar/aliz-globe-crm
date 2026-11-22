// Server-only: the shared WhatsApp inbox. Conversations live in Bevatel (a
// Chatwoot-based inbox); the CRM reads them and sends replies through
// Bevatel's API, so nothing is copied into the CRM database. Only the WhatsApp
// inbox configured in BEVATEL_INBOX_ID is reachable from here.
import { permissionsForRole } from "@/lib/domain";
import { onShiftNow, pickAgent } from "./assign.server";
import { admin, settings } from "./core.server";
import { BevatelError, call, inboxId, listIn, type Json } from "./whatsapp.server";

export type InboxStatus = "open" | "pending" | "resolved";
export type InboxConversation = {
  id: string;
  status: string;
  name: string;
  phone: string;
  unread: number;
  canReply: boolean;
  lastAt: string | null;
  lastText: string;
  lastFromCustomer: boolean;
  assignee: string | null;
  /** The CRM staff member who owns this chat (auto-assigned or set by a lead). */
  owner: string | null;
};
export type InboxMessage = {
  id: string;
  /** customer: from the customer; agent: from us; note: private note; event: system line. */
  kind: "customer" | "agent" | "note" | "event";
  text: string;
  at: string | null;
  status: string | null;
  error: string | null;
  sender: string | null;
  attachments: { type: string; url: string; thumb: string | null; name: string | null }[];
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
/** Chatwoot sends unix seconds; some fields are ISO strings. */
const time = (v: unknown) => {
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};
/** message_type is 0..3 in some replies and a name in others. */
const typeOf = (v: unknown) => {
  const t =
    typeof v === "number" ? v : ["incoming", "outgoing", "activity", "template"].indexOf(str(v));
  return t;
};

function preview(m: Json | undefined) {
  if (!m) return "";
  const text = str(m["content"]).trim();
  if (text) return text.slice(0, 140);
  const att = (m["attachments"] as Json[] | undefined)?.[0];
  return att ? attachmentLabel(str(att["file_type"])) : "";
}
const attachmentLabel = (type: string) =>
  ({ image: "📷 صورة", audio: "🎤 رسالة صوتية", video: "🎬 فيديو", location: "📍 موقع" })[type] ??
  "📎 ملف";

export function toConversation(c: Json): InboxConversation {
  const meta = (c["meta"] ?? {}) as Json;
  const sender = (meta["sender"] ?? {}) as Json;
  const msgs = (c["messages"] as Json[] | undefined) ?? [];
  const last = (c["last_non_activity_message"] as Json | undefined) ?? msgs[msgs.length - 1];
  return {
    id: str(c["id"]),
    status: str(c["status"]) || "open",
    name: str(sender["name"]) || str(sender["phone_number"]) || "عميل",
    phone: str(sender["phone_number"]),
    unread: Number(c["unread_count"] ?? 0) || 0,
    canReply: c["can_reply"] !== false,
    lastAt: time(c["last_activity_at"] ?? c["timestamp"] ?? last?.["created_at"]),
    lastText: preview(last),
    lastFromCustomer: last ? typeOf(last["message_type"]) === 0 : false,
    assignee: str(((meta["assignee"] ?? null) as Json | null)?.["name"]) || null,
    owner: null,
  };
}

export function toMessage(m: Json): InboxMessage {
  const t = typeOf(m["message_type"]);
  const attrs = (m["content_attributes"] ?? {}) as Json;
  const sender = (m["sender"] ?? {}) as Json;
  return {
    id: str(m["id"]),
    kind: m["private"] ? "note" : t === 0 ? "customer" : t === 2 ? "event" : "agent",
    text: str(m["content"]),
    at: time(m["created_at"]),
    status: str(m["status"]) || null,
    error: str(attrs["external_error"]) || null,
    sender: str(sender["available_name"] ?? sender["name"]) || null,
    attachments: ((m["attachments"] as Json[] | undefined) ?? [])
      .filter((a) => str(a["data_url"]).startsWith("https://"))
      .map((a) => ({
        type: str(a["file_type"]) || "file",
        url: str(a["data_url"]),
        thumb: str(a["thumb_url"]).startsWith("https://") ? str(a["thumb_url"]) : null,
        name: str(a["file_name"] ?? a["fallback_title"]) || null,
      })),
  };
}

/** Conversations of the WhatsApp inbox, latest activity first (25 per page). */
export async function listConversations(
  status: InboxStatus | "all",
  page: number,
  fetcher: typeof fetch = fetch,
) {
  const q = new URLSearchParams({
    inbox_id: String(inboxId()),
    status,
    assignee_type: "all",
    page: String(page),
  });
  const res = await call(fetcher, "GET", `/conversations?${q}`);
  const data = (res["data"] ?? res) as Json;
  const list = listIn(data)
    .filter((c) => Number(c["inbox_id"]) === inboxId())
    .map(toConversation);
  const meta = (data["meta"] ?? {}) as Json;
  return { conversations: list, total: Number(meta["all_count"] ?? list.length) || list.length };
}

/** Throws unless the conversation belongs to the configured WhatsApp inbox. */
async function ownConversation(id: string, fetcher: typeof fetch) {
  const c = await call(fetcher, "GET", `/conversations/${encodeURIComponent(id)}`).catch((e) => {
    if (e instanceof BevatelError && /→ 404$/.test(e.message))
      throw new Error("المحادثة غير موجودة");
    throw e;
  });
  if (Number(c["inbox_id"]) !== inboxId()) throw new Error("المحادثة غير موجودة");
  return c;
}

/** One conversation with its messages (the latest 20, or the 20 before `before`). */
export async function conversation(
  id: string,
  before: string | null,
  fetcher: typeof fetch = fetch,
) {
  const c = await ownConversation(id, fetcher);
  const res = await call(
    fetcher,
    "GET",
    `/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`,
  );
  const messages = listIn(res)
    .map(toMessage)
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || Number(a.id) - Number(b.id));
  // Opening the chat marks it read in Bevatel too; a failure here must not hide the chat.
  if (!before)
    await call(fetcher, "POST", `/conversations/${encodeURIComponent(id)}/update_last_seen`).catch(
      () => null,
    );
  return { conversation: toConversation(c), messages, more: messages.length >= 20 };
}

/** Sends a text reply. WhatsApp allows it only within 24 h of the customer's last message. */
export async function reply(id: string, text: string, fetcher: typeof fetch = fetch) {
  const c = await ownConversation(id, fetcher);
  if (c["can_reply"] === false)
    throw new Error(
      "مرّت أكثر من 24 ساعة على آخر رسالة من العميل، ولا يسمح واتساب بالرد الحر. انتظر رسالة جديدة من العميل أو أرسل قالباً معتمداً.",
    );
  const sent = await call(fetcher, "POST", `/conversations/${encodeURIComponent(id)}/messages`, {
    content: text,
    message_type: "outgoing",
    private: false,
  });
  return toMessage(sent);
}

/** Marks the conversation resolved, or opens it again. */
export async function setStatus(
  id: string,
  status: "open" | "resolved",
  fetcher: typeof fetch = fetch,
) {
  await ownConversation(id, fetcher);
  await call(fetcher, "POST", `/conversations/${encodeURIComponent(id)}/toggle_status`, { status });
  return { ok: true };
}

/* ---- who owns each chat (CRM staff) ---- */

export type Staff = { id: string; name: string; role: string };

/** Staff who may own WhatsApp chats: enabled users whose role contacts customers. */
export async function inboxStaff(): Promise<Staff[]> {
  const db = await admin();
  const { data } = await db.from("user_roles").select("user_id,name,role").eq("enabled", true);
  return ((data ?? []) as { user_id: string; name: string; role: string }[])
    .filter((u) => permissionsForRole(u.role).includes("contact"))
    .map((u) => ({ id: u.user_id, name: u.name, role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** Owner of each of these conversations, if any. */
export async function owners(ids: string[]) {
  if (!ids.length) return {} as Record<string, string>;
  const db = await admin();
  const { data } = await db
    .from("whatsapp_assignments" as never)
    .select("conversation_id,assignee")
    .in("conversation_id", ids);
  return Object.fromEntries(
    ((data ?? []) as { conversation_id: string; assignee: string }[]).map((r) => [
      r.conversation_id,
      r.assignee,
    ]),
  );
}

export async function withOwners<T extends { id: string; owner: string | null }>(list: T[]) {
  const map = await owners(list.map((c) => c.id));
  return list.map((c) => ({ ...c, owner: map[c.id] ?? null }));
}

/**
 * Gives every open, unowned WhatsApp chat to an agent on shift: the one with the
 * fewest open chats, then the fewest chats in the last 24 hours (the same rule
 * as complaints). Chats wait when nobody is on shift and are offered again on
 * the next run. Follows the auto-assignment switch in Settings. Returns how many
 * chats were assigned; never throws.
 */
export async function assignNew(fetcher: typeof fetch = fetch, now = new Date()) {
  try {
    if (!(await settings()).autoAssign) return 0;
    const open: InboxConversation[] = [];
    for (let page = 1; page <= 4; page++) {
      const r = await listConversations("open", page, fetcher);
      open.push(...r.conversations);
      if (r.conversations.length < 25) break;
    }
    const owned = await owners(open.map((c) => c.id));
    const waiting = open
      .filter((c) => !owned[c.id])
      .sort((a, b) => (a.lastAt ?? "").localeCompare(b.lastAt ?? ""));
    if (!waiting.length) return 0;

    const db = await admin();
    const { data: agents } = await db
      .from("user_roles")
      .select("user_id,name")
      .eq("role", "AGENT")
      .eq("enabled", true);
    const ids = (agents ?? []).map((a) => a.user_id as string);
    const working = await onShiftNow(ids, now);
    if (!working.size) return 0;
    const { data: recent } = await db
      .from("whatsapp_assignments" as never)
      .select("assignee")
      .in("assignee", ids)
      .gte("assigned_at", new Date(+now - 86400_000).toISOString());
    const candidates = (agents ?? []).map((a) => ({
      id: a.user_id as string,
      name: a.name as string,
      open: Object.values(owned).filter((o) => o === a.user_id).length,
      recent: ((recent ?? []) as { assignee: string }[]).filter((r) => r.assignee === a.user_id)
        .length,
      onShift: working.has(a.user_id as string),
    }));

    let assigned = 0;
    for (const c of waiting) {
      const chosen = pickAgent(candidates);
      if (!chosen) break;
      const { data: row } = await db
        .from("whatsapp_assignments" as never)
        .upsert({ conversation_id: c.id, assignee: chosen.id, assigned_by: "SYSTEM" } as never, {
          onConflict: "conversation_id",
          ignoreDuplicates: true,
        })
        .select("conversation_id");
      // Someone else's run took it first.
      if (!(row as unknown[] | null)?.length) continue;
      chosen.open++;
      chosen.recent++;
      assigned++;
      const tg = await import("./telegram.server");
      await tg.notifyWhatsappAssigned(c.id, chosen.id, c.name);
    }
    return assigned;
  } catch (e) {
    console.error("WhatsApp auto-assign", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Sets (or clears, with null) the owner of a chat. */
export async function assignTo(
  id: string,
  to: string | null,
  actor: string,
  fetcher: typeof fetch = fetch,
) {
  const c = toConversation(await ownConversation(id, fetcher));
  const db = await admin();
  if (!to) {
    await db
      .from("whatsapp_assignments" as never)
      .delete()
      .eq("conversation_id", id);
    return { owner: null };
  }
  if (!(await inboxStaff()).some((s) => s.id === to))
    throw new Error("هذا الموظف لا يستلم محادثات واتساب");
  const { error } = await db.from("whatsapp_assignments" as never).upsert(
    {
      conversation_id: id,
      assignee: to,
      assigned_by: actor,
      assigned_at: new Date().toISOString(),
    } as never,
    { onConflict: "conversation_id" },
  );
  if (error) throw new Error("تعذر حفظ الإسناد");
  if (to !== actor) {
    const tg = await import("./telegram.server");
    await tg.notifyWhatsappAssigned(id, to, c.name);
  }
  return { owner: to };
}
