// Ported from source packages/domain/src/index.ts + apps/web/app/workflow.ts (commit 6ab736d).
// Pure, runtime-agnostic business rules shared by server functions and UI.

export const assignableRoles = [
  "SUPER_ADMIN",
  "MARKETING_MANAGER",
  "SHIFT_LEAD",
  "AGENT",
  "OPERATIONS_MANAGER",
  "CEO",
  "OWNER",
] as const;
export type AssignableRole = (typeof assignableRoles)[number];

export const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "مدير النظام",
  MARKETING_MANAGER: "مدير التسويق",
  SHIFT_LEAD: "قائد فريق الدعم",
  AGENT: "موظف خدمة العملاء",
  OPERATIONS_MANAGER: "مدير العمليات",
  CEO: "الرئيس التنفيذي",
  OWNER: "المالك",
};

export const financeDuties = ["NONE", "APPROVER", "PROCESSOR", "VERIFIER"] as const;
export const financeDutyLabels: Record<string, string> = {
  NONE: "بدون مهمة مالية",
  APPROVER: "معتمد مالي",
  PROCESSOR: "منفذ الاسترداد",
  VERIFIER: "مدقق التنفيذ",
};

export type Actor = {
  id: string;
  name: string;
  role: string;
  brandIds: string[];
  branchIds: string[];
  financeDuty?: string;
};
export type Scope = { brandId: string; branchId?: string | null };

const financePermissions: Record<string, string[]> = {
  APPROVER: ["refund.decide", "evidence.view"],
  PROCESSOR: ["refund.execute", "refund.notify", "evidence.view", "evidence.attach"],
  VERIFIER: ["refund.verify", "evidence.view"],
};

// Full source rights table: legacy roles are kept only so SUPER_ADMIN's union matches the source.
const rights: Record<string, string[]> = {
  AGENT: ["schedule.self", "read", "pii", "create", "comment", "contact", "task", "refund.request", "acknowledge", "investigate", "resolve", "escalate"],
  SHIFT_LEAD: ["brands.manage", "branches.manage", "read", "pii", "create", "comment", "contact", "task", "refund.request", "assign", "triage", "close", "escalate", "investigate", "resolve", "qa"],
  CUSTOMER_SERVICE_MANAGER: ["brands.manage", "branches.manage", "read", "pii", "create", "comment", "contact", "task", "refund.request", "assign", "triage", "close", "escalate", "investigate", "resolve", "report"],
  AREA_MANAGER: ["read", "comment", "report", "investigate", "resolve", "escalate"],
  BRANCH_MANAGER: ["read", "comment"],
  BRAND_OPERATIONS_MANAGER: ["read", "comment", "escalate", "report", "investigate", "resolve"],
  GROUP_OPERATIONS_MANAGER: ["read", "comment", "escalate", "report", "investigate", "resolve"],
  FINANCE_APPROVER: ["read", "comment", "refund.decide", "refund.verify", "evidence.view"],
  REFUND_PROCESSOR: ["read", "comment", "refund.execute", "refund.notify", "evidence.view"],
  QA_REVIEWER: ["read", "qa", "report"],
  SCHEDULER: ["schedule"],
  ADMIN: ["configure", "audit", "brands.manage", "branches.manage"],
  PRIVACY_OFFICER: ["read", "pii", "privacy", "audit"],
};
rights["MARKETING_MANAGER"] = [...(rights["CUSTOMER_SERVICE_MANAGER"] ?? []), "qa", "schedule", "configure"];
rights["OPERATIONS_MANAGER"] = ["read", "comment", "report", "investigate", "resolve", "escalate"];
rights["CEO"] = ["read", "report"];
rights["OWNER"] = ["read", "report"];
rights["SUPER_ADMIN"] = [...new Set([...Object.values(rights).flat(), "users.manage", "directory.activate", "evidence.view"])];

