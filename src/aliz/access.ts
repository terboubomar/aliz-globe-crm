const viewPermissions: Record<string, string[]> = {
  overview: ["read", "report"],
  tickets: ["read"],
  refunds: ["read", "refund.view", "refund.request", "refund.decide", "refund.execute"],
  branches: ["read", "brands.manage", "branches.manage"],
  qr: ["configure"],
  customers: ["pii"],
  tasks: ["task"],
  schedule: ["schedule", "schedule.self"],
  reports: ["report"],
  "qr-stats": ["report"],
  reviews: ["contact", "configure"],
  users: ["users.manage"],
  settings: [],
  maintenance: ["mnt.view"],
  "maintenance-reports": ["mnt.report"],
  it: ["it.request", "it.view"],
  "it-refunds": ["refund.execute"],
  "it-reports": ["it.report"],
};

/*
 * The CRM holds three apps: Customer Service (complaints, refunds…),
 * Maintenance and IT (IT tickets from every department, plus the refunds the IT
 * manager executes). Each person sees the apps their role opens; with more than
 * one, they pick one after signing in and can switch from the sidebar.
 */
export type AppId = "cs" | "maintenance" | "it";
export const appLabels: Record<AppId, string> = {
  cs: "خدمة العملاء",
  maintenance: "الصيانة",
  it: "تقنية المعلومات",
};
/** Names in the sidebar switch: one word each when three apps share the row. */
export const appShortLabels: Record<AppId, string> = {
  cs: "خدمة العملاء",
  maintenance: "الصيانة",
  it: "التقنية",
};
export const appTinyLabels: Record<AppId, string> = {
  cs: "العملاء",
  maintenance: "الصيانة",
  it: "التقنية",
};
export const appOf = (view: string): AppId =>
  view.startsWith("maintenance")
    ? "maintenance"
    : view === "it" || view.startsWith("it-")
      ? "it"
      : "cs";
export function appsFor(permissions: string[], role: string): AppId[] {
  const views = Object.keys(viewPermissions).filter(
    (v) => v !== "settings" && canOpenView(v, permissions, role),
  );
  return (["cs", "maintenance", "it"] as const).filter((app) =>
    views.some((v) => appOf(v) === app),
  );
}
export const agentViewLabels: Record<string, string> = {
  overview: "مساحة عملي",
  tickets: "الشكاوى",
  tasks: "متابعاتي",
  refunds: "الاسترجاع والإلغاء",
};
export const roleWorkspaces: Record<
  string,
  { title: string; description: string; views: string[]; labels: Record<string, string> }
