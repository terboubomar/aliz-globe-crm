/*
 * IT tickets: any staff member (any department or branch) opens a ticket, the
 * IT manager assigns an IT specialist, the specialist starts and solves it, and
 * the requester confirms it is solved (or sends it back). Pure rules shared by
 * the server and the screens.
 */

export const IT_STATES = [
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "DONE",
  "CONFIRMED",
  "CANCELLED",
] as const;
export type ItState = (typeof IT_STATES)[number];

export const itStateLabels: Record<ItState, string> = {
  NEW: "جديد",
  ASSIGNED: "مُسند",
  IN_PROGRESS: "قيد التنفيذ",
  DONE: "تم الحل",
  CONFIRMED: "مؤكد من مقدم الطلب",
  CANCELLED: "ملغى",
};

export const IT_PRIORITIES = ["URGENT", "HIGH", "NORMAL"] as const;
export type ItPriority = (typeof IT_PRIORITIES)[number];
export const itPriorityLabels: Record<ItPriority, string> = {
  URGENT: "عاجل",
  HIGH: "مرتفع",
  NORMAL: "عادي",
};

export type ItCategory = { id: string; label: string; active: boolean };
export const DEFAULT_IT_CATEGORIES: ItCategory[] = [
  { id: "POS", label: "نقاط البيع والكاشير", active: true },
  { id: "PRINTER", label: "الطابعات", active: true },
  { id: "NETWORK", label: "الشبكة والإنترنت", active: true },
  { id: "DEVICES", label: "الأجهزة (كمبيوتر، جوال، تابلت)", active: true },
  { id: "ACCOUNTS", label: "البريد والحسابات وكلمات المرور", active: true },
  { id: "APPS", label: "الأنظمة والتطبيقات (Portal وغيرها)", active: true },
  { id: "CAMERAS", label: "الكاميرات", active: true },
  { id: "OTHER", label: "أخرى", active: true },
];

/** Where a ticket comes from. Branch managers' tickets also name the branch. */
export type ItDepartment = { id: string; label: string; active: boolean };
export const DEFAULT_IT_DEPARTMENTS: ItDepartment[] = [
  { id: "BRANCHES", label: "الفروع", active: true },
  { id: "CUSTOMER_SERVICE", label: "خدمة العملاء", active: true },
  { id: "MAINTENANCE", label: "الصيانة", active: true },
  { id: "OPERATIONS", label: "العمليات", active: true },
  { id: "MARKETING", label: "التسويق", active: true },
  { id: "FINANCE", label: "المالية", active: true },
  { id: "HR", label: "الموارد البشرية", active: true },
  { id: "MANAGEMENT", label: "الإدارة", active: true },
  { id: "OTHER", label: "أخرى", active: true },
];
/** The department a role usually belongs to, preselected in the new-ticket form. */
export const departmentOfRole: Record<string, string> = {
  BRANCH_MANAGER: "BRANCHES",
  AGENT: "CUSTOMER_SERVICE",
  SHIFT_LEAD: "CUSTOMER_SERVICE",
  MARKETING_MANAGER: "MARKETING",
  MAINTENANCE_MANAGER: "MAINTENANCE",
  TECHNICIAN: "MAINTENANCE",
  OPERATIONS_MANAGER: "OPERATIONS",
  CEO: "MANAGEMENT",
  OWNER: "MANAGEMENT",
};

/** Deadlines in hours: start work (respond) and finish the repair (fix). */
export type ItSla = Record<ItPriority, { respond: number; fix: number }>;
export const DEFAULT_IT_SLA: ItSla = {
  URGENT: { respond: 1, fix: 4 },
  HIGH: { respond: 4, fix: 24 },
  NORMAL: { respond: 24, fix: 72 },
};

export type ItSettings = { categories: ItCategory[]; departments: ItDepartment[]; sla: ItSla };

