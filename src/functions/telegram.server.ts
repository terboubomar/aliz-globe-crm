import {
  DomainError,
  categoryLabels,
  roleLabels,
  stateLabels,
  ticketNumber,
  type Actor,
} from "@/lib/domain";
import { addDays, riyadhDay, riyadhISO, weekDays } from "@/aliz/schedule-time";
import { admin, rpcError, settings } from "./core.server";
import { decrypt, encrypt, keyedHash, randomToken } from "./crypto.server";

/*
 * Telegram bot for staff.
 *
 * Linking: a signed-in staff member asks for a one-time link (valid 10 minutes),
 * opens the bot and presses Start; the CRM then shows "is this your account?"
 * and only links after they confirm. Nothing is linked from the bot alone.
 *
 * Messages: assigned complaints with a "received" button (to the owner),
 * deadline warnings (owner) and missed deadlines (owner and super admins), new
 * complaints and a 09:00 daily summary (super admins), a reminder within the
 * hour before each shift and next week's schedule every Saturday evening.
 * Menu buttons and commands: /today /week /next /cases, and /summary /team
 * /unassigned for super admins. The only action possible from Telegram is
 * "received — start work" on one's own complaint.
 * No customer names, phone numbers or complaint text are ever sent.
 *
 * State lives in the service-only outbox table (no schema change):
 *   tglink:<userId>   the person's link, encrypted
 *   tgcode:<hash>     one-time code -> user
 *   tgchat:<hash>     Telegram chat -> user
 *   tg:<event>        sent-message markers, so nothing is sent twice
 */

type Account = { chatId: string; label: string };
type Link = {
  codeHash?: string | undefined;
  expiresAt?: string | undefined;
  pending?: Account | undefined;
  pendingHash?: string | undefined;
  account?: Account | undefined;
  chatHash?: string | undefined;
  linkedAt?: string | undefined;
};
const env = (k: string) => process.env[k] ?? "";
const TZ = "Asia/Riyadh";
const SUPER = "SUPER_ADMIN";
const OPEN = ["NEW", "TRIAGED", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS"];

function origin() {
  try {
    const u = new URL(env("PUBLIC_APP_ORIGIN"));
    return u.protocol === "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
      !u.username
      ? u.origin
      : "";
  } catch {
    return "";
  }
}

export function missingConfig() {
  const missing: string[] = [];
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(env("TELEGRAM_BOT_TOKEN")))
    missing.push("TELEGRAM_BOT_TOKEN");
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(env("TELEGRAM_BOT_USERNAME")))
    missing.push("TELEGRAM_BOT_USERNAME");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(env("TELEGRAM_WEBHOOK_SECRET")))
    missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (!origin()) missing.push("PUBLIC_HTTPS_APP_ORIGIN");
  return missing;
}
export async function ready() {
  return (await settings()).telegram && missingConfig().length === 0;
}

/* ---------------- storage in the outbox table ---------------- */
async function getRow(key: string) {
  const db = await admin();
  const { data } = await db.from("outbox").select("ticket_id,status").eq("key", key).maybeSingle();
  return data;
}
async function putRow(key: string, type: string, ref: string, status: string) {
  const db = await admin();
  const { error } = await db
    .from("outbox")
    .upsert({ key, type, ticket_id: ref, status }, { onConflict: "key" });
  rpcError(error);
}
async function delRow(key: string) {
  const db = await admin();
  await db.from("outbox").delete().eq("key", key);
}
async function loadLink(userId: string): Promise<Link> {
  const row = await getRow("tglink:" + userId);
  if (!row?.status) return {};
  try {
    return JSON.parse(await decrypt(row.status)) as Link;
  } catch {
    return {};
  }
}
async function saveLink(userId: string, link: Link) {
  await putRow("tglink:" + userId, "TELEGRAM_LINK", userId, await encrypt(JSON.stringify(link)));
}
/** Marks an event as sent; false if it already was. */
async function once(key: string, ref: string) {
  const db = await admin();
  const { error } = await db
    .from("outbox")
    .insert({ key: "tg:" + key, type: "TELEGRAM_SENT", ticket_id: ref, status: "SENT" });
  return !error;
}

/* ---------------- linking ---------------- */
export async function accountState(a: Actor) {
  const link = await loadLink(a.id);
  const pending = link.pending && link.expiresAt && Date.parse(link.expiresAt) > Date.now();
  return {
    available: await ready(),
    linked: !!link.linkedAt,
    label: link.account?.label ?? null,
    pending: pending ? { label: link.pending!.label, fingerprint: link.pendingHash! } : null,
    expiresAt: link.expiresAt ?? null,
  };
}

export async function beginLink(a: Actor) {
  if (!(await ready()))
    throw new DomainError("NOT_CONFIGURED", 409, "ربط تيليجرام غير متاح حالياً");
  const link = await loadLink(a.id);
  if (link.codeHash) await delRow("tgcode:" + link.codeHash);
  const code = randomToken(24);
  const codeHash = await keyedHash("tgcode:" + code);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await saveLink(a.id, {
    ...link,
    codeHash,
    expiresAt,
    pending: undefined,
    pendingHash: undefined,
  });
  await putRow("tgcode:" + codeHash, "TELEGRAM_CODE", a.id, "REF");
  return { url: `https://t.me/${env("TELEGRAM_BOT_USERNAME")}?start=${code}`, expiresAt };
}

