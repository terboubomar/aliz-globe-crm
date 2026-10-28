import { Ticket, User } from "./types";
export const complaintStages = [
  { id: "new", label: "استقبال الشكوى", hint: "بانتظار إسناد قائد فريق الدعم" },
  { id: "routing", label: "الإسناد", hint: "إلى الشخص المناسب في خدمة العملاء" },
  { id: "processing", label: "جارٍ العمل", hint: "معالجة المشكلة وتوثيق الحل" },
  { id: "followup", label: "التواصل مع العميل", hint: "شرح الإجراء والتأكد من حل المشكلة" },
  { id: "closed", label: "تم الحل", hint: "تم التواصل وتأكيد الحل" },
];
export function complaintStage(t: Ticket) {
  if (t.state === "CLOSED") return "closed";
  if (t.state === "RESOLVED") return "followup";
  if (t.resolutionOwner && t.resolutionOwner === t.branchId) return "new";
  if (["ACKNOWLEDGED", "IN_PROGRESS"].includes(t.state)) return "processing";
  if (t.state === "ASSIGNED") return "routing";
  return "new";
}
export function canWorkComplaint(me: User, t: Ticket, permissions: string[]) {
  return (
    permissions.includes("assign") ||
    (t.resolutionOwner === me.id &&
      (["AGENT", "SHIFT_LEAD", "MARKETING_MANAGER", "CUSTOMER_SERVICE_MANAGER"].includes(me.role) ||
        t.escalated))
  );
}
export function nextComplaintAction(t: Ticket) {
  if (
    t.resolutionOwner &&
    t.resolutionOwner === t.branchId &&
    !["RESOLVED", "CLOSED"].includes(t.state)
  )
    return { action: "assign", label: "إسناد إلى فريق الدعم", owner: "قائد فريق الدعم" };
  switch (t.state) {
    case "NEW":
    case "TRIAGED":
      return {
        action: "assign",
        label: "إسناد إلى المسؤول",
        owner: "قائد فريق الدعم أو مدير خدمة العملاء",
      };
    case "ASSIGNED":
    case "ACKNOWLEDGED":
      return { action: "start", label: "بدء العمل", owner: "مسؤول المعالجة" };
    case "IN_PROGRESS":
      return {
        action: "resolve",
        label: "الانتقال للتواصل مع العميل",
        owner: "مسؤول خدمة العملاء",
      };
    case "RESOLVED":
      return t.customerConfirmedAt
        ? { action: "close", label: "إغلاق بعد اكتمال الطلب المالي المرتبط", owner: "قائد الفريق" }
        : { action: "followup", label: "التواصل مع العميل", owner: "مسؤول التواصل" };
    default:
      return { action: "reopen", label: "إعادة الفتح عند استمرار المشكلة", owner: "قائد الفريق" };
  }
}
export const complaintActions = [
  {
    id: "assign",
    label: "إسناد إلى المسؤول",
    perm: "assign",
    from: ["NEW", "TRIAGED", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS"],
  },
  { id: "start", label: "بدء العمل", perm: "investigate", from: ["ASSIGNED", "ACKNOWLEDGED"] },
  { id: "resolve", label: "الانتقال للتواصل مع العميل", perm: "resolve", from: ["IN_PROGRESS"] },
  { id: "followup", label: "التواصل مع العميل", perm: "contact", from: ["RESOLVED"] },
  { id: "close", label: "إغلاق الشكوى", perm: "close", from: ["RESOLVED"] },
  { id: "reopen", label: "إعادة فتح الشكوى", perm: "close", from: ["CLOSED"] },
  {
    id: "escalate",
    label: "تصعيد إلى المشرف / المنطقة / العمليات",
    perm: "escalate",
    from: ["ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"],
  },
  {
    id: "comment",
    label: "إضافة ملاحظة",
    perm: "comment",
    from: ["NEW", "TRIAGED", "ASSIGNED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  },
];
export function elapsed(s: string, end?: string | null) {
  const minutes = Math.max(
    0,
    Math.floor(((end ? +new Date(end) : Date.now()) - +new Date(s)) / 60000),
  );
  return minutes < 60
    ? `${minutes.toLocaleString("ar-SA-u-nu-latn")} د`
    : minutes < 1440
      ? `${Math.floor(minutes / 60).toLocaleString("ar-SA-u-nu-latn")} س ${(minutes % 60).toLocaleString("ar-SA-u-nu-latn")} د`
      : `${Math.floor(minutes / 1440).toLocaleString("ar-SA-u-nu-latn")} يوم`;
}

export function agentInvolved(t: Ticket, id: string) {
  return t.creator === id || t.resolutionOwner === id || t.communicationsOwner === id;
}
