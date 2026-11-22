// Server-only: the customer's 1-5 satisfaction score, given on the tracking
// page once the complaint is solved. Authorized by the private tracking link.
import { DomainError } from "@/lib/domain";
import { admin } from "./core.server";
import { decrypt, encrypt, keyedHash } from "./crypto.server";

const RATEABLE = ["RESOLVED", "CLOSED"];
const MAX_CHANGES = 5;

async function ticketByToken(token: string) {
  const db = await admin();
  const { data } = await db
    .from("tracking_access")
    .select("expires_at, ticket_id, tickets!inner(state)")
    .eq("hash", await keyedHash("track:" + token))
    .maybeSingle();
  if (!data || new Date(data.expires_at) < new Date())
    throw new DomainError("TRACKING_EXPIRED", 404, "رابط المتابعة غير صالح أو منتهي");
  return {
    id: data.ticket_id as string,
    state: (data.tickets as unknown as { state: string }).state,
  };
}

/** The customer's score for a complaint (null when not rated yet). */
export async function ratingOf(ticketId: string) {
  const db = await admin();
  const { data } = await db
    .from("complaint_ratings" as never)
    .select("score,comment_enc")
    .eq("ticket_id", ticketId)
    .maybeSingle();
  const r = data as { score: number; comment_enc: string | null } | null;
  if (!r) return null;
  return {
    score: r.score,
    comment: r.comment_enc ? await decrypt(r.comment_enc).catch(() => "") : "",
  };
}

export const canRate = (state: string) => RATEABLE.includes(state);

/** Saves (or changes) the customer's score; a 1 or 2 alerts the team on Telegram. */
export async function rateByToken(token: string, score: number, comment: string) {
  const t = await ticketByToken(token);
  if (!canRate(t.state))
    throw new DomainError("NOT_SOLVED", 400, "يمكنك تقييم الخدمة بعد معالجة بلاغك.");
  const db = await admin();
  const { count } = await db
    .from("ticket_events")
    .select("id", { count: "exact", head: true })
    .eq("ticket_id", t.id)
    .eq("type", "CUSTOMER_RATED");
  if ((count ?? 0) >= MAX_CHANGES)
    throw new DomainError("RATING_LOCKED", 429, "تم استلام تقييمك، شكراً لك.");
  const text = comment.replace(/\s+/g, " ").trim().slice(0, 500);
  const now = new Date().toISOString();
  const { error } = await db.from("complaint_ratings" as never).upsert(
    {
      ticket_id: t.id,
      score,
      comment_enc: text ? await encrypt(text) : null,
      source: "TRACKING",
      updated_at: now,
    } as never,
    { onConflict: "ticket_id" },
  );
  if (error) throw new DomainError("RATING_FAILED", 500, "تعذر حفظ التقييم، حاول مرة أخرى.");
  // The complaint's history shows the score and comment.
  await db.from("ticket_events").insert({
    ticket_id: t.id,
    type: "CUSTOMER_RATED",
    actor: "CUSTOMER",
    note_enc: await encrypt(`${score} / 5${text ? " — " + text : ""}`),
  } as never);
  if (score <= 2) {
    const tg = await import("./telegram.server");
    await tg.notifyLowRating(t.id, score, text);
  }
  return { score };
}
