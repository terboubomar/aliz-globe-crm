// Server-only helpers. Import dynamically from server-function handlers only.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DomainError, type Actor, type SlaPolicy } from "@/lib/domain";

export type Ctx = { supabase: SupabaseClient<Database>; userId: string; claims: Record<string, unknown> };

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function settings() {
  const db = await admin();
  const { data, error } = await db.from("app_settings").select("key,value");
  if (error) throw error;
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, unknown>;
  return {
    requireMfa: map["require_mfa"] !== false,
    publicIntake: map["public_intake_enabled"] === true,
    financeApproved: map["finance_policy_approved"] === true,
    financeLimitMinor: typeof map["finance_approval_limit_minor"] === "number" ? (map["finance_approval_limit_minor"] as number) : null,
    sla: map["sla_policy"] as SlaPolicy & { approved?: boolean },
    whatsapp: map["whatsapp_enabled"] === true,
    telegram: map["telegram_enabled"] === true,
  };
}

export type AccessState =
  | { status: "OK"; actor: Actor; email: string }
  | { status: "NO_ACCESS" }
  | { status: "DISABLED" }
  | { status: "MFA_REQUIRED" };

/** Resolve the caller from the protected role table (never from user metadata). */
export async function accessState(ctx: Ctx): Promise<AccessState> {
  const { data: row, error } = await ctx.supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { status: "NO_ACCESS" };
  if (!row.enabled) return { status: "DISABLED" };
  const s = await settings();
  if (s.requireMfa && ctx.claims["aal"] !== "aal2") return { status: "MFA_REQUIRED" };
  return {
    status: "OK",
    email: row.email,
    actor: {
      id: row.user_id,
      name: row.name,
      role: row.role,
      brandIds: row.brand_ids,
      branchIds: row.branch_ids,
      financeDuty: row.finance_duty,
    },
  };
}
export async function requireActor(ctx: Ctx) {
  const s = await accessState(ctx);
  if (s.status === "OK") return s.actor;
  if (s.status === "MFA_REQUIRED") throw new DomainError("MFA_REQUIRED", 401, "يلزم التحقق بخطوتين");
  if (s.status === "DISABLED") throw new DomainError("DISABLED", 403, "الحساب موقوف");
  throw new DomainError("NO_ACCESS", 403, "لا توجد صلاحية مسندة لهذا الحساب");
}

const rpcMessages: Record<string, string> = {
  CONFLICT: "تم تعديل السجل بالتزامن؛ حدّث الصفحة وأعد المحاولة",
  NOT_FOUND: "السجل غير موجود ضمن نطاقك",
  BRAND_INACTIVE: "العلامة غير مفعلة",
  INVALID_BRANCH: "الفرع غير موجود أو غير مفعل",
  BRANCH_INACTIVE: "فعّل الفرع أولاً",
  KEY_REUSED: "مفتاح الطلب مستخدم لبيانات أخرى",
  CLOSURE_BLOCKED: "لا يمكن الإغلاق قبل اكتمال الطلبات المالية المرتبطة",
  DUPLICATE_REFUND: "يوجد طلب مالي مفتوح لهذا الطلب الخارجي",
  QR_RETIRED: "تم إيقاف الرمز بالفعل؛ حدّث القائمة",
  APPEND_ONLY: "السجل غير قابل للتعديل",
  shifts_user_id_tstzrange_excl: "يتداخل هذا الدوام مع دوام آخر للموظف نفسه",
};
export function rpcError(err: { message?: string } | null) {
  if (!err) return;
  const m = err.message ?? "";
  const key = Object.keys(rpcMessages).find((k) => m.includes(k));
  if (key) throw new DomainError(key, 409, rpcMessages[key]);
  console.error("rpc error", m);
  throw new DomainError("SERVER", 500, "تعذر حفظ العملية");
}

export async function staffDirectory(brandIds: string[]) {
  const db = await admin();
  const { data } = await db
    .from("user_roles")
    .select("user_id,name,role,brand_ids,branch_ids,enabled,finance_duty")
    .eq("enabled", true)
    .overlaps("brand_ids", brandIds.length ? brandIds : ["__none__"]);
  return (data ?? []).map((u) => ({
    id: u.user_id,
    name: u.name,
    role: u.role,
    brandIds: u.brand_ids,
    branchIds: u.branch_ids,
    financeDuty: u.finance_duty,
  }));
}
