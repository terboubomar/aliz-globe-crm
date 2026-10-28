import type { ComplaintReceipt } from "./complaint-receipt";
import { ReceiptDetails, confirmationLabels } from "./receipt-details";
import { useState, useEffect } from "react";
import { api, states, date } from "./types";
import { ShieldCheck, RefreshCw } from "lucide-react";
export default function Tracking({ token }: { token: string }) {
  const [data, setData] = useState<{
      number: string;
      state: string;
      createdAt: string;
      receipt?: ComplaintReceipt;
      confirmationStatus?: string;
    } | null>(null),
    [error, setError] = useState("");
  async function load() {
    try {
      setData(await api("public/status/" + token));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <main className="public-shell">
      <div className="public-top">
        <img src="/logos/aliz.webp" alt="أليز غلوب" />
        <span>متابعة البلاغ</span>
      </div>
      <section className="public-card public-success">
        <ShieldCheck size={45} />
        <h1>متابعة حالة البلاغ</h1>
        {data && (
          <>
            <div className="receipt-number" dir="ltr">
              {data.number}
            </div>
            <h2>{states[data.state]}</h2>
            <p>تم الاستقبال: {date(data.createdAt)}</p>
            {data.receipt && <ReceiptDetails receipt={data.receipt} />}
            {data.confirmationStatus && confirmationLabels[data.confirmationStatus] && (
              <p className="notice">{confirmationLabels[data.confirmationStatus]}</p>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="secondary" onClick={load}>
          <RefreshCw size={16} />
          تحديث الحالة
        </button>
        <p className="hint">احتفظ بهذا الرابط في مكان آمن. يعرض تفاصيل شكواك وحالتها.</p>
      </section>
    </main>
  );
}