export function permissionsForRole(role: string, financeDuty?: string): string[] {
  if (!(assignableRoles as readonly string[]).includes(role)) return [];
  const base = rights[role] ?? [];
  return [
    ...new Set([
      ...base,
      ...(base.includes("pii") ? ["evidence.view"] : []),
      ...(base.includes("comment") ? ["evidence.attach"] : []),
      ...(financePermissions[financeDuty ?? "NONE"] ?? []),
    ]),
  ];
}
export function can(actor: Actor, action: string) {
  return permissionsForRole(actor.role, actor.financeDuty).includes(action);
}
export function inScope(actor: Actor, s: Scope) {
  if (actor.role === "SUPER_ADMIN") return true;
  return (
    actor.brandIds.includes(s.brandId) &&
    (!actor.branchIds.length || (!!s.branchId && actor.branchIds.includes(s.branchId)))
  );
}
export class DomainError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}
export function authorize(actor: Actor, action: string, s?: Scope) {
  if (!can(actor, action) || (s && !inScope(actor, s)))
    throw new DomainError("FORBIDDEN", 403, "لا تملك صلاحية لهذا الإجراء أو النطاق");
}
export const supportRoles = ["AGENT", "SHIFT_LEAD", "MARKETING_MANAGER", "CUSTOMER_SERVICE_MANAGER", "SUPER_ADMIN"];
export const escalationRoles = ["MARKETING_MANAGER", "OPERATIONS_MANAGER", "SHIFT_LEAD", "CUSTOMER_SERVICE_MANAGER", "AREA_MANAGER", "BRAND_OPERATIONS_MANAGER", "GROUP_OPERATIONS_MANAGER"];

export function canWorkComplaint(
  actor: Actor,
  t: Scope & { resolutionOwner: string | null; escalated?: boolean },
) {
  return (
    inScope(actor, t) &&
    (can(actor, "assign") ||
      (t.resolutionOwner === actor.id && (supportRoles.includes(actor.role) || !!t.escalated)))
  );
}
export function isComplaintParticipant(
  a: Actor,
  t: { creator?: string; resolutionOwner?: string | null; communicationsOwner?: string },
) {
  return t.creator === a.id || t.resolutionOwner === a.id || t.communicationsOwner === a.id;
}

export const categories = ["DELAY", "MISSING", "WRONG_BRANCH", "QUALITY", "SAFETY", "SERVICE", "OTHER"] as const;
export const categoryLabels: Record<string, string> = {
  DELAY: "تأخر الطلب",
  MISSING: "طلب ناقص",
  WRONG_BRANCH: "طلب في فرع آخر",
  QUALITY: "جودة الطعام",
  SAFETY: "سلامة الغذاء",
  SERVICE: "تجربة الخدمة",
  OTHER: "أخرى",
};
export const stateLabels: Record<string, string> = {
  NEW: "جديد",
  TRIAGED: "قيد الفرز",
  ASSIGNED: "بانتظار الفرع",
  ACKNOWLEDGED: "تم استلام البلاغ",
  IN_PROGRESS: "جاري المعالجة",
  RESOLVED: "تمت المعالجة",
  CLOSED: "مغلق",
};

