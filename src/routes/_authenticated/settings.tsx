import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp, errMessage } from "@/lib/app-data";
import { updateSetting } from "@/functions/admin.functions";
import { PageHead } from "@/components/crm";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "الإعدادات والتكاملات — أليز غلوب" }, { name: "description", content: "حالة التفعيل والتكاملات" }, { property: "og:title", content: "الإعدادات والتكاملات" }, { property: "og:description", content: "حالة التفعيل والتكاملات" }] }),
  component: SettingsPage,
});

function Row({ label, ok, note }: { label: string; ok: boolean; note: string }) {
  return (
    <tr><td className="font-bold">{label}</td><td><span className={ok ? "chip-ok" : "chip-warn"}>{ok ? "مفعل" : "غير مفعل"}</span></td><td className="text-sm text-muted-foreground">{note}</td></tr>
  );
}

function SettingsPage() {
  const app = useApp();
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const admin = app.has("users.manage");
  return (
    <>
      <PageHead title="الإعدادات والتكاملات" />
      <div className="panel overflow-x-auto">
        <table className="table"><tbody>
          <Row label="استقبال الشكاوى العامة عبر QR" ok={app.flags.publicIntake} note="يبقى مغلقاً حتى يعتمده المالك وتُراجع الخصوصية." />
          <Row label="السياسة المالية وحد الموافقة" ok={app.flags.financeApproved} note="لا قرارات مالية قبل الاعتماد. لا تحويل أموال من النظام." />
          <Row label={`سياسة مهل الخدمة (${app.flags.slaVersion})`} ok={app.flags.slaApproved} note="مهل مقترحة من المصدر بانتظار الاعتماد." />
          <Row label="تأكيدات واتساب (Meta)" ok={app.flags.whatsapp} note="غير مهيأ — لا تُرسل أي رسائل." />
          <Row label="تنبيهات تيليجرام للموظفين" ok={app.flags.telegram} note="غير مهيأ — لا تُرسل أي رسائل." />
          <Row label="فحص الملفات من البرمجيات الضارة" ok={false} note="غير متوفر بعد؛ الملفات تبقى بانتظار الفحص ولا تُعرض." />
        </tbody></table>
      </div>
      {admin && (
        <div className="panel mt-4 space-y-2">
          <h2 className="font-bold">مفاتيح التفعيل (مدير النظام)</h2>
          <button className="btn-ghost" onClick={async () => {
            if (!app.flags.publicIntake && !confirm("تفعيل الاستقبال العام يجعل روابط QR النشطة متاحة للعملاء. متابعة؟")) return;
            try { await updateSetting({ data: { key: "public_intake_enabled", value: !app.flags.publicIntake } }); qc.invalidateQueries(); } catch (e) { setMsg(errMessage(e)); }
          }}>{app.flags.publicIntake ? "إيقاف الاستقبال العام" : "تفعيل الاستقبال العام"}</button>
          {msg && <p className="error-text">{msg}</p>}
          <p className="text-xs text-muted-foreground">اعتماد السياسة المالية وحدودها ومهل الخدمة يتم بقرار موثق من المالك، وليس من هذه الصفحة.</p>
        </div>
      )}
    </>
  );
}
