import { useEffect, useState } from "react";
import { Fingerprint, LoaderCircle, Smartphone, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { deviceSupportsPasskey, passkeyMessage } from "@/lib/passkey-errors";
import { date } from "./types";

type Key = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };

/** A short name for the device this passkey is being saved on. */
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  return "جهاز";
}

/**
 * Account → Face ID / Touch ID: save a passkey on this device so the staff
 * member can sign in with their face or fingerprint instead of a password, see
 * the devices already saved, and remove any of them.
 */
export function PasskeyAccount() {
  const [keys, setKeys] = useState<Key[] | null>(null),
    [supported, setSupported] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");

  async function refresh() {
    const { data, error } = await supabase.auth.passkey.list();
    if (error) {
      setKeys([]);
      return setError(passkeyMessage(error, "register"));
    }
    setKeys((data ?? []) as Key[]);
  }
  useEffect(() => {
    deviceSupportsPasskey().then(setSupported);
    refresh();
  }, []);

  async function add() {
    setBusy(true);
    setError("");
    setNotice("");
    const { data, error } = await supabase.auth.registerPasskey();
    if (error) {
      setBusy(false);
      return setError(passkeyMessage(error, "register"));
    }
    if (data?.id)
      await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: deviceName() });
    await refresh();
    setBusy(false);
    setNotice("تم التفعيل. في المرة القادمة اضغط «الدخول بـ Face ID / Touch ID» في صفحة الدخول.");
  }

  async function remove(k: Key) {
    if (!window.confirm(`إزالة ${k.friendly_name || "هذا الجهاز"}؟`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    const { error } = await supabase.auth.passkey.delete({ passkeyId: k.id });
    if (error) setError(passkeyMessage(error, "register"));
    await refresh();
    setBusy(false);
  }

  return (
    <div className="two-step">
      <div className={"two-step-state" + (keys?.length ? " on" : "")}>
        <Fingerprint size={22} />
        <div>
          <b>{keys?.length ? "الدخول بالبصمة مفعّل" : "ادخل بوجهك أو بصمتك"}</b>
          <small>
            بدل كلمة المرور، يكفي Face ID أو Touch ID (أو Windows Hello). يُحفظ على جهازك ولا يصلنا
            وجهك أو بصمتك.
          </small>
        </div>
      </div>

      {keys === null ? (
        <p className="hint">جارٍ التحميل…</p>
      ) : keys.length > 0 ? (
        <ul className="passkey-list">
          {keys.map((k) => (
            <li key={k.id}>
              <Smartphone size={18} />
              <div>
                <b>{k.friendly_name || "جهاز"}</b>
                <small>
                  أضيف {date(k.created_at)}
                  {k.last_used_at ? ` · آخر استخدام ${date(k.last_used_at)}` : ""}
                </small>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label={`إزالة ${k.friendly_name || "الجهاز"}`}
                disabled={busy}
                onClick={() => remove(k)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {supported === false ? (
        <p className="hint">
          هذا الجهاز أو المتصفح لا يدعم Face ID / Touch ID للمواقع. جرّب من جوالك أو متصفح
          Safari/Chrome حديث.
        </p>
      ) : (
        <button type="button" className="primary" disabled={busy || !supported} onClick={add}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <Fingerprint size={17} />}
          {keys?.length ? "إضافة هذا الجهاز" : "تفعيل على هذا الجهاز"}
        </button>
      )}

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