/** /start <code> from the bot: remember who pressed Start, to be confirmed in the CRM. */
export async function receiveStart(code: string, from: Account) {
  const codeHash = await keyedHash("tgcode:" + code);
  const ref = await getRow("tgcode:" + codeHash);
  if (!ref) return false;
  await delRow("tgcode:" + codeHash); // one use only
  const userId = ref.ticket_id;
  const link = await loadLink(userId);
  if (link.codeHash !== codeHash || !link.expiresAt || Date.parse(link.expiresAt) <= Date.now())
    return false;
  if (!(await enabledUser(userId))) return false;
  await saveLink(userId, {
    ...link,
    codeHash: undefined,
    pending: from,
    pendingHash: await keyedHash("tgchat:" + from.chatId),
  });
  return true;
}

export async function confirmLink(a: Actor, fingerprint: string) {
  const link = await loadLink(a.id);
  if (
    !link.pending ||
    link.pendingHash !== fingerprint ||
    !link.expiresAt ||
    Date.parse(link.expiresAt) <= Date.now()
  )
    throw new DomainError("LINK_EXPIRED", 409, "انتهت صلاحية الربط؛ أنشئ رابطاً جديداً");
  const taken = await getRow("tgchat:" + fingerprint);
  if (taken && taken.ticket_id !== a.id)
    throw new DomainError("ALREADY_LINKED", 409, "حساب تيليجرام هذا مرتبط بمستخدم آخر");
  if (link.chatHash && link.chatHash !== fingerprint) await delRow("tgchat:" + link.chatHash);
  await saveLink(a.id, {
    account: link.pending,
    chatHash: fingerprint,
    linkedAt: new Date().toISOString(),
  });
  await putRow("tgchat:" + fingerprint, "TELEGRAM_CHAT", a.id, "REF");
  const db = await admin();
  await db.rpc("write_audit", { _actor: a.id, _action: "TELEGRAM_LINKED", _entity: a.id });
  await send(
    link.pending.chatId,
    `✅ <b>تم ربط حسابك بنظام شكاوى أليز</b>\nأهلاً ${esc(a.name)}، استخدم الأزرار بالأسفل لعرض ورديتك وشكاواك.`,
    menu(a.role),
  );
  return { ok: true };
}

export async function disconnect(a: Actor) {
  const link = await loadLink(a.id);
  if (link.chatHash) await delRow("tgchat:" + link.chatHash);
  if (link.codeHash) await delRow("tgcode:" + link.codeHash);
  await delRow("tglink:" + a.id);
  const db = await admin();
  await db.rpc("write_audit", { _actor: a.id, _action: "TELEGRAM_DISCONNECTED", _entity: a.id });
  return { ok: true };
}

type Staff = {
  user_id: string;
  name: string;
  role: string;
  enabled: boolean;
  brand_ids?: string[] | null;
  branch_ids?: string[] | null;
};
async function enabledUser(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("user_roles")
    .select("user_id,name,role,enabled,brand_ids,branch_ids")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.enabled ? (data as Staff) : null;
}
/** The staff member behind a chat, if linked and still enabled. */
async function userByChat(chatId: string) {
  const hash = await keyedHash("tgchat:" + chatId);
  const ref = await getRow("tgchat:" + hash);
  if (!ref) return null;
  const link = await loadLink(ref.ticket_id);
  if (link.chatHash !== hash) return null;
  return enabledUser(ref.ticket_id);
}
async function chatOf(userId: string) {
  const link = await loadLink(userId);
  return link.linkedAt && link.account ? link.account.chatId : null;
}

/* ---------------- sending ---------------- */
type Button = { text: string; url: string } | { text: string; callback_data: string };
type Markup =
  | { inline_keyboard: Button[][] }
  | { keyboard: { text: string }[][]; resize_keyboard: true; is_persistent: true };

