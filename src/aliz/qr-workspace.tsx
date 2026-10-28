import { useCallback, useEffect, useState, FormEvent } from "react";
import {
  Plus,
  Search,
  QrCode,
  Download,
  Copy,
  ExternalLink,
  Printer,
  RefreshCw,
  MapPin,
} from "lucide-react";
import QRCode from "qrcode";
import { api, Brand, Branch, Data, date, n } from "./types";
import { Empty, Field, Modal, Submit } from "./ui";
export type BranchQR = {
  id: string;
  branchId: string;
  placement: string;
  active: boolean;
  scans: number;
  createdAt: string;
  revokedAt: string | null;
  reusable: boolean;
};
export function QRWorkspace({
  data,
  brand,
  onDirectory,
}: {
  data: Data;
  brand: string;
  onDirectory: () => void;
}) {
  const [qrs, setQrs] = useState<BranchQR[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState(""),
    [choosing, setChoosing] = useState(false),
    [branchId, setBranchId] = useState("");
  const permitted = data.permissions.includes("configure");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setQrs(await api<BranchQR[]>("qrs"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (permitted) void load();
  }, [load, permitted]);
  const branches = data.brands
    .filter((b) => brand === "all" || b.id === brand)
    .flatMap((b) => b.branches.map((branch) => ({ ...branch, brand: b })));
  const visible = branches.filter((b) => {
    const active = qrs.some((q) => q.branchId === b.id && q.active);
    return (
      (!search || [b.name, b.city, b.code, b.brand.name].join(" ").includes(search.trim())) &&
      (status === "all" ||
        (status === "ready" && active && b.active) ||
        (status === "missing" && !active && b.active) ||
        (status === "inactive" && !b.active))
    );
  });
  const selectedBranch = data.brands
    .flatMap((b) => b.branches.map((branch) => ({ ...branch, brand: b })))
    .find((b) => b.id === selected);
  const activeBranches = branches.filter((b) => b.active);
  const ready = activeBranches.filter((b) =>
    qrs.some((q) => q.branchId === b.id && q.active),
  ).length;
  if (!permitted)
    return (
      <section className="panel">
        <Empty
          title="إدارة رموز QR متاحة لمسؤول النظام"
          detail="تواصل مع المسؤول لإنشاء رمز أو تحديثه لفرعك."
        />
      </section>
    );
  return (
    <>
      <section className="panel qr-workspace">
        <div className="panel-head">
          <div>
            <h2>رموز استقبال الشكاوى</h2>
          </div>
          <button
            className="primary"
            disabled={!activeBranches.length || loading || !!error}
            onClick={() => {
              setBranchId(activeBranches[0]?.id ?? "");
              setChoosing(true);
            }}
          >
            <Plus size={17} />
            رمز QR للفرع
          </button>
        </div>
        <div className="qr-summary" aria-label="ملخص رموز الفروع">
          <span>
            <b>{n(ready)}</b> فروع برموز نشطة
          </span>
          <span>
            <b>{n(activeBranches.length - ready)}</b> فروع تحتاج رمزاً
          </span>
          <span>
            <b>
              {n(
                qrs
                  .filter((q) => branches.some((b) => b.id === q.branchId))
                  .reduce((s, q) => s + q.scans, 0),
              )}
            </b>{" "}
            فتح لنماذج العملاء
          </span>
        </div>
        <div className="qr-controls">
          <label className="qr-search">
            <Search size={18} />
            <input
              aria-label="البحث عن فرع"
              placeholder="ابحث باسم الفرع أو المدينة أو الرمز"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="حالة رمز الفرع"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">جميع الفروع</option>
            <option value="ready">برمز نشط</option>
            <option value="missing">تحتاج رمزاً</option>
            <option value="inactive">فروع غير نشطة</option>
          </select>
          <button className="secondary" disabled={loading} onClick={load}>
            <RefreshCw size={16} />
            تحديث الرموز
          </button>
        </div>
        {error ? (
          <div className="padded" role="alert">
            <p className="error">{error}</p>
            <button className="secondary" onClick={load}>
              إعادة المحاولة
            </button>
          </div>
        ) : loading ? (
          <p className="padded" role="status">
            جارٍ تحميل الرموز…
          </p>
        ) : !visible.length ? (
          <Empty
            title={branches.length ? "لا توجد فروع تطابق البحث" : "أضف فرعاً لإنشاء رمزه"}
            detail={
              branches.length
                ? "غيّر البحث أو حالة الرمز لعرض الفروع."
                : "اربط الفرع بعلامته التجارية أولاً."
            }
            action={
              !branches.length ? (
                <button className="secondary" onClick={onDirectory}>
                  العلامات والفروع
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="qr-branch-list">
            {visible.map((b) => {
              const codes = qrs.filter((q) => q.branchId === b.id),
                active = codes.filter((q) => q.active);
              return (
                <article className="qr-branch-item" key={b.id}>
                  <img
                    className="qr-brand-logo"
                    src={"/logos/" + b.brand.logo}
                    alt={b.brand.name}
                  />
                  <div className="qr-branch-info">
                    <small>{b.brand.name}</small>
                    <h3>{b.name}</h3>
                    <p>
                      <MapPin size={13} />
                      {b.city}
                      <span dir="ltr">{b.code}</span>
                    </p>
                  </div>
                  <div className="qr-branch-status">
                    <span className={"badge " + (b.active && active.length ? "green" : "neutral")}>
                      {!b.active
                        ? "الفرع غير نشط"
                        : active.length
                          ? "رمز الاستلام نشط"
                          : "يحتاج رمزاً"}
                    </span>
                    <small>{n(codes.reduce((s, q) => s + q.scans, 0))} فتح للنموذج</small>
                  </div>
                  <button className="secondary" onClick={() => setSelected(b.id)}>
                    <QrCode size={17} />
                    {active.length ? "إدارة الرمز" : b.active ? "إنشاء رمز" : "عرض السجل"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
      {choosing && (
        <Modal title="اختيار الفرع" onClose={() => setChoosing(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSelected(branchId);
              setChoosing(false);
            }}
          >
            <Field label="الفرع والعلامة">
              <select required value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.brand.name} — {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </Field>
            <Submit busy={false}>متابعة</Submit>
          </form>
        </Modal>
      )}
      {selectedBranch && (
        <QRPanel
          key={selectedBranch.id}
          branch={selectedBranch}
          brand={selectedBranch.brand}
          onClose={() => {
            setSelected("");
            void load();
          }}
        />
      )}
    </>
  );
}
export function QRPanel({
  branch,
  brand,
  onClose,
}: {
  branch: Branch;
  brand: Brand;
  onClose: () => void;
}) {
  const [qrs, setQrs] = useState<BranchQR[]>([]),
    [loading, setLoading] = useState(true),
    [preview, setPreview] = useState<{
      id: string;
      url: string;
      img: string;
      placement: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [codeStatus, setCodeStatus] = useState("active"),
    [confirmation, setConfirmation] = useState<{
      qr: BranchQR;
      action: "rotate" | "revoke";
    } | null>(null);
  const load = useCallback(async () => {
    try {
      setQrs((await api<BranchQR[]>("qrs")).filter((q) => q.branchId === branch.id));
    } finally {
      setLoading(false);
    }
  }, [branch.id]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  async function show(id: string, url: string, placement: string) {
    const img = await QRCode.toDataURL(url, { width: 1000, margin: 4, errorCorrectionLevel: "M" });
    setPreview({ id, url, img, placement });
    setCodeStatus("active");
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const placement = "استلام الطلبات";
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ id: string; url: string }>("qrs", {
        branchId: branch.id,
      });
      await show(result.id, result.url, placement);
      await load();
      setNotice("تم إنشاء الرمز. يمكنك العودة إليه وتنزيله في أي وقت.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(qr: BranchQR) {
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);
    try {
      const result = await api<{ url: string }>(`qrs/${qr.id}/link`);
      await show(qr.id, result.url, "استلام الطلبات");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!confirmation) return;
    const { qr, action } = confirmation;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ id?: string; url?: string }>(`qrs/${qr.id}/${action}`, {});
      setPreview(null);
      setConfirmation(null);
      if (result.id && result.url) await show(result.id, result.url, "استلام الطلبات");
      await load();
      setNotice(
        action === "rotate"
          ? "تم استبدال الرمز. اطبع الرمز الجديد؛ الرمز السابق لم يعد يستقبل شكاوى."
          : "تم إيقاف الرمز. الشكاوى السابقة محفوظة.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(preview!.url);
      setNotice("تم نسخ رابط نموذج العميل");
    } catch {
      setError("تعذر النسخ؛ يمكنك تحديد الرابط ونسخه يدوياً.");
    }
  }
  return (
    <Modal title={"رمز QR — " + branch.name} onClose={onClose} wide>
      <div className="qr-context">
        <img src={"/logos/" + brand.logo} alt={brand.name} />
        <div>
          <b>
            {brand.name} — {branch.name}
          </b>
          <small>
            {branch.city} · <span dir="ltr">{branch.code}</span>
          </small>
        </div>
      </div>
      {!branch.active && <p className="notice">الفرع غير نشط، ونماذجه لا تستقبل شكاوى جديدة.</p>}
      <div className="qr-pickup-note">
        <QrCode size={22} />
        <div>
          <b>استلام الطلبات</b>
        </div>
      </div>
      {branch.active && !loading && !error && !qrs.some((q) => q.active) && (
        <form className="qr-create-form" onSubmit={create}>
          <Submit busy={busy}>إنشاء رمز الفرع</Submit>
        </form>
      )}
      {error && (
        <p className="error qr-feedback" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="qr-feedback" role="status">
          {notice}
        </p>
      )}
      {confirmation && (
        <div className="qr-confirm" role="group" aria-label="تأكيد تغيير الرمز">
          <b>
            {confirmation.action === "rotate" ? "استبدال الرمز؟" : "إيقاف الرمز؟"} — {branch.name}
          </b>
          <p>
            {confirmation.action === "rotate"
              ? "سيتوقف الرابط القديم فوراً. ستحتاج إلى طباعة الرمز الجديد ووضعه في الفرع."
              : "لن يستقبل هذا الرمز شكاوى جديدة. ستبقى الشكاوى السابقة محفوظة."}
          </p>
          <div className="poster-actions">
            <button className="primary" disabled={busy} onClick={confirm}>
              {confirmation.action === "rotate" ? "تأكيد الاستبدال" : "تأكيد الإيقاف"}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              تراجع
            </button>
          </div>
        </div>
      )}
      {preview && (
        <div className="qr-poster">
          <img className="poster-logo" src={"/logos/" + brand.logo} alt={brand.name} />
          <h2>شاركنا ملاحظتك</h2>
          <p>
            {brand.name} — {branch.name}
          </p>
          <img src={preview.img} alt={"رمز شكوى " + branch.name + " — " + preview.placement} />
          <p>امسح الرمز لإرسال شكوى لفريق خدمة العملاء</p>
          <small>{preview.placement}</small>
          <div className="poster-actions">
            <a className="primary" href={preview.url} target="_blank" rel="noreferrer">
              معاينة نموذج العميل
              <ExternalLink size={16} />
            </a>
            <a
              className="secondary"
              href={preview.img}
              download={"qr-" + branch.code + "-" + preview.id + ".png"}
            >
              <Download size={16} />
              تنزيل PNG
            </a>
            <button className="secondary" onClick={copy}>
              <Copy size={16} />
              نسخ الرابط
            </button>
            <button className="secondary" onClick={() => window.print()}>
              <Printer size={16} />
              طباعة الملصق
            </button>
          </div>
          <input
            className="qr-link"
            aria-label="رابط نموذج العميل"
            readOnly
            dir="ltr"
            value={preview.url}
          />
        </div>
      )}
      <div className="qr-list">
        <div className="qr-list-heading">
          <h3>رمز الفرع والسجل السابق</h3>
          <select
            aria-label="حالة الرموز"
            value={codeStatus}
            onChange={(e) => setCodeStatus(e.target.value)}
          >
            <option value="active">النشطة ({n(qrs.filter((q) => q.active).length)})</option>
            <option value="stopped">المتوقفة ({n(qrs.filter((q) => !q.active).length)})</option>
            <option value="all">جميع الرموز</option>
          </select>
        </div>
        {loading ? (
          <p role="status">جارٍ تحميل الرموز…</p>
        ) : !qrs.length ? (
          <Empty
            title="لم يُنشأ رمز لهذا الفرع"
            detail="أنشئ رمز استلام الطلبات باستخدام الزر أعلاه."
          />
        ) : !qrs.some(
            (q) => codeStatus === "all" || (codeStatus === "active" ? q.active : !q.active),
          ) ? (
          <Empty title="لا توجد رموز في هذه الحالة" detail="اختر حالة أخرى لعرض الرموز." />
        ) : (
          qrs
            .filter((q) => codeStatus === "all" || (codeStatus === "active" ? q.active : !q.active))
            .map((q) => (
              <div className="qr-row" key={q.id}>
                <span>
                  <b>{q.active ? "رمز استلام الطلبات" : "رمز سابق"}</b>
                  {q.active && !q.reusable && (
                    <small>رمز قديم؛ استبدله لتتمكن من إعادة تنزيله</small>
                  )}
                  <small>
                    {q.active ? (branch.active ? "نشط" : "متوقف مع الفرع") : "متوقف"} · {n(q.scans)}{" "}
                    فتح للنموذج
                  </small>
                  <small>
                    أُنشئ {date(q.createdAt)}
                    {q.revokedAt && " · أُوقف " + date(q.revokedAt)}
                  </small>
                </span>
                {q.active && (
                  <div className="qr-row-actions">
                    {branch.active && (
                      <>
                        {q.reusable && (
                          <button className="secondary" disabled={busy} onClick={() => open(q)}>
                            عرض وتنزيل
                          </button>
                        )}
                        <button
                          className="text-btn"
                          disabled={busy}
                          onClick={() => setConfirmation({ qr: q, action: "rotate" })}
                        >
                          استبدال
                        </button>
                      </>
                    )}
                    <button
                      className="text-btn danger"
                      disabled={busy}
                      onClick={() => setConfirmation({ qr: q, action: "revoke" })}
                    >
                      إيقاف
                    </button>
                  </div>
                )}
              </div>
            ))
        )}
      </div>
    </Modal>
  );
}
