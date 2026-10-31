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
  users: ["users.manage"],
  settings: [],
};
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
    views: Object.keys(viewPermissions),
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
    ],
    labels: { overview: "تجربة العملاء", tickets: "شكاوى العملاء" },
  },
  SHIFT_LEAD: {
    title: "لوحة قيادة الفريق",
    description: "أسند الشكاوى وتابع عبء العمل والحالات التي تحتاج تدخلك.",
    views: ["overview", "tickets", "refunds", "branches", "customers", "tasks"],
    labels: { overview: "قيادة الفريق", tickets: "الاستقبال والإسناد", tasks: "متابعات الفريق" },
  },
  AGENT: {
    title: "مساحة عملي",
    description: "ابحث في شكاوى العملاء، وتابع عملك وطلبات الاسترجاع.",
    views: ["overview", "tickets", "refunds", "tasks", "schedule"],
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
    views: ["overview", "tickets", "refunds", "reports"],
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
    views: ["overview", "reports", "tickets", "refunds", "branches"],
    labels: { overview: "النظرة التنفيذية", tickets: "سجل الشكاوى", refunds: "متابعة الاسترجاع" },
  },
  IT_MANAGER: {
    title: "طلبات الاسترجاع",
    description: "استلم طلبات الاسترجاع ونفّذها ووثّق التنفيذ وأبلغ العميل.",
    views: ["refunds"],
    labels: { refunds: "طلبات الاسترجاع" },
  },
  OWNER: {
    title: "أداء علاماتي",
    description: "تابع تجربة العملاء والحالات المفتوحة والطلبات المالية لعلاماتك.",
    views: ["overview", "reports", "tickets", "refunds", "branches"],
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
export function canOpenView(id: string, permissions: string[], role?: string) {
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
    "طلبات الاسترجاع فقط: يستلم كل طلب جديد على تيليجرام، ويرى بيانات التحويل (حساب بنكي أو محفظة)، ويوثّق التنفيذ ويبلغ العميل؛ دون الوصول إلى الشكاوى.",
  AGENT:
    "عرض جميع الشكاوى ضمن النطاق، وتسجيل الشكاوى ومعالجتها والتواصل مع العميل وطلب الاسترجاع أو الإلغاء ومتابعة طلباته.",
  SHIFT_LEAD: "إسناد الشكاوى لفريق خدمة العملاء ومتابعة العمل والتصعيد والإغلاق.",
  CUSTOMER_SERVICE_MANAGER: "إدارة فريق خدمة العملاء وإسناد الشكاوى ومتابعة الحلول والتقارير.",
  AREA_MANAGER: "متابعة فروع المنطقة والعمل على الشكاوى المصعّدة إليه فقط.",
  BRAND_OPERATIONS_MANAGER: "متابعة العلامات المحددة والعمل على التصعيد المسند إليه.",
  GROUP_OPERATIONS_MANAGER: "متابعة عمليات العلامات المحددة والعمل على التصعيد المسند إليه.",
  BRANCH_MANAGER: "عرض شكاوى الفروع المحددة وإضافة ملاحظات؛ لا تُسند إليه المعالجة الاعتيادية.",
  FINANCE_APPROVER: "مراجعة الاسترجاع والموافقة والتحقق المالي مع فصل التنفيذ عن التحقق.",
  REFUND_PROCESSOR: "توثيق تنفيذ الاسترجاع خارج النظام وإبلاغ العميل؛ دون الموافقة المالية.",
  QA_REVIEWER: "مراجعة جودة معالجة الشكاوى وإضافة التقييمات.",
  SCHEDULER: "إدارة جدول الفريق والورديات ضمن العلامات المحددة.",
  ADMIN: "إدارة العلامات والفروع ورموز QR وسجل التدقيق؛ دون بيانات العميل أو إدارة المستخدمين.",
  PRIVACY_OFFICER: "عرض بيانات العميل وإدارة الخصوصية وسجل التدقيق ضمن النطاق المحدد.",
};