const steps: Record<string, string> = {
  triage: "TRIAGED", assign: "ASSIGNED", acknowledge: "ACKNOWLEDGED", investigate: "IN_PROGRESS",
  start: "IN_PROGRESS", resolve: "RESOLVED", close: "CLOSED", reopen: "IN_PROGRESS",
};
const from: Record<string, string[]> = {
  triage: ["NEW"],
  assign: ["NEW", "TRIAGED", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS"],
  acknowledge: ["ASSIGNED"],
  investigate: ["ACKNOWLEDGED"],
  start: ["ASSIGNED", "ACKNOWLEDGED"],
  resolve: ["IN_PROGRESS"],
  close: ["RESOLVED"],
  reopen: ["RESOLVED", "CLOSED"],
};
export function transition(state: string, action: string): string {
  if (!from[action]?.includes(state))
    throw new DomainError("INVALID_TRANSITION", 409, "الإجراء غير متاح في الحالة الحالية");
  return steps[action] as string;
}

// The five customer-facing stages, exactly as in the source.
export const complaintStages = [
  { id: "new", label: "استقبال الشكوى", hint: "بانتظار إسناد قائد فريق الدعم" },
  { id: "routing", label: "الإسناد", hint: "إلى الشخص المناسب في خدمة العملاء" },
  { id: "processing", label: "جارٍ العمل", hint: "معالجة المشكلة وتوثيق الحل" },
  { id: "followup", label: "التواصل مع العميل", hint: "شرح الإجراء والتأكد من حل المشكلة" },
  { id: "closed", label: "تم الحل", hint: "تم التواصل وتأكيد الحل" },
] as const;
export function complaintStage(t: { state: string; resolutionOwner?: string | null; branchId?: string | null }) {
  if (t.state === "CLOSED") return "closed";
  if (t.state === "RESOLVED") return "followup";
  if (t.resolutionOwner && t.resolutionOwner === t.branchId) return "new";
  if (["ACKNOWLEDGED", "IN_PROGRESS"].includes(t.state)) return "processing";
  if (t.state === "ASSIGNED") return "routing";
  return "new";
}

export const complaintActions = [
  { id: "assign", label: "إسناد إلى المسؤول", perm: "assign", from: ["NEW", "TRIAGED", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS"] },
  { id: "start", label: "بدء العمل", perm: "investigate", from: ["ASSIGNED", "ACKNOWLEDGED"] },
  { id: "resolve", label: "الانتقال للتواصل مع العميل", perm: "resolve", from: ["IN_PROGRESS"] },
  { id: "followup", label: "التواصل مع العميل", perm: "contact", from: ["RESOLVED"] },
  { id: "close", label: "إغلاق الشكوى", perm: "close", from: ["RESOLVED"] },
  { id: "reopen", label: "إعادة فتح الشكوى", perm: "close", from: ["CLOSED"] },
  { id: "escalate", label: "تصعيد إلى المشرف / المنطقة / العمليات", perm: "escalate", from: ["ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"] },
  { id: "comment", label: "إضافة ملاحظة", perm: "comment", from: ["NEW", "TRIAGED", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"] },
] as const;

export type SlaPolicy = {
  version: string;
  p1First: number; p1Ack: number; p2First: number; p2Ack: number; p2Remedy: number;
  p3First: number; p3Ack: number; p3Remedy: number;
};
export function slaMilestones(priority: string, received: Date, p: SlaPolicy, assigned?: Date) {
  const key = priority.toLowerCase() as "p1" | "p2" | "p3";
  const first = p[`${key}First` as keyof SlaPolicy] as number;
  const ack = p[`${key}Ack` as keyof SlaPolicy] as number;
  const remedy = key === "p1" ? null : (p[`${key}Remedy` as keyof SlaPolicy] as number);
  const at = (base: Date, m: number, f = 1) => new Date(+base + m * 60000 * f).toISOString();
  return [
    { milestone: "FIRST_ACTION", due_at: at(received, first), warning_at: at(received, first, 0.8) },
    ...(assigned ? [{ milestone: "ACKNOWLEDGMENT", due_at: at(assigned, ack), warning_at: at(assigned, ack, 0.8) }] : []),
    ...(remedy ? [{ milestone: "REMEDY", due_at: at(received, remedy), warning_at: at(received, remedy, 0.8) }] : []),
  ];
}

export const refundStatusLabels: Record<string, string> = {
  REQUESTED: "طلب جديد",
  UNDER_REVIEW: "قيد المراجعة",
  AWAITING_EXTERNAL_EXECUTION: "معتمد — بانتظار التنفيذ الخارجي",
  EXECUTED_UNVERIFIED: "منفذ — بانتظار التحقق",
  VERIFIED: "تم التحقق",
  CUSTOMER_NOTIFIED: "تم إبلاغ العميل",
  COMPLETED: "مكتمل",
  REJECTED: "مرفوض",
};
const refundTransitions: Record<string, [string[], string]> = {
  resubmit: [["REJECTED"], "REQUESTED"],
  review: [["REQUESTED"], "UNDER_REVIEW"],
  approve: [["UNDER_REVIEW"], "AWAITING_EXTERNAL_EXECUTION"],
  reject: [["REQUESTED", "UNDER_REVIEW"], "REJECTED"],
  execute: [["AWAITING_EXTERNAL_EXECUTION"], "EXECUTED_UNVERIFIED"],
  verify: [["EXECUTED_UNVERIFIED"], "VERIFIED"],
  notify: [["VERIFIED"], "CUSTOMER_NOTIFIED"],
  complete: [["CUSTOMER_NOTIFIED"], "COMPLETED"],
};
export const refundActionLabels: Record<string, string> = {
  review: "بدء المراجعة", approve: "اعتماد", reject: "رفض", execute: "تسجيل التنفيذ الخارجي",
  verify: "التحقق من التنفيذ", notify: "تسجيل إبلاغ العميل", complete: "إكمال", resubmit: "إعادة التقديم",
};
export function refundNext(status: string, action: string): string {
  const t = refundTransitions[action];
  if (!t || !t[0].includes(status))
    throw new DomainError("INVALID_REFUND_TRANSITION", 409, "لا يمكن تجاوز خطوات الموافقة والتنفيذ والتحقق وإبلاغ العميل");
  return t[1];
}
export function refundPermission(action: string) {
  if (action === "resubmit") return "refund.request";
  if (["review", "approve", "reject"].includes(action)) return "refund.decide";
  if (action === "verify") return "refund.verify";
  if (action === "execute") return "refund.execute";
  return "refund.notify";
}
/** Financial duty separation from source refunds.ts. Throws when the actor may not perform the step. */
export function assertRefundSeparation(
  a: Actor,
  r: { requester: string; approver?: string | null; processor?: string | null },
  action: string,
) {
  if (action === "resubmit" && r.requester !== a.id)
    throw new DomainError("FORBIDDEN", 403, "إعادة التقديم متاحة لمقدم الطلب الأصلي فقط");
  if (["review", "approve", "reject"].includes(action) && r.requester === a.id)
    throw new DomainError("SELF_APPROVAL", 403, "لا يمكن اعتماد طلبك");
  if (
    (action === "execute" && a.id === r.approver) ||
    (action === "verify" && [r.requester, r.processor, r.approver].includes(a.id))
  )
    throw new DomainError("DUAL_CONTROL", 403, "التنفيذ والتحقق يتطلبان مسؤولين مستقلين");
}

export function ticketNumber(sequence: number, createdAt: string | Date) {
  return `AG-${new Date(createdAt).getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
}
export function refundNumber(sequence: number, createdAt: string | Date) {
  return `RF-${new Date(createdAt).getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
}
export function safeCell(value: unknown) {
  const v = String(value ?? "");
  return '"' + (/^[\s]*[=+@\-\t\r]/.test(v) ? "'" : "") + v.replaceAll('"', '""') + '"';
}
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("966") ? digits : digits.startsWith("0") ? "966" + digits.slice(1) : "966" + digits;
}
export const saudiMobile = /^(\+?966|0)?5\d{8}$/;
export function overlaps(a: Date, b: Date, c: Date, d: Date) {
  return a < d && c < b;
}
/** Staff-authored escalation briefs must not contain phone numbers, emails or the customer's name. */
export function briefHasPersonalData(brief: string, customerName?: string) {
  return (
    /(?:\+?\d[\d\s-]{7,}\d)|(?:[^\s@]+@[^\s@]+\.[^\s@]+)/.test(brief) ||
    (!!customerName && customerName.trim().length >= 3 && brief.includes(customerName.trim()))
  );
}
export function elapsed(s: string, end?: string | null) {
  const minutes = Math.max(0, Math.floor(((end ? +new Date(end) : Date.now()) - +new Date(s)) / 60000));
  const n = (x: number) => x.toLocaleString("en-US");
  return minutes < 60 ? `${n(minutes)} د` : minutes < 1440 ? `${n(Math.floor(minutes / 60))} س ${n(minutes % 60)} د` : `${n(Math.floor(minutes / 1440))} يوم`;
}
