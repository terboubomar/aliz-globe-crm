import type { Catalog } from "@/lib/catalog";
export type Brand = {
  id: string;
  name: string;
  nameEn: string;
  logo: string;
  color: string;
  status: string;
  branches: Branch[];
};
export type Branch = {
  id: string;
  brandId: string;
  name: string;
  city: string;
  district?: string | null;
  address?: string | null;
  mapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  code: string;
  active: boolean;
  demo: boolean;
};
export type User = {
  id: string;
  name: string;
  role: string;
  financeDuty?: string;
  brandIds: string[];
  branchIds: string[];
};
export type Ticket = {
  id: string;
  number: string;
  brandId: string;
  branchId: string | null;
  brand: Brand;
  branch: Branch | null;
  category: string;
  priority: string;
  source: string;
  state: string;
  description: string;
  branchBrief: string | null;
  customer: { name: string; phone: string; email?: string } | null;
  externalOrder: string | null;
  platform: string | null;
  creator: string;
  communicationsOwner: string;
  resolutionOwner: string | null;
  createdAt: string;
  receivedAt: string;
  version: number;
  acknowledgedAt: string | null;
  actionCompletedAt: string | null;
  customerConfirmedAt: string | null;
  closedAt: string | null;
  escalated: boolean;
  events: { id: string; type: string; actor: string; note: string | null; createdAt: string }[];
  timers: {
    id: string;
    milestone: string;
    dueAt: string;
    warningAt: string;
    completedAt: string | null;
    breachedAt: string | null;
  }[];
  refunds: Refund[];
  tasks: Task[];
  attachments: { id: string; status: string }[];
  reviews: { score: number; note: string; reviewer: string }[];
};
export type Refund = {
  id: string;
  ticketId: string | null;
  number: string;
  brandId: string;
  branchId: string | null;
  brand: Brand;
  branch: Branch | null;
  externalOrder: string;
  platform: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  approver: string | null;
  processor: string | null;
  verifier: string | null;
  ticket: { id: string; number: string } | null;
  events: { id: string; type: string; actor: string; note: string | null; createdAt: string }[];
  attachments: { id: string; status: string }[];
  kind: string;
  amountMinor: number | null;
  status: string;
  version: number;
  requester: string;
  externalReference: string | null;
  // Where the money goes back to; null when hidden by permissions or not recorded.
  destination?: import("@/lib/refund-request").RefundDestination | null;
};
export type Task = {
  id: string;
  ticketId: string;
  owner: string;
  dueAt: string;
  completedAt: string | null;
};
export type Shift = {
  id: string;
  userId: string;
  brandId: string | null;
  version: number;
  cancelledAt?: string | null;
  start: string;
  end: string;
  breakStart: string | null;
  breakEnd: string | null;
  lead: boolean;
  dayOff: boolean;
};
export type Leave = { id: string; userId: string; start: string; end: string; status: string };
export type Data = {
  authMode?: "password" | "demo" | "oidc";
  me: User;
  demo: boolean;
  brands: Brand[];
  users: User[];
  tickets: Ticket[];
  ticketCount: number;
  // Exact dashboard counts per brand over the whole scope (tickets is capped).
  ticketSummary?: Record<string, SummaryCounts>;
  refunds: Refund[];
  tasks: Task[];
  shifts: Shift[];
  leave: Leave[];
  permissions: string[];
  catalog?: Catalog;
  integrations?: { whatsapp: boolean; email?: boolean };
  policy: {
    sla: string;
    finance: boolean;
    publicIntake: boolean;
    autoAssign?: boolean;
    requireMfa?: boolean;
    slaApproved?: boolean;
    slaPolicy?: Record<string, number | string | boolean> | null;
  };
};
export {
  categories,
  lists,
  applyCatalog,
  activeCategories,
  activePlatforms,
} from "./catalog-state";
export const states: Record<string, string> = {
  NEW: "استقبال الشكوى",
  TRIAGED: "استقبال الشكوى",
  ASSIGNED: "الإسناد",
  ACKNOWLEDGED: "جارٍ العمل",
  IN_PROGRESS: "جارٍ العمل",
  RESOLVED: "التواصل مع العميل",
  CLOSED: "تم الحل",
};
export const refundStates: Record<string, string> = {
  REQUESTED: "طلب جديد",
  UNDER_REVIEW: "قيد المراجعة",
  AWAITING_EXTERNAL_EXECUTION: "بانتظار التنفيذ الخارجي",
  EXECUTED_UNVERIFIED: "بانتظار التحقق",
  VERIFIED: "تم التحقق",
  CUSTOMER_NOTIFIED: "تم إبلاغ العميل",
  COMPLETED: "مكتمل",
  REJECTED: "مرفوض",
};
export const roleNames: Record<string, string> = {
  SUPER_ADMIN: "المسؤول الأعلى",
  MARKETING_MANAGER: "مدير التسويق",
  OPERATIONS_MANAGER: "مدير العمليات",
  CEO: "الرئيس التنفيذي",
  OWNER: "المالك",
  IT_MANAGER: "مدير تقنية المعلومات",
  AGENT: "موظف خدمة العملاء",
  SHIFT_LEAD: "قائد الفريق",
  CUSTOMER_SERVICE_MANAGER: "مدير خدمة العملاء",
  AREA_MANAGER: "مدير المنطقة",
  BRAND_OPERATIONS_MANAGER: "مدير عمليات العلامة",
  BRANCH_MANAGER: "مدير الفرع",
  GROUP_OPERATIONS_MANAGER: "مدير عمليات المجموعة",
  FINANCE_APPROVER: "موافق مالي",
  REFUND_PROCESSOR: "مسؤول التنفيذ الخارجي",
  QA_REVIEWER: "مراجع الجودة",
  SCHEDULER: "مسؤول الجدولة",
  ADMIN: "مسؤول النظام",
  PRIVACY_OFFICER: "مسؤول الخصوصية",
};
export const eventNames: Record<string, string> = {
  PHONE_CREATED: "تسجيل شكوى هاتفية",
  QR_CREATED: "استقبال بلاغ QR",
  DEMO_CREATED: "إنشاء حالة تجريبية",
  TRIAGE: "فرز البلاغ",
  ASSIGN: "إسناد البلاغ",
  AUTO_ASSIGNED: "إسناد تلقائي للموظف الأقل حالات",
  ACKNOWLEDGE: "استلام الفرع",
  INVESTIGATE: "بدء المعالجة",
  START: "بدء العمل",
  FOLLOWUP_SATISFIED: "أكد العميل حل المشكلة",
  FOLLOWUP_UNREACHABLE: "تعذر الوصول إلى العميل",
  FOLLOWUP_UNRESOLVED: "المشكلة مستمرة بعد التواصل",
  ESCALATION_ROUTED: "تصعيد إلى المسؤول",
  RESOLVE: "جاهزة للتواصل مع العميل",
  CLOSE: "إغلاق البلاغ",
  REOPEN: "إعادة فتح البلاغ",
  COMMENT: "ملاحظة داخلية",
  CONTACT_RECORDED: "تسجيل محاولة تواصل",
  CUSTOMER_CONFIRMED: "تأكيد العميل لنتيجة المعالجة",
  REQUEST_IMPORTED: "استيراد الطلب السابق مع حفظ ارتباطه",
  ESCALATE: "تصعيد البلاغ",
  SLA_BREACHED: "تجاوز المهلة التجريبية",
  SLA_WARNING: "اقتراب المهلة التجريبية",
  REFUND_REQUESTED: "تسجيل طلب مالي",
  REFUND_REVIEW: "بدء مراجعة الطلب المالي",
  REFUND_APPROVE: "اعتماد الطلب المالي",
  REFUND_REJECT: "رفض الطلب المالي",
  REFUND_EXECUTE: "توثيق التنفيذ الخارجي",
  REFUND_VERIFY: "التحقق من إثبات التنفيذ",
  REFUND_NOTIFY: "توثيق إبلاغ العميل",
  REFUND_COMPLETE: "إكمال الطلب المالي",
  EVIDENCE_ATTACHED: "إرفاق صور",
  FOLLOW_UP_CREATED: "إنشاء مهمة متابعة",
  FOLLOW_UP_COMPLETED: "إكمال المتابعة",
};
export { api } from "./adapter";
export const date = (s: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(new Date(s));
export const n = (v: number) => v.toLocaleString("ar-SA-u-nu-latn");
export type SummaryCounts = {
  active: number;
  closed: number;
  followup: number;
  waiting: number;
  escalated: number;
  late: number;
  urgent: number;
};
const noCounts: SummaryCounts = {
  active: 0,
  closed: 0,
  followup: 0,
  waiting: 0,
  escalated: 0,
  late: 0,
  urgent: 0,
};
// Server counts for one brand, or all brands summed; null when the server
// sent none, so callers fall back to counting the loaded cases.
export function summaryFor(
  summary: Record<string, SummaryCounts> | undefined,
  brand: string,
): SummaryCounts | null {
  if (!summary) return null;
  const rows = brand === "all" ? Object.values(summary) : [summary[brand] ?? noCounts];
  return rows.reduce(
    (total, row) =>
      Object.fromEntries(
        Object.keys(noCounts).map((k) => [
          k,
          total[k as keyof SummaryCounts] + row[k as keyof SummaryCounts],
        ]),
      ) as SummaryCounts,
    noCounts,
  );
}
export function risk(t: Ticket) {
  const pending = t.timers.filter((x) => !x.completedAt);
  return pending.some((x) => +new Date(x.dueAt) < Date.now())
    ? "late"
    : pending.some((x) => +new Date(x.warningAt) <= Date.now())
      ? "soon"
      : "ok";
}
