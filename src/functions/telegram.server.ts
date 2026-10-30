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
 * Messages: assigned complaints (to the owner), new complaints and a 09:00
 * daily summary (to super admins), a reminder about an hour before each shift
 * and next week's schedule every Saturday evening (to everyone linked).
 * Commands: /today /week /cases, and /summary /team for super admins.
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
  await send(link.pending.chatId, "تم ربط حسابك بنظام شكاوى أليز. اكتب /help لعرض الأوامر.");
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

type Staff = { user_id: string; name: string; role: string; enabled: boolean };
async function enabledUser(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("user_roles")
    .select("user_id,name,role,enabled")
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
export async function send(
  chatId: string,
  text: string,
  button?: { text: string; url: string },
  fetcher: typeof fetch = fetch,
) {
  try {
    const res = await fetcher(
      `https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message(chatId, text, button)),
        signal: AbortSignal.timeout(8000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
function message(chatId: string, text: string, button?: { text: string; url: string }) {
  return {
    chat_id: chatId,
    text: text.slice(0, 4000),
    protect_content: true,
    link_preview_options: { is_disabled: true },
    ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
  };
}
const ticketUrl = (id: string) => `${origin()}/?view=tickets&ticket=${id}`;

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
};
async function ticketInfo(ticketId: string) {
  const db = await admin();
  const { data: t } = await db
    .from("tickets")
    .select(
      "id,sequence,created_at,brand_id,branch_id,priority,category,state,source,resolution_owner,received_at",
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
function ticketLines(info: NonNullable<Awaited<ReturnType<typeof ticketInfo>>>) {
  const { t } = info;
  return [
    ticketNumber(t.sequence, t.created_at),
    `العلامة: ${info.brand}`,
    `الفرع: ${info.branch}`,
    `الأولوية: ${t.priority}`,
    `التصنيف: ${categoryLabels[t.category] ?? t.category}`,
    `المصدر: ${t.source === "PUBLIC_QR" ? "QR" : "الهاتف"}`,
    `وقت الاستقبال: ${clock(t.received_at)}`,
  ];
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
    const title = info.t.priority === "P1" ? "🔴 شكوى عاجلة أُسندت إليك" : "📋 تم إسناد شكوى إليك";
    await send(chat, [title, ...ticketLines(info)].join("\n"), {
      text: "فتح الشكوى",
      url: ticketUrl(ticketId),
    });
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
    const title = info.t.priority === "P1" ? "🔴 شكوى عاجلة جديدة (P1)" : "🆕 شكوى جديدة";
    const text = [
      title,
      ...ticketLines(info),
      owner ? `أُسندت تلقائياً إلى: ${owner.name}` : "لم تُسند بعد",
    ].join("\n");
    for (const a of admins ?? []) {
      const chat = await chatOf(a.user_id);
      if (chat && (await once(`NEW:${ticketId}:${a.user_id}`, ticketId)))
        await send(chat, text, {
          text: owner ? "فتح الشكوى" : "فتح الشكوى والإسناد",
          url: ticketUrl(ticketId),
        });
    }
  } catch {
    /* alerts must never break the complaint */
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
    ? "راحة"
    : `${clock(s.start_at)}–${clock(s.end_at)}` +
      (s.break_start && s.break_end
        ? ` (استراحة ${clock(s.break_start)}–${clock(s.break_end)})`
        : "") +
      (s.lead ? " • قائد الوردية" : "");

export async function todayText(userId: string, now = new Date()) {
  const day = riyadhDay(now);
  const own = await shiftsFor([userId], riyadhISO(day), riyadhISO(addDays(day, 1)));
  if (!own.length) return `اليوم ${dayName(day)}: لا توجد وردية مسجلة لك.`;
  return `اليوم ${dayName(day)}:\n` + own.map(shiftText).join("\n");
}
export async function weekText(userId: string, offset = 0, now = new Date()) {
  const days = weekDays(offset, now);
  const own = await shiftsFor([userId], riyadhISO(days[0]!), riyadhISO(addDays(days[6]!, 1)));
  const lines = days.map((d) => {
    const s = own.filter((x) => riyadhDay(x.start_at) === d);
    return `${dayName(d)}: ${s.length ? s.map(shiftText).join("، ") : "—"}`;
  });
  return `جدولك ${offset ? "للأسبوع القادم" : "لهذا الأسبوع"}:\n` + lines.join("\n");
}
export async function casesText(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("tickets")
    .select("id,sequence,created_at,brand_id,priority,state")
    .eq("resolution_owner", userId)
    .in("state", OPEN)
    .order("received_at")
    .limit(20);
  if (!data?.length) return "لا توجد شكاوى مفتوحة مسندة إليك. 👍";
  const { data: brands } = await db.from("brands").select("id,name");
  const name = (id: string) => brands?.find((b) => b.id === id)?.name ?? id;
  return (
    `شكاواك المفتوحة (${data.length}):\n` +
    data
      .map(
        (t) =>
          `• ${ticketNumber(t.sequence, t.created_at)} — ${name(t.brand_id)} — ${t.priority} — ${stateLabels[t.state] ?? t.state}`,
      )
      .join("\n")
  );
}
export async function summaryText(now = new Date()) {
  const db = await admin();
  const day = riyadhDay(now);
  const since = riyadhISO(day);
  const [{ data: open }, { count: today }, { data: breached }] = await Promise.all([
    db.from("tickets").select("state,priority,resolution_owner").in("state", OPEN),
    db.from("tickets").select("id", { count: "exact", head: true }).gte("created_at", since),
    db
      .from("ticket_timers")
      .select("ticket_id")
      .not("breached_at", "is", null)
      .is("completed_at", null),
  ]);
  const o = open ?? [];
  return [
    `📊 ملخص اليوم ${dayName(day)}`,
    `شكاوى جديدة اليوم: ${today ?? 0}`,
    `مفتوحة الآن: ${o.length}`,
    `بدون مسؤول: ${o.filter((t) => !t.resolution_owner).length}`,
    `عاجلة P1 مفتوحة: ${o.filter((t) => t.priority === "P1").length}`,
    `تجاوزت المهلة: ${new Set((breached ?? []).map((b) => b.ticket_id)).size}`,
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
  if (!on?.length) return "لا يوجد موظف مناوب الآن.";
  const { data: people } = await db
    .from("user_roles")
    .select("user_id,name,role")
    .in(
      "user_id",
      on.map((s) => s.user_id),
    );
  return (
    "👥 المناوبون الآن:\n" +
    (on as ShiftRow[])
      .map((s) => {
        const p = people?.find((x) => x.user_id === s.user_id);
        const onBreak = s.break_start && s.break_end && s.break_start <= iso && iso < s.break_end;
        return `• ${p?.name ?? "—"} (${roleLabels[p?.role ?? ""] ?? p?.role ?? ""}) حتى ${clock(s.end_at)}${onBreak ? " — في استراحة" : ""}`;
      })
      .join("\n")
  );
}

/* ---------------- incoming updates ---------------- */
type Update = {
  message?: {
    text?: string;
    forward_origin?: unknown;
    via_bot?: unknown;
    from?: { id: number; is_bot: boolean; username?: string; first_name?: string };
    chat?: { id: number; type: string };
  };
};
const HELP_STAFF = [
  "/today — ورديتك اليوم",
  "/week — جدولك هذا الأسبوع",
  "/next — جدولك الأسبوع القادم",
  "/cases — شكاواك المفتوحة",
];
const HELP_ADMIN = ["/summary — ملخص الشكاوى اليوم", "/team — المناوبون الآن"];

/** Handles one Telegram update and returns the reply text (or null to stay silent). */
export async function handleUpdate(
  update: Update,
  now = new Date(),
): Promise<{ chatId: string; text: string } | null> {
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
    return {
      chatId,
      text: ok
        ? "تم استلام طلب الربط. ارجع إلى نظام الشكاوى واضغط «تأكيد الربط» لإكماله."
        : "رابط الربط غير صالح أو منتهي. أنشئ رابطاً جديداً من نظام الشكاوى.",
    };
  }
  const user = await userByChat(chatId);
  if (!user)
    return {
      chatId,
      text: "هذا الحساب غير مرتبط. اربطه من نظام الشكاوى: القائمة ← حسابي على تيليجرام.",
    };
  const cmd = /^\/(\w+)/.exec(text)?.[1]?.toLowerCase() ?? "help";
  const isAdmin = user.role === SUPER;
  switch (cmd) {
    case "today":
      return { chatId, text: await todayText(user.user_id, now) };
    case "week":
      return { chatId, text: await weekText(user.user_id, 0, now) };
    case "next":
      return { chatId, text: await weekText(user.user_id, 1, now) };
    case "cases":
      return { chatId, text: await casesText(user.user_id) };
    case "summary":
      return { chatId, text: isAdmin ? await summaryText(now) : "هذا الأمر لمسؤول النظام فقط." };
    case "team":
      return { chatId, text: isAdmin ? await teamText(now) : "هذا الأمر لمسؤول النظام فقط." };
    default:
      return {
        chatId,
        text:
          `أهلاً ${user.name} 👋\nالأوامر المتاحة:\n` +
          [...HELP_STAFF, ...(isAdmin ? HELP_ADMIN : [])].join("\n"),
      };
  }
}

/* ---------------- scheduled run (hourly) ---------------- */
const riyadhHour = (now: Date) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TZ }).format(
      now,
    ),
  );
const riyadhWeekday = (now: Date) => new Date(riyadhDay(now) + "T12:00:00Z").getUTCDay();

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

  // Shift reminders: shifts starting in the next 30–90 minutes.
  const soon = await shiftsFor(
    people.map((p) => p.user_id),
    new Date(+now + 30 * 60_000).toISOString(),
    new Date(+now + 90 * 60_000).toISOString(),
  );
  for (const s of soon.filter((x) => !x.day_off)) {
    const chat = await chatOf(s.user_id);
    if (
      chat &&
      (await once(`SHIFT:${s.id}`, s.user_id)) &&
      (await send(chat, `⏰ تذكير: ورديتك اليوم ${shiftText(s)}`))
    )
      sent++;
  }

  // Saturday 20:00–20:59 Riyadh: next week's schedule.
  if (riyadhWeekday(now) === 6 && riyadhHour(now) === 20) {
    const sunday = weekDays(1, now)[0]!;
    for (const p of people) {
      const chat = await chatOf(p.user_id);
      if (
        chat &&
        (await once(`WEEK:${sunday}:${p.user_id}`, p.user_id)) &&
        (await send(chat, await weekText(p.user_id, 1, now)))
      )
        sent++;
    }
  }

  // 09:00–09:59 Riyadh: daily summary for super admins.
  if (riyadhHour(now) === 9) {
    const text = await summaryText(now);
    for (const p of people.filter((x) => x.role === SUPER)) {
      const chat = await chatOf(p.user_id);
      if (
        chat &&
        (await once(`SUMMARY:${riyadhDay(now)}:${p.user_id}`, p.user_id)) &&
        (await send(chat, text))
      )
        sent++;
    }
  }
  return { sent };
}

/* ---------------- admin ---------------- */
export async function adminStatus() {
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
  return {
    enabled: s.telegram,
    ready: s.telegram && !missing.length,
    missing,
    statuses: { SENT: sentCount ?? 0 },
    users: (staff ?? []).map((u) => ({
      id: u.user_id,
      name: u.name,
      role: u.role,
      linked: linked.has(u.user_id),
    })),
  };
}

/** Points Telegram at this CRM's webhook, with the secret header. */
export async function registerWebhook(fetcher: typeof fetch = fetch) {
  if (missingConfig().length)
    throw new DomainError("NOT_CONFIGURED", 409, "أكمل إعدادات البوت أولاً");
  const res = await fetcher(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${origin()}/api/public/webhooks/telegram`,
      secret_token: env("TELEGRAM_WEBHOOK_SECRET"),
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok)
    throw new DomainError("TELEGRAM_ERROR", 502, "رفض تيليجرام تسجيل الرابط؛ تحقق من رمز البوت");
  await fetcher(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "today", description: "ورديتي اليوم" },
        { command: "week", description: "جدولي هذا الأسبوع" },
        { command: "next", description: "جدولي الأسبوع القادم" },
        { command: "cases", description: "شكاواي المفتوحة" },
        { command: "help", description: "المساعدة" },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => undefined);
  return { ok: true };
}