> = {
  SUPER_ADMIN: {
    title: "إدارة المجموعة",
    description: "الفريق والعلامات والشكاوى والطلبات المالية في مساحة واحدة.",
    // Refunds stay in Customer Service for the super admin (no copy in IT).
    views: Object.keys(viewPermissions).filter((v) => v !== "it-refunds"),
    labels: { overview: "إدارة المجموعة" },
  },
  MARKETING_MANAGER: {
    title: "تجربة العملاء والعلامات",
    description: "راقب جودة الخدمة ومصادر الشكاوى وتابع فريق الدعم عبر العلامات.",
    views: [
      "overview",
      "tickets",
      "refunds",
      "branches",
      "qr",
      "customers",
      "tasks",
      "schedule",
      "reports",
      "qr-stats",
      "reviews",
      "it",
    ],
    labels: { overview: "تجربة العملاء", tickets: "شكاوى العملاء" },
  },
  SHIFT_LEAD: {
    title: "لوحة قيادة الفريق",
    description: "أسند الشكاوى وتابع عبء العمل والحالات التي تحتاج تدخلك.",
    views: ["overview", "tickets", "refunds", "branches", "customers", "tasks", "reviews", "it"],
    labels: { overview: "قيادة الفريق", tickets: "الاستقبال والإسناد", tasks: "متابعات الفريق" },
  },
  AGENT: {
    title: "مساحة عملي",
    description: "ابحث في شكاوى العملاء، وتابع عملك وطلبات الاسترجاع.",
    views: ["overview", "tickets", "refunds", "tasks", "schedule", "reviews", "it"],
    labels: {
      overview: "مساحة عملي",
      tickets: "الشكاوى",
      refunds: "الاسترجاع والإلغاء",
      tasks: "متابعاتي",
      schedule: "جدولي",
    },
  },
  OPERATIONS_MANAGER: {
    title: "التصعيدات المسندة إليّ",
    description: "عالج التصعيد المسند إليك ثم يتابع فريق خدمة العملاء التواصل مع العميل.",
    views: [
      "overview",
      "tickets",
      "refunds",
      "reports",
      "maintenance",
      "maintenance-reports",
      "it",
    ],
    labels: {
      overview: "مساحة العمليات",
      tickets: "تصعيداتي",
      refunds: "طلبات التصعيد المالية",
      reports: "تقارير التصعيد",
    },
  },
  CEO: {
    title: "نظرة تنفيذية للمجموعة",
    description: "مؤشرات تجربة العملاء والتصعيد والاسترجاع عبر العلامات المصرح بها.",
    views: [
      "overview",
      "reports",
      "qr-stats",
      "tickets",
      "refunds",
      "branches",
      "maintenance",
      "maintenance-reports",
      "it",
    ],
    labels: { overview: "النظرة التنفيذية", tickets: "سجل الشكاوى", refunds: "متابعة الاسترجاع" },
  },
  IT_MANAGER: {
    title: "تقنية المعلومات",
    description: "استلم تذاكر الدعم من كل الأقسام والفروع وأسندها، ونفّذ طلبات الاسترجاع والتعويض.",
    views: ["it", "it-refunds", "it-reports"],
    labels: { it: "تذاكر الدعم الفني" },
  },
  IT_SPECIALIST: {
    title: "تذاكري",
    description: "تذاكر الدعم الفني المسندة إليك.",
    views: ["it"],
    labels: { it: "تذاكري" },
  },
  BRANCH_MANAGER: {
    title: "شكاوى فرعي",
    description: "تابع شكاوى العملاء على فرعك، واطلب الصيانة وأكّد الإصلاح.",
    views: ["overview", "tickets", "maintenance", "it"],
    labels: { overview: "شكاوى فرعي", tickets: "سجل شكاوى الفرع", maintenance: "طلبات الصيانة" },
  },
  MAINTENANCE_MANAGER: {
    title: "طلبات الصيانة",
    description: "استلم طلبات الفروع وأسندها للفنيين وتابع المهل.",
    views: ["maintenance", "maintenance-reports", "it"],
    labels: { maintenance: "طلبات الصيانة" },
  },
  TECHNICIAN: {
    title: "أعمالي",
    description: "أعمال الصيانة المسندة إليك.",
    views: ["maintenance", "it"],
    labels: { maintenance: "أعمالي" },
  },
  OWNER: {
    title: "أداء علاماتي",
    description: "تابع تجربة العملاء والحالات المفتوحة والطلبات المالية لعلاماتك.",
    views: [
      "overview",
      "reports",
      "qr-stats",
      "tickets",
      "refunds",
      "branches",
      "maintenance",
      "maintenance-reports",
      "it",
    ],
    labels: {
      overview: "أداء علاماتي",
      tickets: "سجل الشكاوى",
      refunds: "متابعة الاسترجاع",
      branches: "علاماتي وفروعها",
    },
  },
};
export function viewLabel(id: string, role: string, fallback: string) {
  return roleWorkspaces[role]?.labels[id] ?? fallback;
}
/** Views kept out of the menu until their integration is live (Google reviews: until connected). */
export const hiddenViews = (d: { integrations?: { google?: boolean } }) =>
  d.integrations?.google ? [] : ["reviews"];
