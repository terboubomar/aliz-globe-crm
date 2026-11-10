// Server-only: data retention, as promised in the customer privacy notice (/privacy).
//
// - Personal details of a complaint (name, phone, email, the customer's own
//   description, order number, receipt) are removed 2 years after it closed;
//   the complaint stays as an anonymous record for reports.
// - Photos a customer or staff attached to a complaint are deleted after 6
//   months. Refund proofs are financial records and are kept.
// - Flood-protection markers (hashed device IPs) are kept for 1 day only.
import { admin } from "./core.server";

export const RETENTION = { personalYears: 2, photoMonths: 6 } as const;
const DAY = 86_400_000;
const REMOVED = "[حُذفت تفاصيل الشكوى بعد انتهاء مدة الاحتفاظ]";

export function cutoffs(now = new Date()) {
  const personal = new Date(now);
  personal.setUTCFullYear(personal.getUTCFullYear() - RETENTION.personalYears);
  const photos = new Date(now);
  photos.setUTCMonth(photos.getUTCMonth() - RETENTION.photoMonths);
  return { personal, photos, markers: new Date(+now - DAY) };
}

export async function runRetention(now = new Date()) {
  const db = await admin();
  const { encrypt } = await import("./crypto.server");
  const c = cutoffs(now);
  let anonymised = 0,
    photos = 0;

  // 1. Personal details of complaints closed more than 2 years ago.
  const { data: old } = await db
    .from("tickets")
    .select("id")
    .eq("state", "CLOSED")
    .lt("closed_at", c.personal.toISOString())
    .or(
      "customer_enc.not.is.null,phone_hash.not.is.null,receipt_enc.not.is.null,external_order.not.is.null",
    )
    .limit(200);
  if (old?.length) {
    const removed = await encrypt(REMOVED);
    for (const t of old) {
      const { error } = await db
        .from("tickets")
        .update({
          customer_enc: null,
          phone_hash: null,
          receipt_enc: null,
          external_order: null,
          description_enc: removed,
        })
        .eq("id", t.id);
      if (error) continue;
      await db.from("tracking_access").delete().eq("ticket_id", t.id);
      await db
        .from("ticket_events")
        .insert({ ticket_id: t.id, type: "PERSONAL_DATA_REMOVED", actor: "SYSTEM" });
      anonymised++;
    }
  }

  // 2. Complaint photos older than 6 months.
  const { data: files } = await db
    .from("attachments")
    .select("id,ticket_id,storage_key")
    .not("ticket_id", "is", null)
    .lt("created_at", c.photos.toISOString())
    .limit(200);
  if (files?.length) {
    await db.storage.from("evidence").remove(files.map((f) => f.storage_key));
    const { error } = await db
      .from("attachments")
      .delete()
      .in(
        "id",
        files.map((f) => f.id),
      );
    if (!error) {
      photos = files.length;
      const tickets = [...new Set(files.map((f) => f.ticket_id as string))];
      await db
        .from("ticket_events")
        .insert(
          tickets.map((ticket_id) => ({ ticket_id, type: "EVIDENCE_EXPIRED", actor: "SYSTEM" })),
        );
    }
  }

  // 3. Hashed-IP flood markers older than a day.
  await db
    .from("outbox")
    .delete()
    .like("key", "intake-ip:%")
    .lt("created_at", c.markers.toISOString());

  return { anonymised, photos };
}
