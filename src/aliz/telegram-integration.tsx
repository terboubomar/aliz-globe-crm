import { useCallback, useEffect, useState } from "react";
import { Send, ExternalLink, RefreshCw, Link2, Unlink } from "lucide-react";
import { api, n, roleNames } from "./types";
type Account = {
  available: boolean;
  linked: boolean;
  label: string | null;
  pending: { label: string; fingerprint: string } | null;
  expiresAt: string | null;
};
export function TelegramAccount() {
  const [account, setAccount] = useState<Account | null>(null),
    [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [disconnecting, setDisconnecting] = useState(false);
  const load = useCallback(async () => {
    try {
      setAccount(await api<Account>("integrations/telegram/account"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!link) return;
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, [link, load]);
  async function action(path: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ url: string; expiresAt: string }>(
        "integrations/telegram/" + path,
        body,
      );
      setLink(path === "link" ? result : null);
      setDisconnecting(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const expired = link && new Date(link.expiresAt) <= new Date();
  return (
    <div className="telegram-account padded">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!account && !error && <p role="status">جارٍ التحميل…</p>}
      {account && (
        <>
          <div className="telegram-account-status">
            <span className={"badge " + (account.linked ? "green" : "neutral")}>
              {account.linked ? "مرتبط" : "غير مرتبط"}
            </span>
            {account.label && <b dir="auto">{account.label}</b>}
            <button
              className="icon-btn"
              aria-label="تحديث حالة ربط تيليجرام"
              onClick={() => void load()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {!account.available && <p className="hint">بانتظار تفعيل البوت من مسؤول النظام.</p>}
          {account.available && (
            <>
              {!link && !account.pending && (
                <button className="secondary" disabled={busy} onClick={() => void action("link")}>
                  <Link2 size={16} />
                  {account.linked ? "تغيير حساب تيليجرام" : "ربط حسابي بتيليجرام"}
                </button>
              )}
              {link && !account.pending && (
                <div className="telegram-link-step">
                  {expired ? (
                    <>
                      <p className="hint">انتهت صلاحية الرابط.</p>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void action("link")}
                      >
                        إنشاء رابط جديد
                      </button>
                    </>
                  ) : (
                    <>
                      <a
                        className="primary"
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink size={16} />
                        فتح البوت
                      </a>
                      <p className="hint">
                        اضغط Start في تيليجرام، ثم أكّد حسابك هنا. الرابط صالح لمدة 10 دقائق.
                      </p>
                    </>
                  )}
                </div>
              )}
              {account.pending && (
                <div className="telegram-confirm">
                  <p>
                    هل هذا حسابك؟ <b dir="auto">{account.pending.label}</b>
                  </p>
                  <p className="hint">سيستقبل هذا الحساب تنبيهات الشكاوى الخاصة بك.</p>
                  <div className="telegram-actions">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void action("confirm", { fingerprint: account.pending!.fingerprint })
                      }
                    >
                      تأكيد الربط
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void action("link")}
                    >
                      استخدام حساب آخر
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {(account.linked || link || account.pending) && (
            <div className="telegram-disconnect">
              {disconnecting ? (
                <>
                  <p>إلغاء الربط وإيقاف تنبيهات تيليجرام لحسابك؟</p>
                  <div className="telegram-actions">
                    <button
                      className="danger-btn"
                      disabled={busy}
                      onClick={() => void action("disconnect")}
                    >
                      إلغاء الربط
                    </button>
                    <button className="secondary" onClick={() => setDisconnecting(false)}>
                      تراجع
                    </button>
                  </div>
                </>
              ) : (
                <button className="text-btn" onClick={() => setDisconnecting(true)}>
                  <Unlink size={15} />
                  إلغاء الربط
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
type Status = {
  ready: boolean;
  enabled: boolean;
  missing: string[];
  statuses: Record<string, number>;
  users: { id: string; name: string; role: string; linked: boolean }[];
};
export function TelegramIntegration() {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(path: string, body: unknown, done: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, body);
      setNotice(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>("integrations/telegram"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const labels: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: "رمز البوت الآمن",
    TELEGRAM_BOT_USERNAME: "اسم مستخدم البوت",
    TELEGRAM_WEBHOOK_SECRET: "مفتاح التحقق من البوت",
    PUBLIC_HTTPS_APP_ORIGIN: "رابط CRM عام وآمن",
  };
  return (
    <section className="panel telegram-integration">
      <div className="panel-head">
        <h2>
          <Send size={19} />
          تنبيهات تيليجرام
        </h2>
        <button className="text-btn" onClick={() => void load()}>
          <RefreshCw size={15} />
          تحديث
        </button>
      </div>
      <div className="padded">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <>
            <div className="telegram-account-status">
              <span className={"badge " + (status.ready ? "green" : "neutral")}>
                {status.ready ? "مهيأ للإرسال" : "غير مفعّل"}
              </span>
              <small>
                شكوى جديدة وملخص يومي ← المسؤول الأعلى · إسناد الشكاوى وتذكير الورديات وجدول الأسبوع
                ← الموظف
              </small>
            </div>
            <div className="telegram-actions">
              {status.enabled ? (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run("settings/telegram", { enabled: false }, "تم إيقاف البوت.")
                  }
                >
                  إيقاف البوت
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy || status.missing.length > 0}
                  onClick={() =>
                    void run("settings/telegram", { enabled: true }, "تم تفعيل البوت.")
                  }
                >
                  تفعيل البوت
                </button>
              )}
              <button
                className="secondary"
                disabled={busy || status.missing.length > 0}
                onClick={() =>
                  void run(
                    "integrations/telegram/webhook",
                    {},
                    "تم ربط البوت بالنظام. يمكن للموظفين الآن ربط حساباتهم.",
                  )
                }
              >
                ربط البوت بالنظام
              </button>
            </div>
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <div className="whatsapp-counts">
              {[
                [
                  "في الانتظار",
                  (status.statuses["QUEUED"] ?? 0) + (status.statuses["SENDING"] ?? 0),
                ],
                ["تم الإرسال", status.statuses["SENT"] ?? 0],
                [
                  "تحتاج مراجعة",
                  (status.statuses["FAILED"] ?? 0) +
                    (status.statuses["UNKNOWN"] ?? 0) +
                    (status.statuses["EXPIRED"] ?? 0),
                ],
                ["حسابات مرتبطة", status.users.filter((u) => u.linked).length],
              ].map(([label, count]) => (
                <span key={label}>
                  <b>{n(Number(count))}</b>
                  {label}
                </span>
              ))}
            </div>
            {!status.ready && (
              <details>
                <summary>متطلبات الربط</summary>
                <ul>
                  {!status.enabled && <li>تفعيل البوت</li>}
                  {status.missing.map((k) => (
                    <li key={k}>{labels[k] ?? k}</li>
                  ))}
                </ul>
              </details>
            )}
            <details className="telegram-team">
              <summary>حالة ربط الفريق</summary>
              <ul>
                {status.users.map((u) => (
                  <li key={u.id}>
                    <span>
                      {u.name}
                      <small>{roleNames[u.role] ?? u.role}</small>
                    </span>
                    <span className={"badge " + (u.linked ? "green" : "neutral")}>
                      {u.linked ? "مرتبط" : "غير مرتبط"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
      <div className="telegram-self">
        <h3>حسابي على تيليجرام</h3>
        <TelegramAccount />
      </div>
    </section>
  );
}