export function canOpenView(
  id: string,
  permissions: string[],
  role?: string,
  hidden: string[] = [],
) {
  if (hidden.includes(id)) return false;
  const profile = role ? roleWorkspaces[role] : undefined;
  if (profile && !profile.views.includes(id)) return false;
  const required = viewPermissions[id];
  return !!required && (!required.length || required.some((p) => permissions.includes(p)));
}
export const permissionLabels: Record<string, string> = {
  read: "عرض الشكاوى",
  pii: "بيانات العميل",
  create: "تسجيل شكوى هاتفية",
  comment: "ملاحظات داخلية",
  contact: "التواصل مع العميل",
  task: "مهام المتابعة",
  acknowledge: "استلام العمل",
  investigate: "معالجة الشكوى",
  resolve: "توثيق الحل",
  escalate: "تصعيد الشكوى",
  assign: "إسناد لفريق الدعم",
  triage: "استقبال الشكاوى",
  close: "إغلاق الشكوى",
  "refund.request": "تسجيل طلب استرجاع",
  "refund.view": "عرض طلبات الاسترجاع وبيانات التحويل",
  "refund.decide": "الموافقة المالية",
  "refund.verify": "التحقق المالي",
  "refund.execute": "توثيق التنفيذ الخارجي",
  "refund.notify": "إبلاغ العميل بالاسترجاع",
  qa: "مراجعة الجودة",
  report: "التقارير",
  schedule: "جدولة الفريق",
  "schedule.self": "عرض جدولي",
  configure: "إدارة رموز QR والإعدادات",
  audit: "سجل التدقيق",
  privacy: "إدارة الخصوصية",
  "brands.manage": "إدارة العلامات",
  "branches.manage": "إدارة الفروع",
  "users.manage": "إدارة المستخدمين والصلاحيات",
  "directory.activate": "تفعيل وتعليق العلامات والفروع",
  "evidence.view": "عرض الإثباتات المالية",
  "evidence.attach": "إرفاق الإثباتات المالية",
  "mnt.view": "عرض طلبات الصيانة",
  "mnt.request": "طلب صيانة وتأكيد الإصلاح",
  "mnt.assign": "إسناد طلبات الصيانة",
  "mnt.work": "تنفيذ أعمال الصيانة",
  "mnt.configure": "أنواع الأعطال ومهل الصيانة",
  "mnt.report": "تقارير الصيانة",
};
export const roleDescriptions: Record<string, string> = {
  SUPER_ADMIN: "جميع صلاحيات النظام وجميع العلامات والفروع، بما فيها إدارة المستخدمين.",
  MARKETING_MANAGER:
    "الإشراف على خدمة العملاء وإسناد الشكاوى ومتابعة الجودة والتقارير وإدارة رموز QR.",
  OPERATIONS_MANAGER:
    "متابعة العمليات والعمل على الشكاوى المصعّدة إليه فقط، دون الإسناد الاعتيادي أو بيانات العميل.",
  CEO: "عرض الشكاوى والتقارير وطلبات الاسترجاع ضمن العلامات المحددة؛ دون تعديل المعالجة أو بيانات العميل الشخصية.",
  OWNER:
    "عرض الشكاوى والتقارير وطلبات الاسترجاع ضمن العلامات المحددة؛ دون تعديل المعالجة أو بيانات العميل الشخصية.",
  IT_MANAGER:
    "تطبيق تقنية المعلومات: يستلم تذاكر الدعم من كل الأقسام والفروع ويسندها للمختصين ويدير الأنواع والمهل والتقارير، وينفّذ طلبات الاسترجاع والتعويض (يستلمها على تيليجرام ويرى بيانات التحويل ويبلغ العميل)؛ دون الوصول إلى الشكاوى.",
  AGENT:
    "عرض جميع الشكاوى ضمن النطاق، وتسجيل الشكاوى ومعالجتها والتواصل مع العميل وطلب الاسترجاع أو الإلغاء ومتابعة طلباته.",
  SHIFT_LEAD: "إسناد الشكاوى لفريق خدمة العملاء ومتابعة العمل والتصعيد والإغلاق.",
  CUSTOMER_SERVICE_MANAGER: "إدارة فريق خدمة العملاء وإسناد الشكاوى ومتابعة الحلول والتقارير.",
  AREA_MANAGER: "متابعة فروع المنطقة والعمل على الشكاوى المصعّدة إليه فقط.",
  BRAND_OPERATIONS_MANAGER: "متابعة العلامات المحددة والعمل على التصعيد المسند إليه.",
  GROUP_OPERATIONS_MANAGER: "متابعة عمليات العلامات المحددة والعمل على التصعيد المسند إليه.",
  BRANCH_MANAGER:
    "عرض شكاوى فرعه دون بيانات العميل وإضافة ملاحظات، وطلب الصيانة وتأكيد الإصلاح. يُحدد فرعه في نطاق الفروع.",
  MAINTENANCE_MANAGER:
    "تطبيق الصيانة فقط: يرى جميع طلبات الصيانة ضمن نطاقه ويسندها للفنيين ويدير أنواع الأعطال والمهل؛ دون الوصول إلى الشكاوى.",
  TECHNICIAN: "تطبيق الصيانة فقط: يرى أعمال الصيانة المسندة إليه ويبدأها ويوثّق الإصلاح بالصور.",
  IT_SPECIALIST:
    "تطبيق تقنية المعلومات فقط: يرى تذاكر الدعم الفني المسندة إليه ويبدأها ويوثّق الحل؛ دون الوصول إلى الشكاوى أو الاسترجاع.",
  FINANCE_APPROVER: "مراجعة الاسترجاع والموافقة والتحقق المالي مع فصل التنفيذ عن التحقق.",
  REFUND_PROCESSOR: "توثيق تنفيذ الاسترجاع خارج النظام وإبلاغ العميل؛ دون الموافقة المالية.",
  QA_REVIEWER: "مراجعة جودة معالجة الشكاوى وإضافة التقييمات.",
  SCHEDULER: "إدارة جدول الفريق والورديات ضمن العلامات المحددة.",
  ADMIN: "إدارة العلامات والفروع ورموز QR وسجل التدقيق؛ دون بيانات العميل أو إدارة المستخدمين.",
  PRIVACY_OFFICER: "عرض بيانات العميل وإدارة الخصوصية وسجل التدقيق ضمن النطاق المحدد.",
};