const cleanList = (raw: unknown) =>
  Array.isArray(raw)
    ? (raw as { id?: unknown; label?: unknown; active?: unknown }[])
        .filter((c) => typeof c?.id === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(c.id))
        .map((c) => ({
          id: c.id as string,
          label: String(c.label ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60),
          active: c.active !== false,
        }))
        .filter((c) => c.label)
    : [];

const hours = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 24 * 60 ? v : fallback;

/** Saved settings, or the defaults for anything missing or invalid. */
export function toItSettings(raw: unknown): ItSettings {
  const r = (raw ?? {}) as Partial<ItSettings>;
  const cats = cleanList(r.categories),
    deps = cleanList(r.departments);
  const sla = Object.fromEntries(
    IT_PRIORITIES.map((p) => [
      p,
      {
        respond: hours(r.sla?.[p]?.respond, DEFAULT_IT_SLA[p].respond),
        fix: hours(r.sla?.[p]?.fix, DEFAULT_IT_SLA[p].fix),
      },
    ]),
  ) as ItSla;
  return {
    categories: cats.length ? cats : DEFAULT_IT_CATEGORIES.map((c) => ({ ...c })),
    departments: deps.length ? deps : DEFAULT_IT_DEPARTMENTS.map((c) => ({ ...c })),
    sla,
  };
}

export function itDeadlines(priority: ItPriority, from: Date, sla: ItSla) {
  const at = (h: number) => new Date(+from + h * 3600000).toISOString();
  return { respondDueAt: at(sla[priority].respond), fixDueAt: at(sla[priority].fix) };
}

export type ItTicket = {
  id: string;
  number: number;
  /** Set when the ticket is about a branch. */
  brandId: string | null;
  branchId: string | null;
  department: string;
  category: string;
  /** What the issue is, written by the requester when the fault type is "Other". */
  categoryDetail: string | null;
  priority: ItPriority;
  title: string;
  description: string;
  state: ItState;
  requester: string;
  assignee: string | null;
  respondDueAt: string | null;
  fixDueAt: string | null;
  createdAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  confirmedAt: string | null;
  version: number;
};

/** Late: not started by the start deadline, or not finished by the fix deadline. */
export function itLate(r: ItTicket, now = Date.now()) {
  if (["DONE", "CONFIRMED", "CANCELLED"].includes(r.state)) return null;
  if (!r.startedAt && r.respondDueAt && +new Date(r.respondDueAt) < now) return "respond" as const;
  if (r.fixDueAt && +new Date(r.fixDueAt) < now) return "fix" as const;
  return null;
}

export const IT_ACTIONS = [
  "assign",
  "start",
  "done",
  "confirm",
  "reopen",
  "cancel",
  "comment",
] as const;
export type ItAction = (typeof IT_ACTIONS)[number];

export const itActionLabels: Record<ItAction, string> = {
  assign: "إسناد لمختص",
  start: "بدء العمل",
  done: "تم الحل",
  confirm: "تأكيد الحل",
  reopen: "لم يُحل — إعادة فتح",
  cancel: "إلغاء التذكرة",
  comment: "إضافة ملاحظة",
};

type Who = { id: string; permissions: string[] };

/**
 * Which actions this person can take on this request now. Scope (brand and
 * branch or ticket visibility) is checked separately; this only covers role and step.
 */
export function itActions(r: ItTicket, who: Who): ItAction[] {
  const has = (p: string) => who.permissions.includes(p);
  const manager = has("it.assign"),
    mine = r.assignee === who.id && has("it.work"),
    // Only the person who opened the ticket confirms or reopens it.
    requester = r.requester === who.id;
  const out: ItAction[] = [];
  const open = !["CONFIRMED", "CANCELLED"].includes(r.state);
  if (manager && ["NEW", "ASSIGNED", "IN_PROGRESS"].includes(r.state)) out.push("assign");
  if ((mine || manager) && r.state === "ASSIGNED") out.push("start");
  if ((mine || manager) && r.state === "IN_PROGRESS") out.push("done");
  if ((requester || manager) && r.state === "DONE") out.push("confirm", "reopen");
  if ((manager || (requester && r.requester === who.id)) && ["NEW", "ASSIGNED"].includes(r.state))
    out.push("cancel");
  if (open && (manager || mine || requester)) out.push("comment");
  return out;
}

