import { useState, FormEvent } from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import { Data, Ticket, states } from "./types";
import { complaintActions, nextComplaintAction, canWorkComplaint, agentInvolved } from "./workflow";
import { Field, Submit } from "./ui";
import { fill, matching } from "@/lib/reply-templates";
import { useReplyTemplates } from "./reply-templates-cache";
export function ComplaintActionPanel({
  ticket: t,
  data,
  busy,
  mutate,
}: {
  ticket: Ticket;
  data: Data;
  busy: boolean;
  mutate: (p: string, b?: unknown) => Promise<unknown>;
}) {
  const [action, setAction] = useState<string | null>(null),
    [error, setError] = useState(""),
    [outcome, setOutcome] = useState("");
  const templates = useReplyTemplates();
  const next = nextComplaintAction(t);
  const allowed = complaintActions.filter(
    (a) =>
      data.permissions.includes(a.perm) &&
      (a.id !== "comment" || data.me.role !== "AGENT" || agentInvolved(t, data.me.id)) &&
      (a.id !== "followup" || data.me.role !== "AGENT" || t.communicationsOwner === data.me.id) &&
      (!["start", "resolve", "escalate"].includes(a.id) ||
        canWorkComplaint(data.me, t, data.permissions)) &&
      a.from.includes(t.state) &&
      (a.id !== "close" || !!t.customerConfirmedAt),
  );
  const selected =
    action && allowed.some((a) => a.id === action)
      ? action
      : t.state !== "CLOSED" && allowed.some((a) => a.id === next.action)
        ? next.action
        : (allowed.find((a) => a.id === "comment")?.id ?? allowed[0]?.id);
  const inBranch = (u: Data["users"][number]) =>
    u.brandIds.includes(t.brandId) &&
    (!u.branchIds.length || u.branchIds.includes(t.branchId ?? ""));
  const supervisors = data.users.filter(
    (u) =>
      [
        "SHIFT_LEAD",
        "MARKETING_MANAGER",
        "OPERATIONS_MANAGER",
        "CUSTOMER_SERVICE_MANAGER",
        "AREA_MANAGER",
        "BRAND_OPERATIONS_MANAGER",
        "GROUP_OPERATIONS_MANAGER",
      ].includes(u.role) &&
      u.id !== data.me.id &&
      inBranch(u),
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      b = Object.fromEntries(new FormData(el).entries());
    setError("");
    try {
      await mutate(`tickets/${t.id}/actions/${selected}`, {
        ...b,
        note: b["note"] || "بدأ المسؤول العمل على معالجة الشكوى",
        version: t.version,
      });
      el.reset();
      setAction(null);
      setOutcome("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="guided-action">
      <div className="guided-action-heading">
        <span className="badge burgundy">{states[t.state]}</span>
        <div>
          <h3>
            {t.state === "CLOSED" ? "تم الحل والتواصل مع العميل" : `الخطوة التالية: ${next.label}`}
          </h3>
          <p>
            <UserRound size={14} />
            {next.owner}
          </p>
        </div>
        <ArrowLeft size={20} />
      </div>
      {t.escalated && t.state !== "CLOSED" && (
        <p className="notice">
          {t.events.some((e) => e.type === "ESCALATION_ROUTED")
            ? `تم التصعيد إلى ${data.users.find((u) => u.id === t.resolutionOwner)?.name ?? "المسؤول المختص"}.`
            : "تحتاج الشكوى إلى متابعة المشرف وتحديد المسؤول المناسب."}
        </p>
      )}
      {!allowed.some((a) => a.id === next.action) && t.state !== "CLOSED" && (
        <p className="hint">بانتظار المسؤول.</p>
      )}
      {allowed.length > 0 && (
        <>
          <div className="complaint-action-choices" aria-label="إجراءات الشكوى">
            {allowed
              .filter((a) => a.id !== selected)
              .map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={a.id === selected}
                  className="secondary"
                  onClick={() => {
                    setAction(a.id);
                    setError("");
                  }}
                >
                  {a.label}
                </button>
              ))}
          </div>
          <form onSubmit={submit} key={selected}>
            <div className="form-grid">
              {selected === "assign" && (
                <>
                  <Field label="مسؤول الدعم" full>
                    <select
                      name="resolutionOwner"
                      aria-label="مسؤول الدعم"
                      required
                      defaultValue={t.resolutionOwner ?? ""}
                    >
                      <option value="">اختر موظف خدمة العملاء</option>
                      {data.users
                        .filter(
                          (u) =>
                            [
                              "AGENT",
                              "SHIFT_LEAD",
                              "MARKETING_MANAGER",
                              "CUSTOMER_SERVICE_MANAGER",
                            ].includes(u.role) && inBranch(u),
                        )
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                    <small>نفس المسؤول يتولى المعالجة والتواصل مع العميل.</small>
                  </Field>
                </>
              )}
              {selected === "followup" && (
                <Field label="نتيجة التواصل مع العميل" full>
                  <select
                    name="outcome"
                    value={outcome}
                    required
                    onChange={(e) => setOutcome(e.target.value)}
                  >
                    <option value="">حدد نتيجة التواصل</option>
                    <option value="SATISFIED">أكد العميل حل المشكلة — إغلاق الشكوى</option>
                    <option value="UNRESOLVED">المشكلة مستمرة — تصعيد للمسؤول</option>
                    <option value="UNREACHABLE">لم نتمكن من الوصول — إعادة المحاولة لاحقاً</option>
                  </select>
                </Field>
              )}
              {(selected === "escalate" ||
                (selected === "followup" && outcome === "UNRESOLVED")) && (
                <Field label="تصعيد إلى" full>
                  <select name="resolutionOwner" required defaultValue="">
                    <option value="">اختر المشرف أو مدير المنطقة أو العمليات</option>
                    {supervisors.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <small>يستلم المسؤول التصعيد، ثم يعود فريق خدمة العملاء للتواصل مع العميل.</small>
                </Field>
              )}
              {(selected === "escalate" || (selected === "followup" && outcome === "UNRESOLVED")) &&
                !t.branchBrief && (
                  <Field label="موجز التصعيد — دون بيانات العميل" full>
                    <textarea
                      name="branchBrief"
                      aria-label="موجز التصعيد"
                      required
                      minLength={10}
                      maxLength={1000}
                      rows={2}
                      placeholder="اشرح المشكلة والإجراء المطلوب دون أسماء أو أرقام اتصال."
                    />
                  </Field>
                )}
              {selected !== "start" && (
                <Field
                  label={
                    selected === "resolve"
                      ? "الإجراء المنفذ لشرحه للعميل"
                      : selected === "followup"
                        ? "ملخص رد العميل أو محاولة التواصل"
                        : selected === "escalate"
                          ? "سبب التصعيد"
                          : "ملاحظة"
                  }
                  full
                >
                  <TemplatePicker
                    options={matching(templates, {
                      action: selected ?? "",
                      category: t.category,
                      brandId: t.brandId,
                    })}
                    vars={{
                      number: t.number,
                      brand: t.brand?.name ?? "",
                      branch: t.branch?.name ?? "",
                      me: data.me.name,
                    }}
                  />
                  <textarea name="note" rows={2} required minLength={3} maxLength={2000} />
                </Field>
              )}
            </div>
            {selected === "followup" &&
              outcome === "SATISFIED" &&
              t.refunds.some((r) => !["COMPLETED", "REJECTED"].includes(r.status)) && (
                <p className="hint">
                  يُحفظ تأكيد العميل الآن. يبقى الإغلاق معلقاً حتى اكتمال الطلب المالي المرتبط.
                </p>
              )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {selected === "close" &&
              t.refunds.some((r) => !["COMPLETED", "REJECTED"].includes(r.status)) && (
                <p className="hint">
                  تأكيد العميل محفوظ؛ أكمل الطلب المالي في قسم الاسترجاع والإلغاء قبل الإغلاق.
                </p>
              )}
            <Submit busy={busy}>
              {selected === "followup"
                ? "حفظ نتيجة التواصل"
                : (complaintActions.find((a) => a.id === selected)?.label ?? "حفظ")}
            </Submit>
          </form>
        </>
      )}
    </section>
  );
}

/** Fills the note box below it with a ready-made reply; the text stays editable. */
function TemplatePicker({
  options,
  vars,
}: {
  options: ReturnType<typeof matching>;
  vars: Parameters<typeof fill>[1];
}) {
  if (!options.length) return null;
  return (
    <span className="template-picker">
      <select
        aria-label="رد جاهز"
        value=""
        onChange={(e) => {
          const picked = options.find((o) => o.id === e.target.value);
          const box = e.currentTarget
            .closest(".template-picker")
            ?.parentElement?.querySelector<HTMLTextAreaElement>('textarea[name="note"]');
          if (!picked || !box) return;
          box.value = fill(picked.text, vars).slice(0, 2000);
          box.focus();
        }}
      >
        <option value="">📝 اختر رداً جاهزاً ({options.length})</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title}
          </option>
        ))}
      </select>
    </span>
  );
}