/** Text for Telegram's HTML mode: names and labels from the database are escaped. */
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function api(method: string, body: unknown, fetcher: typeof fetch = fetch) {
  try {
    const res = await fetcher(
      `https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      },
    );
    return res.ok ? ((await res.json().catch(() => ({}))) as { result?: unknown }) : null;
  } catch {
    return null;
  }
}

export async function send(
  chatId: string,
  text: string,
  markup?: Markup,
  fetcher: typeof fetch = fetch,
) {
  return !!(await api("sendMessage", message(chatId, text, markup), fetcher));
}
function message(chatId: string, text: string, markup?: Markup) {
  return {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    protect_content: true,
    link_preview_options: { is_disabled: true },
    ...(markup ? { reply_markup: markup } : {}),
  };
}
/** A reply sent back inside the webhook response. */
const reply = (chatId: string, text: string, markup?: Markup) => ({
  method: "sendMessage" as const,
  ...message(chatId, text, markup),
});
const ticketUrl = (id: string) => `${origin()}/?view=tickets&ticket=${id}`;
const openButton = (id: string, text = "فتح الشكوى ↗") => ({ text, url: ticketUrl(id) });

/* Menu buttons under the message box, so nobody has to type commands. */
const MENU: Record<string, string> = {
  "📅 ورديتي اليوم": "today",
  "🗓 جدولي هذا الأسبوع": "week",
  "⏭ الأسبوع القادم": "next",
  "📋 شكاواي": "cases",
  "📊 الملخص": "summary",
  "👥 المناوبون الآن": "team",
  "📥 بدون مسؤول": "unassigned",
  "❓ مساعدة": "help",
};
function menu(role: string): Markup {
  const rows = [
    ["📅 ورديتي اليوم", "📋 شكاواي"],
    ["🗓 جدولي هذا الأسبوع", "⏭ الأسبوع القادم"],
    ...(role === SUPER ? [["📊 الملخص", "👥 المناوبون الآن"], ["📥 بدون مسؤول"]] : []),
    ["❓ مساعدة"],
  ];
  return {
    keyboard: rows.map((r) => r.map((text) => ({ text }))),
    resize_keyboard: true,
    is_persistent: true,
  };
}

const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TZ,
  }).format(new Date(iso));
const dayName = (day: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: TZ,
    calendar: "gregory",
  }).format(new Date(riyadhISO(day, "12:00")));
const MILESTONES: Record<string, string> = {
  FIRST_ACTION: "أول إجراء",
  ACKNOWLEDGMENT: "الاستلام",
  REMEDY: "الحل",
};

type TicketRow = {
  id: string;
  sequence: number;
  created_at: string;
  brand_id: string;
  branch_id: string | null;
  priority: string;
  category: string;
  state: string;
  source: string;
  resolution_owner: string | null;
  received_at: string;
  acknowledged_at: string | null;
};
async function ticketInfo(ticketId: string) {
  const db = await admin();
  const { data: t } = await db
    .from("tickets")
    .select(
      "id,sequence,created_at,brand_id,branch_id,priority,category,state,source,resolution_owner,received_at,acknowledged_at",
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (!t) return null;
  const [{ data: brand }, { data: branch }] = await Promise.all([
    db.from("brands").select("name").eq("id", t.brand_id).maybeSingle(),
    t.branch_id
      ? db.from("branches").select("name").eq("id", t.branch_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    t: t as TicketRow,
    brand: brand?.name ?? "",
    branch: (branch as { name: string } | null)?.name ?? "غير محدد",
  };
}
type Info = NonNullable<Awaited<ReturnType<typeof ticketInfo>>>;
const urgent = (t: TicketRow) => t.priority === "P1";
function ticketLines(info: Info) {
  const { t } = info;
  return [
    `<code>${ticketNumber(t.sequence, t.created_at)}</code>`,
    `🏷 ${esc(info.brand)} · 📍 ${esc(info.branch)}`,
    `📂 ${categoryLabels[t.category] ?? esc(t.category)} · ${urgent(t) ? "🔴" : "⚪️"} ${esc(t.priority)} · ${t.source === "PUBLIC_QR" ? "QR" : "الهاتف"}`,
    `🕒 استُقبلت ${clock(t.received_at)}`,
  ];
}
/** Waiting for the owner to pick it up: the acknowledge button applies. */
const awaitingAck = (t: TicketRow) =>
  ["ASSIGNED", "ACKNOWLEDGED"].includes(t.state) && !t.acknowledged_at;
function ticketButtons(info: Info, forOwner: boolean): Markup {
  return {
    inline_keyboard: [
      ...(forOwner && awaitingAck(info.t)
        ? [[{ text: "✅ استلمتها — بدء العمل", callback_data: "ack:" + info.t.id }]]
        : []),
      [openButton(info.t.id)],
    ],
  };
}
async function dueText(ticketId: string, milestone: string) {
  const db = await admin();
  const { data } = await db
    .from("ticket_timers")
    .select("due_at")
    .eq("ticket_id", ticketId)
    .eq("milestone", milestone)
    .is("completed_at", null)
    .maybeSingle();
  return data?.due_at ? `⏳ مهلة ${MILESTONES[milestone]}: قبل ${clock(data.due_at)}` : null;
}

/** Tells the new owner that a complaint was assigned to them. Never throws. */
export async function notifyAssigned(ticketId: string, ownerId: string) {
  try {
    if (!(await ready())) return;
    const chat = await chatOf(ownerId);
    const info = chat ? await ticketInfo(ticketId) : null;
    if (
      !chat ||
      !info ||
      !(await once(`ASSIGNED:${ticketId}:${ownerId}:${info.t.state}`, ticketId))
    )
      return;
    const title = urgent(info.t)
      ? "🔴 <b>شكوى عاجلة أُسندت إليك</b>"
      : "📋 <b>تم إسناد شكوى إليك</b>";
    const due = await dueText(ticketId, "ACKNOWLEDGMENT");
    await send(
      chat,
      [title, "", ...ticketLines(info), ...(due ? [due] : [])].join("\n"),
      ticketButtons(info, true),
    );
  } catch {
    /* alerts must never break the complaint */
  }
}

/** Tells every linked super admin about a new complaint and who got it. Never throws. */
export async function notifyNewComplaint(ticketId: string) {
  try {
    if (!(await ready())) return;
    const db = await admin();
    const [{ data: admins }, info] = await Promise.all([
      db.from("user_roles").select("user_id").eq("role", SUPER).eq("enabled", true),
      ticketInfo(ticketId),
    ]);
    if (!info) return;
    const owner = info.t.resolution_owner ? await enabledUser(info.t.resolution_owner) : null;
    const title = urgent(info.t) ? "🔴 <b>شكوى عاجلة جديدة (P1)</b>" : "🆕 <b>شكوى جديدة</b>";
    const text = [
      title,
      "",
      ...ticketLines(info),
      owner ? `👤 أُسندت تلقائياً إلى: ${esc(owner.name)}` : "📥 لم تُسند بعد",
    ].join("\n");
    for (const a of admins ?? []) {
      const chat = await chatOf(a.user_id);
      if (chat && (await once(`NEW:${ticketId}:${a.user_id}`, ticketId)))
        await send(chat, text, {
          inline_keyboard: [
            [openButton(ticketId, owner ? "فتح الشكوى ↗" : "فتح الشكوى والإسناد ↗")],
          ],
        });
    }
  } catch {
    /* alerts must never break the complaint */
  }
}

/* ---------------- acknowledging from Telegram ---------------- */
/**
 * The owner presses "received" under an assignment alert. Runs the same
 * "start work" action as the CRM, as that person, with the same permission
 * checks; only their own complaint, and nothing else can be done from Telegram.
 */
export async function acknowledge(user: Staff, ticketId: string) {
  const db = await admin();
  const { data: t } = await db
    .from("tickets")
    .select("id,version,state,resolution_owner,acknowledged_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (!t) return { ok: false, text: "الشكوى غير موجودة" };
  if (t.resolution_owner !== user.user_id)
    return { ok: false, text: "هذه الشكوى لم تعد مسندة إليك" };
  if (t.acknowledged_at || !["ASSIGNED", "ACKNOWLEDGED"].includes(t.state))
    return { ok: true, text: "تم استلام هذه الشكوى مسبقاً 👍" };
  const actor: Actor = {
    id: user.user_id,
    name: user.name,
    role: user.role,
    brandIds: user.brand_ids ?? [],
    branchIds: user.branch_ids ?? [],
  };
  try {
    const { ticketActionCore } = await import("./tickets.server");
    await ticketActionCore(
      { supabase: db as never, userId: user.user_id, claims: {} },
      actor,
      ticketId,
      "start",
      { version: t.version, note: "تم الاستلام وبدء العمل عبر تيليجرام" },
    );
    return { ok: true, text: "✅ تم الاستلام وبدأ العمل على الشكوى" };
  } catch (e) {
    return {
      ok: false,
      text: e instanceof DomainError ? e.message : "تعذر تنفيذ الإجراء؛ افتح الشكوى من النظام",
    };
  }
}

/* ---------------- content for commands and scheduled messages ---------------- */
type ShiftRow = {
  id: string;
  user_id: string;
  start_at: string;
  end_at: string;
  break_start: string | null;
  break_end: string | null;
  day_off: boolean;
  lead: boolean;
};
async function shiftsFor(userIds: string[], from: string, to: string) {
  const db = await admin();
  const { data } = await db
    .from("shifts")
    .select("id,user_id,start_at,end_at,break_start,break_end,day_off,lead")
    .in("user_id", userIds)
    .is("cancelled_at", null)
    .lt("start_at", to)
    .gte("start_at", from)
    .order("start_at");
  return (data ?? []) as ShiftRow[];
}
const shiftText = (s: ShiftRow) =>
  s.day_off
    ? "🌴 راحة"
    : `<b>${clock(s.start_at)}–${clock(s.end_at)}</b>` +
      (s.break_start && s.break_end ? ` · ☕️ ${clock(s.break_start)}–${clock(s.break_end)}` : "") +
      (s.lead ? " · ⭐️ قائد الوردية" : "");

export async function todayText(userId: string, now = new Date()) {
  const day = riyadhDay(now);
  const own = await shiftsFor([userId], riyadhISO(day), riyadhISO(addDays(day, 1)));
  const title = `📅 <b>اليوم — ${dayName(day)}</b>`;
  if (!own.length) return `${title}\nلا توجد وردية مسجلة لك اليوم.`;
  return `${title}\n` + own.map(shiftText).join("\n");
}
const weekTitle = (sunday: string, now: Date) =>
  sunday === weekDays(0, now)[0]
    ? "لهذا الأسبوع"
    : sunday === weekDays(1, now)[0]
      ? "للأسبوع القادم"
      : `لأسبوع ${dayName(sunday)}`;
function weekBody(own: ShiftRow[], sunday: string, now: Date) {
  const today = riyadhDay(now);
  const lines = Array.from({ length: 7 }, (_, i) => addDays(sunday, i)).map((d) => {
    const s = own.filter((x) => riyadhDay(x.start_at) === d);
    const mark = d === today ? "👉 " : "";
    return `${mark}${dayName(d)}: ${s.length ? s.map(shiftText).join("، ") : "—"}`;
  });
  return `🗓 <b>جدولك ${weekTitle(sunday, now)}</b>\n\n` + lines.join("\n");
}
export async function weekText(userId: string, offset = 0, now = new Date()) {
  const sunday = weekDays(offset, now)[0]!;
  const own = await shiftsFor([userId], riyadhISO(sunday), riyadhISO(addDays(sunday, 7)));
  return weekBody(own, sunday, now);
}

/**
 * Sends a week's schedule to everyone who has shifts in it and a linked Telegram.
 * - "manual": the schedule manager pressed the button; always sent.
 * - "auto": a schedule was just generated; sent only if it changed since last sent.
 * - "reminder": Saturday evening; once, and not if the same schedule went out in the last day.
 */
export async function sendWeek(
  sunday: string,
  mode: "manual" | "auto" | "reminder",
  now = new Date(),
) {
  const result = { sent: 0, scheduled: 0, notLinked: [] as string[] };
  if (!(await ready())) {
    if (mode === "manual")
      throw new DomainError("NOT_CONFIGURED", 409, "بوت تيليجرام غير مفعّل؛ فعّله من الإعدادات");
    return result;
  }
  if (addDays(sunday, 7) <= riyadhDay(now)) {
    if (mode === "manual")
      throw new DomainError(
        "PAST_WEEK",
        400,
        "هذا الأسبوع انتهى؛ اختر هذا الأسبوع أو أسبوعاً قادماً",
      );
    return result;
  }
  const db = await admin();
  const { data: rows } = await db
    .from("shifts")
    .select("id,user_id,start_at,end_at,break_start,break_end,day_off,lead")
    .is("cancelled_at", null)
    .gte("start_at", riyadhISO(sunday))
    .lt("start_at", riyadhISO(addDays(sunday, 7)))
    .order("start_at");
  const shifts = (rows ?? []) as ShiftRow[];
  const ids = [...new Set(shifts.map((x) => x.user_id))];
  if (!ids.length) return result;
  const { data: staff } = await db
    .from("user_roles")
    .select("user_id,name,enabled")
    .in("user_id", ids)
    .eq("enabled", true);
  for (const p of staff ?? []) {
    result.scheduled++;
    const chat = await chatOf(p.user_id);
    if (!chat) {
      result.notLinked.push(p.name);
      continue;
    }
    const own = shifts
      .filter((x) => x.user_id === p.user_id)
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const hash = (
      await keyedHash(
        "tgweek:" +
          JSON.stringify(
            own.map((x) => [x.start_at, x.end_at, x.break_start, x.break_end, x.day_off, x.lead]),
          ),
      )
    ).slice(0, 32);
    const key = `tgweek:${sunday}:${p.user_id}`;
    const [prevHash, prevAt] = ((await getRow(key))?.status ?? "").split("|");
    if (mode === "reminder") {
      if (!(await once(`WEEK:${sunday}:${p.user_id}`, p.user_id))) continue;
      if (prevHash === hash && +now - Date.parse(prevAt ?? "") < 24 * 3600_000) continue;
    }
    if (mode === "auto" && prevHash === hash) continue;
    const updated = !!prevHash && prevHash !== hash;
    const text =
      (updated
        ? "📝 <b>تم تحديث جدولك</b>\n"
        : mode === "reminder"
          ? ""
          : "📣 <b>جدول جديد</b>\n") + weekBody(own, sunday, now);
    const ok = await send(chat, text, {
      inline_keyboard: [[{ text: "عرض الجدول في النظام ↗", url: `${origin()}/?view=schedule` }]],
    });
    if (ok) {
      result.sent++;
      await putRow(key, "TELEGRAM_WEEK", p.user_id, `${hash}|${now.toISOString()}`);
    }
  }
  return result;
}

async function openCount(userId: string) {
  const db = await admin();
  const { count } = await db
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("resolution_owner", userId)
    .in("state", OPEN);
  return count ?? 0;
}
async function ticketList(rows: TicketRow[], title: string, empty: string) {
  if (!rows.length) return { text: empty };
  const db = await admin();
  const { data: brands } = await db.from("brands").select("id,name");
  const name = (id: string) => brands?.find((b) => b.id === id)?.name ?? id;
  const sorted = [...rows].sort((a, b) => Number(urgent(b)) - Number(urgent(a)));
  const text =
    `${title} (${rows.length})\n\n` +
    sorted
      .map(
        (t) =>
          `${urgent(t) ? "🔴" : "•"} <code>${ticketNumber(t.sequence, t.created_at)}</code> — ${esc(name(t.brand_id))} — ${esc(t.priority)}\n   ${stateLabels[t.state] ?? esc(t.state)} · منذ ${clock(t.received_at)}`,
      )
      .join("\n");
  return {
    text,
    markup: {
      inline_keyboard: sorted
        .slice(0, 8)
        .map((t) => [openButton(t.id, `${ticketNumber(t.sequence, t.created_at)} ↗`)]),
    } as Markup,
  };
}
const LIST_COLUMNS =
  "id,sequence,created_at,brand_id,branch_id,priority,category,state,source,resolution_owner,received_at,acknowledged_at";
export async function casesList(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("tickets")
    .select(LIST_COLUMNS)
    .eq("resolution_owner", userId)
    .in("state", OPEN)
    .order("received_at")
    .limit(20);
  return ticketList(
    (data ?? []) as TicketRow[],
    "📋 <b>شكاواك المفتوحة</b>",
    "📋 لا توجد شكاوى مفتوحة مسندة إليك. 👍",
  );
}
export async function casesText(userId: string) {
  return (await casesList(userId)).text;
}
export async function unassignedList() {
  const db = await admin();
  const { data } = await db
    .from("tickets")
    .select(LIST_COLUMNS)
    .is("resolution_owner", null)
    .in("state", OPEN)
    .order("received_at")
    .limit(20);
  return ticketList(
    (data ?? []) as TicketRow[],
    "📥 <b>شكاوى بدون مسؤول</b>",
    "📥 كل الشكاوى المفتوحة لها مسؤول. 👍",
  );
}
/** Open complaints past a deadline that is still running. */
async function overdueIds(openIds: string[], now: Date) {
  if (!openIds.length) return new Set<string>();
  const db = await admin();
  const { data } = await db
    .from("ticket_timers")
    .select("ticket_id")
    .in("ticket_id", openIds)
    .is("completed_at", null)
    .lte("due_at", now.toISOString());
  return new Set((data ?? []).map((r) => r.ticket_id));
}
export async function summaryText(now = new Date()) {
  const db = await admin();
  const day = riyadhDay(now);
  const since = riyadhISO(day);
  const [{ data: open }, { count: today }, { data: brands }] = await Promise.all([
    db.from("tickets").select("id,brand_id,state,priority,resolution_owner").in("state", OPEN),
    db.from("tickets").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("brands").select("id,name"),
  ]);
  const o = open ?? [];
  const late = await overdueIds(
    o.map((t) => t.id),
    now,
  );
  const byBrand = new Map<string, { open: number; p1: number; late: number }>();
  for (const t of o) {
    const b = byBrand.get(t.brand_id) ?? { open: 0, p1: 0, late: 0 };
    b.open++;
    if (t.priority === "P1") b.p1++;
    if (late.has(t.id)) b.late++;
    byBrand.set(t.brand_id, b);
  }
  const brandLines = [...byBrand.entries()]
    .sort((a, b) => b[1].open - a[1].open)
    .map(([id, b]) => {
      const name = brands?.find((x) => x.id === id)?.name ?? id;
      const extra = [b.p1 ? `${b.p1} عاجلة` : "", b.late ? `${b.late} متأخرة` : ""]
        .filter(Boolean)
        .join("، ");
      return `• ${esc(name)}: ${b.open} مفتوحة${extra ? ` (${extra})` : ""}`;
    });
  return [
    `📊 <b>ملخص الشكاوى — ${dayName(day)}</b>`,
    "",
    `🆕 جديدة اليوم: ${today ?? 0}`,
    `📂 مفتوحة الآن: ${o.length}`,
    `📥 بدون مسؤول: ${o.filter((t) => !t.resolution_owner).length}`,
    `🔴 عاجلة P1 مفتوحة: ${o.filter((t) => t.priority === "P1").length}`,
    `⏰ تجاوزت المهلة: ${late.size}`,
    ...(brandLines.length ? ["", "<b>حسب العلامة</b>", ...brandLines] : []),
  ].join("\n");
}
export async function teamText(now = new Date()) {
  const db = await admin();
  const iso = now.toISOString();
  const { data: on } = await db
    .from("shifts")
    .select("user_id,start_at,end_at,break_start,break_end,day_off,lead,id")
    .is("cancelled_at", null)
    .eq("day_off", false)
    .lte("start_at", iso)
    .gt("end_at", iso);
  if (!on?.length) return "👥 لا يوجد موظف مناوب الآن.";
  const ids = on.map((s) => s.user_id);
  const [{ data: people }, { data: cases }] = await Promise.all([
    db.from("user_roles").select("user_id,name,role").in("user_id", ids),
    db.from("tickets").select("resolution_owner").in("resolution_owner", ids).in("state", OPEN),
  ]);
  const t = Date.parse(iso);
  return (
    `👥 <b>المناوبون الآن (${on.length})</b>\n\n` +
    (on as ShiftRow[])
      .map((s) => {
        const p = people?.find((x) => x.user_id === s.user_id);
        const onBreak =
          s.break_start &&
          s.break_end &&
          Date.parse(s.break_start) <= t &&
          t < Date.parse(s.break_end);
        const load = (cases ?? []).filter((c) => c.resolution_owner === s.user_id).length;
        return `• <b>${esc(p?.name ?? "—")}</b>${s.lead ? " ⭐️" : ""} (${roleLabels[p?.role ?? ""] ?? esc(p?.role ?? "")})\n   حتى ${clock(s.end_at)} · ${load} شكوى مفتوحة${onBreak ? " · ☕️ في استراحة" : ""}`;
      })
      .join("\n")
  );
}

/* ---------------- incoming updates ---------------- */
type From = { id: number; is_bot: boolean; username?: string; first_name?: string };
type Update = {
  message?: {
    text?: string;
    forward_origin?: unknown;
    via_bot?: unknown;
    from?: From;
    chat?: { id: number; type: string };
  };
  callback_query?: {
    id: string;
    from?: From;
    data?: string;
    message?: { message_id: number; chat?: { id: number; type: string } };
  };
};
const HELP_STAFF = [
  "📅 /today — ورديتك اليوم",
  "🗓 /week — جدولك هذا الأسبوع",
  "⏭ /next — جدولك الأسبوع القادم",
  "📋 /cases — شكاواك المفتوحة",
];
const HELP_ADMIN = [
  "📊 /summary — ملخص الشكاوى",
  "👥 /team — المناوبون الآن",
  "📥 /unassigned — شكاوى بدون مسؤول",
];
const ADMIN_ONLY = "هذا الأمر لمسؤول النظام فقط.";
type Reply = Record<string, unknown> & { method: string; text?: string };

async function onCallback(cq: NonNullable<Update["callback_query"]>): Promise<Reply> {
  const answer = (text: string, alert = false) => ({
    method: "answerCallbackQuery",
    callback_query_id: cq.id,
    text,
    show_alert: alert,
  });
  const chat = cq.message?.chat;
  if (!cq.from || cq.from.is_bot || !chat || chat.type !== "private" || chat.id !== cq.from.id)
    return answer("");
  const user = await userByChat(String(chat.id));
  if (!user) return answer("هذا الحساب غير مرتبط بنظام الشكاوى", true);
  const ack = /^ack:([0-9a-f-]{36})$/.exec(cq.data ?? "");
  if (!ack) return answer("");
  const r = await acknowledge(user, ack[1]!);
  if (r.ok && cq.message)
    // Keep only the "open" button under the alert once it is acknowledged.
    await api("editMessageReplyMarkup", {
      chat_id: chat.id,
      message_id: cq.message.message_id,
      reply_markup: { inline_keyboard: [[openButton(ack[1]!)]] },
    });
  return answer(r.text, !r.ok);
}

/** Handles one Telegram update and returns the reply to send back (or null to stay silent). */
export async function handleUpdate(update: Update, now = new Date()): Promise<Reply | null> {
  if (update.callback_query) return onCallback(update.callback_query);
  const m = update.message;
  if (
    !m?.from ||
    !m.chat ||
    m.from.is_bot ||
    m.forward_origin ||
    m.via_bot ||
    m.chat.type !== "private" ||
    m.from.id !== m.chat.id
  )
    return null;
  const chatId = String(m.chat.id);
  const text = (m.text ?? "").trim().slice(0, 200);
  const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{16,64}))?$/.exec(text);
  if (start?.[1]) {
    const label = m.from.username
      ? "@" + m.from.username.slice(0, 32)
      : (m.from.first_name ?? "حساب تيليجرام").slice(0, 100);
    const ok = await receiveStart(start[1], { chatId, label });
    return reply(
      chatId,
      ok
        ? "📨 تم استلام طلب الربط.\nارجع إلى نظام الشكاوى واضغط <b>«تأكيد الربط»</b> لإكماله."
        : "⚠️ رابط الربط غير صالح أو منتهي. أنشئ رابطاً جديداً من نظام الشكاوى.",
    );
  }
  const user = await userByChat(chatId);
  if (!user)
    return reply(
      chatId,
      "🔒 هذا الحساب غير مرتبط.\nاربطه من نظام الشكاوى: القائمة ← <b>حسابي على تيليجرام</b>.",
    );
  const cmd = MENU[text] ?? /^\/(\w+)/.exec(text)?.[1]?.toLowerCase() ?? "help";
  const isAdmin = user.role === SUPER;
  switch (cmd) {
    case "today":
      return reply(chatId, await todayText(user.user_id, now));
    case "week":
      return reply(chatId, await weekText(user.user_id, 0, now));
    case "next":
      return reply(chatId, await weekText(user.user_id, 1, now));
    case "cases": {
      const l = await casesList(user.user_id);
      return reply(chatId, l.text, l.markup);
    }
    case "summary":
      return reply(chatId, isAdmin ? await summaryText(now) : ADMIN_ONLY);
    case "team":
      return reply(chatId, isAdmin ? await teamText(now) : ADMIN_ONLY);
    case "unassigned": {
      if (!isAdmin) return reply(chatId, ADMIN_ONLY);
      const l = await unassignedList();
      return reply(chatId, l.text, l.markup);
    }
    default:
      return reply(
        chatId,
        `أهلاً <b>${esc(user.name)}</b> 👋\nاستخدم الأزرار بالأسفل، أو الأوامر:\n\n` +
          [...HELP_STAFF, ...(isAdmin ? HELP_ADMIN : [])].join("\n"),
        menu(user.role),
      );
  }
}

/* ---------------- scheduled run ---------------- */
const riyadhHour = (now: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TZ }).format(
      now,
    ),
  );
const riyadhWeekday = (now: Date) => new Date(riyadhDay(now) + "T12:00:00Z").getUTCDay();

/**
 * Safe to run as often as wanted (every 5–10 minutes is best for deadline
 * alerts); every message is sent once.
 */
export async function runScheduled(now = new Date()) {
  if (!(await ready())) return { sent: 0 };
  const db = await admin();
  let sent = 0;
  const { data: links } = await db.from("outbox").select("ticket_id").like("key", "tglink:%");
  const { data: staff } = await db
    .from("user_roles")
    .select("user_id,name,role,enabled")
    .in(
      "user_id",
      (links ?? []).map((l) => l.ticket_id),
    )
    .eq("enabled", true);
  const people = (staff ?? []) as Staff[];
  const admins = people.filter((p) => p.role === SUPER);

  // Shift reminders: shifts starting within the next hour.
  const soon = await shiftsFor(
    people.map((p) => p.user_id),
    now.toISOString(),
    new Date(+now + 65 * 60_000).toISOString(),
  );
  for (const s of soon.filter((x) => !x.day_off)) {
    const chat = await chatOf(s.user_id);
    if (!chat || !(await once(`SHIFT:${s.id}`, s.user_id))) continue;
    const open = await openCount(s.user_id);
    const text =
      `⏰ <b>تذكير بورديتك اليوم</b>\n${shiftText(s)}` +
      (open ? `\n\n📋 لديك ${open} شكوى مفتوحة.` : "");
    if (
      await send(
        chat,
        text,
        open
          ? { inline_keyboard: [[{ text: "عرض شكاواي ↗", url: `${origin()}/?view=tickets` }]] }
          : undefined,
      )
    )
      sent++;
  }

  // Deadlines: a warning to the owner shortly before, then the owner and super
  // admins once it is missed. Only deadlines from the last day, so an old
  // backlog does not flood anyone.
  const { data: timers } = await db
    .from("ticket_timers")
    .select("ticket_id,milestone,due_at,warning_at")
    .is("completed_at", null)
    .lte("warning_at", now.toISOString())
    .gt("due_at", new Date(+now - 24 * 3600_000).toISOString());
  const infos = new Map<string, Info | null>();
  for (const tm of timers ?? []) {
    if (!infos.has(tm.ticket_id)) infos.set(tm.ticket_id, await ticketInfo(tm.ticket_id));
    const info = infos.get(tm.ticket_id);
    if (!info || !OPEN.includes(info.t.state)) continue;
    const owner = info.t.resolution_owner;
    const what = MILESTONES[tm.milestone] ?? tm.milestone;
    const missed = Date.parse(tm.due_at) <= +now;
    const key = `${missed ? "LATE" : "WARN"}:${tm.ticket_id}:${tm.milestone}:${tm.due_at}`;
    const ownerName = owner ? ((await enabledUser(owner))?.name ?? "—") : null;
    const lines = (title: string, forOwner: boolean) =>
      [
        title,
        "",
        ...ticketLines(info),
        `⏳ مهلة ${what}: ${clock(tm.due_at)}`,
        ...(!forOwner ? [ownerName ? `👤 المسؤول: ${esc(ownerName)}` : "📥 بدون مسؤول"] : []),
      ].join("\n");
    const targets: { id: string; text: string; owner: boolean }[] = [];
    if (owner)
      targets.push({
        id: owner,
        owner: true,
        text: lines(
          missed
            ? `⚠️ <b>تجاوزت شكواك مهلة ${what}</b>`
            : `⏳ <b>اقتربت مهلة ${what} لشكوى مسندة إليك</b>`,
          true,
        ),
      });
    if (missed || !owner)
      for (const a of admins)
        if (a.user_id !== owner)
          targets.push({
            id: a.user_id,
            owner: false,
            text: lines(
              missed
                ? `⚠️ <b>شكوى تجاوزت مهلة ${what}</b>`
                : `⏳ <b>شكوى بدون مسؤول تقترب مهلتها</b>`,
              false,
            ),
          });
    for (const target of targets) {
      const chat = await chatOf(target.id);
      if (
        chat &&
        (await once(`${key}:${target.id}`, tm.ticket_id)) &&
        (await send(chat, target.text, ticketButtons(info, target.owner)))
      )
        sent++;
    }
  }

  // Saturday from 20:00 Riyadh: next week's schedule (unless it just went out).
  if (riyadhWeekday(now) === 6 && riyadhHour(now) >= 20)
    sent += (await sendWeek(weekDays(1, now)[0]!, "reminder", now)).sent;

  // From 09:00 Riyadh: daily summary for super admins.
  if (riyadhHour(now) >= 9 && riyadhHour(now) < 12) {
    const text = await summaryText(now);
    for (const p of admins) {
      const chat = await chatOf(p.user_id);
      if (
        chat &&
        (await once(`SUMMARY:${riyadhDay(now)}:${p.user_id}`, p.user_id)) &&
        (await send(chat, text, {
          inline_keyboard: [[{ text: "فتح لوحة الشكاوى ↗", url: `${origin()}/?view=tickets` }]],
        }))
      )
        sent++;
    }
  }
  return { sent };
}

/* ---------------- admin ---------------- */
export async function adminStatus(fetcher: typeof fetch = fetch) {
  const db = await admin();
  const s = await settings();
  const [{ data: staff }, { data: links }, { count: sentCount }] = await Promise.all([
    db.from("user_roles").select("user_id,name,role").eq("enabled", true).order("name"),
    db.from("outbox").select("ticket_id").like("key", "tglink:%"),
    db.from("outbox").select("id", { count: "exact", head: true }).like("key", "tg:%"),
  ]);
  const linked = new Set<string>();
  for (const l of links ?? []) if ((await loadLink(l.ticket_id)).linkedAt) linked.add(l.ticket_id);
  const missing = missingConfig();
  // What Telegram itself reports about the connection (no secrets in it).
  let webhook: {
    connected: boolean;
    pending: number;
    lastError: string | null;
    buttons: boolean;
  } | null = null;
  if (!missing.length) {
    const info = (await api("getWebhookInfo", {}, fetcher))?.result as
      | {
          url?: string;
          pending_update_count?: number;
          last_error_message?: string;
          last_error_date?: number;
          allowed_updates?: string[];
        }
      | undefined;
    if (info)
      webhook = {
        connected: info.url === `${origin()}/api/public/webhooks/telegram`,
        pending: info.pending_update_count ?? 0,
        lastError:
          info.last_error_message &&
          info.last_error_date &&
          Date.now() / 1000 - info.last_error_date < 24 * 3600
            ? info.last_error_message.slice(0, 200)
            : null,
        buttons: !info.allowed_updates || info.allowed_updates.includes("callback_query"),
      };
  }
  return {
    enabled: s.telegram,
    ready: s.telegram && !missing.length,
    missing,
    webhook,
    statuses: { SENT: sentCount ?? 0 },
    users: (staff ?? []).map((u) => ({
      id: u.user_id,
      name: u.name,
      role: u.role,
      linked: linked.has(u.user_id),
    })),
  };
}

/** Sends a test message to the admin's own linked Telegram. */
export async function testMessage(a: Actor) {
  if (!(await ready()))
    throw new DomainError("NOT_CONFIGURED", 409, "فعّل البوت وأكمل إعداداته أولاً");
  const chat = await chatOf(a.id);
  if (!chat)
    throw new DomainError(
      "NOT_LINKED",
      409,
      "اربط حسابك على تيليجرام أولاً من «حسابي على تيليجرام»",
    );
  const ok = await send(
    chat,
    `✅ <b>رسالة تجريبية</b>\nالبوت يعمل ويصل إليك، ${esc(a.name)}.\n\n` + (await summaryText()),
    menu(a.role),
  );
  if (!ok)
    throw new DomainError(
      "TELEGRAM_ERROR",
      502,
      "تعذر الإرسال؛ تحقق من رمز البوت أو أعد ربطه بالنظام",
    );
  return { ok: true };
}

/** Points Telegram at this CRM's webhook, with the secret header. */
export async function registerWebhook(fetcher: typeof fetch = fetch) {
  if (missingConfig().length)
    throw new DomainError("NOT_CONFIGURED", 409, "أكمل إعدادات البوت أولاً");
  const ok = await api(
    "setWebhook",
    {
      url: `${origin()}/api/public/webhooks/telegram`,
      secret_token: env("TELEGRAM_WEBHOOK_SECRET"),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    },
    fetcher,
  );
  if (!ok)
    throw new DomainError("TELEGRAM_ERROR", 502, "رفض تيليجرام تسجيل الرابط؛ تحقق من رمز البوت");
  await api(
    "setMyCommands",
    {
      commands: [
        { command: "today", description: "ورديتي اليوم" },
        { command: "week", description: "جدولي هذا الأسبوع" },
        { command: "next", description: "جدولي الأسبوع القادم" },
        { command: "cases", description: "شكاواي المفتوحة" },
        { command: "help", description: "القائمة والمساعدة" },
      ],
    },
    fetcher,
  );
  await api(
    "setMyDescription",
    {
      description:
        "بوت فريق خدمة العملاء في أليز: ورديتك وجدولك الأسبوعي والشكاوى المسندة إليك. يعمل بعد ربط حسابك من نظام الشكاوى.",
    },
    fetcher,
  );
  return { ok: true };
}