/** The new state and dates after an action (assignee is set by the caller). */
export function itTransition(action: ItAction, now: Date) {
  const t = now.toISOString();
  switch (action) {
    case "assign":
      return { assigned_at: t };
    case "start":
      return { state: "IN_PROGRESS", started_at: t };
    case "done":
      return { state: "DONE", done_at: t };
    case "confirm":
      return { state: "CONFIRMED", confirmed_at: t };
    case "reopen":
      return { state: "IN_PROGRESS", done_at: null };
    case "cancel":
      return { state: "CANCELLED" };
    case "comment":
      return {};
  }
}

export const itNumber = (n: number) => "IT-" + String(n).padStart(4, "0");

/** "Other": the requester is asked to write what the issue is. */
export const itAsksDetail = (c: { id: string; label: string }) =>
  c.id === "OTHER" || c.label.trim() === "أخرى";

/** Fault type as shown: "أخرى: <what the requester wrote>" for Other. */
export function itCategoryText(
  r: Pick<ItTicket, "category" | "categoryDetail">,
  categories: ItCategory[],
) {
  const label = categories.find((c) => c.id === r.category)?.label ?? r.category;
  return r.categoryDetail ? `${label}: ${r.categoryDetail}` : label;
}

const hoursBetween = (a: string, b: string) => (+new Date(b) - +new Date(a)) / 3600000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

type Group = { key: string; total: number; open: number; fixed: number; late: number };

/** Figures for the it report over the given requests. */
export function itSummary(rows: ItTicket[], now = Date.now()) {
  const fixed = rows.filter((r) => r.doneAt && ["DONE", "CONFIRMED"].includes(r.state));
  const fixHours = fixed.map((r) => hoursBetween(r.createdAt, r.doneAt!));
  const startHours = rows
    .filter((r) => r.startedAt)
    .map((r) => hoursBetween(r.createdAt, r.startedAt!));
  const onTime = fixed.filter((r) => !r.fixDueAt || +new Date(r.doneAt!) <= +new Date(r.fixDueAt));
  const group = (keyOf: (r: ItTicket) => string): Group[] => {
    const map = new Map<string, Group>();
    for (const r of rows) {
      const key = keyOf(r);
      const g = map.get(key) ?? { key, total: 0, open: 0, fixed: 0, late: 0 };
      g.total++;
      if (!["DONE", "CONFIRMED", "CANCELLED"].includes(r.state)) g.open++;
      if (["DONE", "CONFIRMED"].includes(r.state)) g.fixed++;
      if (itLate(r, now)) g.late++;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  };
  return {
    total: rows.length,
    open: rows.filter((r) => !["DONE", "CONFIRMED", "CANCELLED"].includes(r.state)).length,
    awaitingConfirm: rows.filter((r) => r.state === "DONE").length,
    confirmed: rows.filter((r) => r.state === "CONFIRMED").length,
    cancelled: rows.filter((r) => r.state === "CANCELLED").length,
    late: rows.filter((r) => itLate(r, now)).length,
    onTimeRate: fixed.length ? Math.round((onTime.length / fixed.length) * 100) : null,
    medianStartHours: median(startHours),
    medianFixHours: median(fixHours),
    byCategory: group((r) => r.category),
    byBranch: group((r) => r.branchId ?? "NONE"),
    byDepartment: group((r) => r.department),
    byTechnician: group((r) => r.assignee ?? "UNASSIGNED"),
    byPriority: group((r) => r.priority),
  };
}
