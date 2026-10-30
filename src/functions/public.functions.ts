// Narrow public endpoints: QR intake and receipt tracking. They never list staff, customers or cases.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DomainError } from "@/lib/domain";

const code = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

async function resolveQr(c: string, countVisit: boolean) {
  const core = await import("./core.server");
  const { keyedHash } = await import("./crypto.server");
  const s = await core.settings();
  if (!s.publicIntake) throw new DomainError("INTAKE_DISABLED", 403, "استقبال البلاغات العامة لم يفعّل بعد");
  const db = await core.admin();
  const { data: q } = await db
    .from("qrs")
    .select("id,active,scans,branch_id, branches!inner(id,name,active,brand_id, brands!inner(id,name,logo,color,status))")
    .eq("hash", await keyedHash("qr:" + c))
    .maybeSingle();
  const br = q?.branches as unknown as { id: string; name: string; active: boolean; brand_id: string; brands: { id: string; name: string; logo: string; color: string; status: string } } | undefined;
  if (!q?.active || !br?.active || br.brands.status !== "ACTIVE")
    throw new DomainError("QR_RETIRED", 404, "رابط الفرع غير متاح؛ تواصل مع فريق خدمة العملاء");
  if (countVisit) await db.from("qrs").update({ scans: q.scans + 1 }).eq("id", q.id);
  return { qrId: q.id, branchId: br.id, branchName: br.name, brandId: br.brand_id, brandName: br.brands.name, logo: br.brands.logo };
}

export const publicQrInfo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ code }).parse(d))
  .handler(async ({ data }) => {
    try {
      const q = await resolveQr(data.code, true);
      const live = await (await import("./receipts.server")).liveChannels();
      const lists = await (await import("./core.server")).catalog();
      return {
        ok: true as const, brandName: q.brandName, branchName: q.branchName, logo: q.logo, whatsappAvailable: live.whatsapp, emailAvailable: live.email,
        // Only what the form needs: active reasons and platforms.
        categories: lists.categories.filter((c) => c.active).map((c) => ({ id: c.id, label: c.label, group: c.group })),
        platforms: lists.platforms.filter((p) => p.active).map((p) => p.label),
      };
    } catch (e) {
      return { ok: false as const, message: e instanceof DomainError ? e.message : "الرابط غير متاح" };
    }
  });

export const publicCreate = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      code, key: z.string().min(8).max(100),
      input: z.object({
        description: z.string(), category: z.string(), name: z.string().optional(), phone: z.string().optional(),
        externalOrder: z.string().optional(), platform: z.string().optional(), consent: z.literal(true), otherDetail: z.string().optional(),
        email: z.string().optional(), whatsappConsent: z.boolean().optional(), emailConsent: z.boolean().optional(),
      }),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const q = await resolveQr(data.code, false);
    const t = await import("./tickets.server");
    const { consent: _c, ...rest } = data.input;
    const res = await t.createTicketCore(
      `QR:${q.qrId}`,
      { ...rest, whatsappConsent: !!rest.whatsappConsent, emailConsent: !!rest.emailConsent, brandId: q.brandId, branchId: q.branchId, priority: "P3" },
      data.key,
      { brandId: q.brandId, branchId: q.branchId, qrId: q.qrId },
    );
    return { number: res.number, trackingToken: res.trackingToken, confirmationStatus: res.confirmationStatus, emailStatus: res.emailStatus ?? "NOT_REQUESTED" };
  });

export const trackStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: code }).parse(d))
  .handler(async ({ data }) => {
    const core = await import("./core.server");
    const { keyedHash, decrypt } = await import("./crypto.server");
    const db = await core.admin();
    const { data: acc } = await db.from("tracking_access").select("expires_at, tickets!inner(state,receipt_enc,sequence)").eq("hash", await keyedHash("track:" + data.token)).maybeSingle();
    if (!acc || new Date(acc.expires_at) < new Date()) return { ok: false as const, message: "رابط المتابعة غير صالح أو منتهي" };
    const t = acc.tickets as unknown as { state: string; receipt_enc: string | null; sequence: number };
    const r = t.receipt_enc ? JSON.parse(await decrypt(t.receipt_enc)) : null;
    // Only the customer's own receipt fields; never staff, notes or other cases.
    return { ok: true as const, state: t.state, number: String(t.sequence), brand: r?.brand as string, branch: r?.branch as string, receivedAt: r?.receivedAt as string, category: r?.category as string };
  });

/**
 * Photos from the customer who just submitted on the QR form. Authorized only by
 * that complaint's private tracking link, and only in the first 10 minutes; at
 * most 3 photos, 5 MB each. Each photo is rebuilt from its pixels before it is
 * stored (no metadata or hidden content survives), then marked CLEAN.
 */
export const publicAttach = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: code, base64: z.string().min(1).max(7_000_000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const core = await import("./core.server");
    const { keyedHash } = await import("./crypto.server");
    const db = await core.admin();
    const { data: acc } = await db
      .from("tracking_access")
      .select("expires_at, ticket_id, tickets!inner(created_at)")
      .eq("hash", await keyedHash("track:" + data.token))
      .maybeSingle();
    const createdAt = (acc?.tickets as unknown as { created_at: string } | undefined)?.created_at;
    if (
      !acc ||
      !createdAt ||
      new Date(acc.expires_at) < new Date() ||
      Date.now() - +new Date(createdAt) > 10 * 60000
    )
      throw new DomainError("FORBIDDEN", 403, "انتهت جلسة إرفاق الصور");
    const { count } = await db
      .from("attachments")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", acc.ticket_id);
    if ((count ?? 0) >= 3)
      throw new DomainError("FILE_COUNT", 400, "الحد الأعلى ثلاث صور لكل بلاغ");
    const raw = Uint8Array.from(atob(data.base64), (ch) => ch.charCodeAt(0));
    if (raw.length > 5 * 1024 * 1024)
      throw new DomainError("TOO_LARGE", 400, "يسمح بصور حتى 5 ميغابايت");
    const { cleanPhoto, putEvidence, sha256Hex } = await import("./evidence.server");
    const bytes = cleanPhoto(raw);
    const key = `t/${acc.ticket_id}/${crypto.randomUUID()}`;
    core.rpcError(await putEvidence(key, bytes, "image/jpeg"));
    const { data: row, error } = await db
      .from("attachments")
      .insert({
        ticket_id: acc.ticket_id,
        storage_key: key,
        mime: "image/jpeg",
        size: bytes.length,
        checksum: await sha256Hex(bytes),
        status: "CLEAN",
        uploaded_by: "PUBLIC_QR",
      })
      .select("id")
      .single();
    core.rpcError(error);
    await db
      .from("ticket_events")
      .insert({ ticket_id: acc.ticket_id, type: "EVIDENCE_ATTACHED", actor: "PUBLIC_QR" });
    await db.rpc("write_audit", {
      _actor: "PUBLIC_QR",
      _action: "PUBLIC_EVIDENCE_UPLOADED",
      _entity: row!.id,
    });
    return { ok: true };
  });
