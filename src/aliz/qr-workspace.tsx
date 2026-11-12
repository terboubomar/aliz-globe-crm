import { hasFullAccess } from "@/lib/domain";
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
  branchId: string | null;
  brandId: string | null;
  placement: string;
  active: boolean;
  scans: number;
  createdAt: string;
  revokedAt: string | null;
  reusable: boolean;
};
/** What a QR code opens: a brand's form (one per brand) or, for older codes, one branch's form. */
export type QRTarget = {
  kind: "brand" | "branch";
  id: string;
  title: string;
  subtitle: string;
  fileName: string;
  active: boolean;
};
export function QRWorkspace({
  data,
  brand,
  onDirectory,
  onSettings,
}: {
  data: Data;
  brand: string;
  onDirectory: () => void;
  onSettings?: (() => void) | undefined;
}) {
  const [qrs, setQrs] = useState<BranchQR[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<{ target: QRTarget; brand: Brand } | null>(null);
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
  const brands = data.brands.filter((b) => brand === "all" || b.id === brand);
  // Older per-branch codes still work until they are stopped.
  const branchCodes = brands.flatMap((b) =>
    b.branches
      .filter((br) => qrs.some((q) => q.branchId === br.id && q.active))
      .map((br) => ({ ...br, brand: b })),
  );
  const brandTarget = (b: Brand): QRTarget => ({
    kind: "brand",
    id: b.id,
    title: b.name,
    subtitle: `${n(b.branches.filter((x) => x.active).length)} فرع نشط · يختار العميل المنطقة والمدينة والفرع`,
    fileName: b.id,
    active: b.status === "ACTIVE",
  });
  const ready = brands.filter((b) => qrs.some((q) => q.brandId === b.id && q.active)).length;
  if (!permitted)
    return (
      <section className="panel">
        <Empty
          title="إدارة رموز QR متاحة لمسؤول النظام"
          detail="تواصل مع المسؤول لإنشاء رمز أو تحديثه لعلامتك."
        />
      </section>
    );
  return (
    <>
      {!data.policy.publicIntake && (
        <div className="notice qr-intake-off" role="status">
          <span>
            استقبال شكاوى العملاء متوقف: الرموز تعمل، لكن النموذج يعرض «الرابط غير متاح» حتى يفعّله
            المسؤول الأعلى من الإعدادات.
          </span>
          {hasFullAccess(data.me.role) && onSettings && (
            <button className="text-btn" onClick={onSettings}>
              فتح الإعدادات
            </button>
          )}
        </div>
      )}
      <section className="panel qr-workspace">
        <div className="panel-head">
          <div>
            <h2>رموز استقبال الشكاوى</h2>
            <p className="hint">رمز واحد لكل علامة؛ يختار العميل المنطقة ثم المدينة ثم الفرع.</p>
          </div>
          <button className="secondary" disabled={loading} onClick={load}>
            <RefreshCw size={16} />
            تحديث الرموز
          </button>
        </div>
        <div className="qr-summary" aria-label="ملخص رموز العلامات">
          <span>
            <b>{n(ready)}</b> علامات برموز نشطة
          </span>
          <span>
            <b>{n(brands.length - ready)}</b> علامات تحتاج رمزاً
          </span>
          <span>
            <b>
              {n(
                qrs
                  .filter(
                    (q) =>
                      brands.some((b) => b.id === q.brandId) ||
                      branchCodes.some((b) => b.id === q.branchId),
                  )
                  .reduce((s, q) => s + q.scans, 0),
              )}
            </b>{" "}
            فتح لنماذج العملاء
          </span>
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
        ) : !brands.length ? (
          <Empty
            title="أضف علامة تجارية لإنشاء رمزها"
            action={
              <button className="secondary" onClick={onDirectory}>
                العلامات والفروع
              </button>
            }
          />
        ) : (
          <div className="qr-branch-list">
            {brands.map((b) => {
              const codes = qrs.filter((q) => q.brandId === b.id),
                active = codes.filter((q) => q.active),
                liveBranches = b.branches.filter((x) => x.active),
                noRegion = liveBranches.filter((x) => !x.region).length;
              return (
                <article className="qr-branch-item" key={b.id}>
                  <img className="qr-brand-logo" src={"/logos/" + b.logo} alt={b.name} />
                  <div className="qr-branch-info">
                    <small>رمز العلامة</small>
                    <h3>{b.name}</h3>
                    <p>
                      <MapPin size={13} />
                      {n(liveBranches.length)} فرع نشط
                      {noRegion > 0 && <span className="warn"> · {n(noRegion)} بدون منطقة</span>}
                    </p>
                  </div>
                  <div className="qr-branch-status">
                    <span
                      className={
                        "badge " +
                        (b.status === "ACTIVE" && active.length && liveBranches.length
                          ? "green"
                          : "neutral")
                      }
                    >
                      {b.status !== "ACTIVE"
                        ? "العلامة غير مفعلة"
                        : !liveBranches.length
                          ? "لا توجد فروع نشطة"
                          : active.length
                            ? "الرمز نشط"
                            : "يحتاج رمزاً"}
                    </span>
                    <small>{n(codes.reduce((s, q) => s + q.scans, 0))} فتح للنموذج</small>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setSelected({ target: brandTarget(b), brand: b })}
                  >
                    <QrCode size={17} />
                    {active.length ? "إدارة الرمز" : "إنشاء رمز"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
        {branchCodes.length > 0 && (
          <div className="qr-legacy">
            <h3>رموز فروع سابقة</h3>
            <p className="hint">
              ما زالت تعمل وتفتح نموذج الفرع مباشرة. أوقفها بعد تعليق رمز العلامة مكانها.
            </p>
            <div className="qr-branch-list">
              {branchCodes.map((br) => {
                const codes = qrs.filter((q) => q.branchId === br.id);
                return (
                  <article className="qr-branch-item" key={br.id}>
                    <img
                      className="qr-brand-logo"
                      src={"/logos/" + br.brand.logo}
                      alt={br.brand.name}
                    />
                    <div className="qr-branch-info">
                      <small>{br.brand.name}</small>
                      <h3>{br.name}</h3>
                      <p>
                        <MapPin size={13} />
                        {br.city}
                        <span dir="ltr">{br.code}</span>
                      </p>
                    </div>
                    <div className="qr-branch-status">
                      <span className="badge amber">رمز فرع</span>
                      <small>{n(codes.reduce((s, q) => s + q.scans, 0))} فتح للنموذج</small>
                    </div>
                    <button
                      className="secondary"
                      onClick={() =>
                        setSelected({
                          brand: br.brand,
                          target: {
                            kind: "branch",
                            id: br.id,
                            title: br.name,
                            subtitle: `${br.city} · ${br.code}`,
                            fileName: br.code,
                            active: br.active,
                          },
                        })
                      }
                    >
                      <QrCode size={17} />
                      إدارة الرمز
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>
      {selected && (
        <QRPanel
          key={selected.target.kind + selected.target.id}
          target={selected.target}
          brand={selected.brand}
          onClose={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </>
  );
}
export function QRPanel({
  target,
  brand,
  onClose,
}: {
  target: QRTarget;
  brand: Brand;
  onClose: () => void;
}) {
  const mine = (q: BranchQR) =>
    target.kind === "brand" ? q.brandId === target.id : q.branchId === target.id;
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
      setQrs((await api<BranchQR[]>("qrs")).filter(mine));
    } finally {
      setLoading(false);
    }
    // mine depends only on the target, which is fixed for this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id]);
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
    const placement = target.kind === "brand" ? "جميع الفروع" : "استلام الطلبات";
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ id: string; url: string }>(
        "qrs",
        target.kind === "brand" ? { brandId: target.id } : { branchId: target.id },
      );
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
      await show(qr.id, result.url, target.kind === "brand" ? "جميع الفروع" : "استلام الطلبات");
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
      if (result.id && result.url)
        await show(
          result.id,
          result.url,
          target.kind === "brand" ? "جميع الفروع" : "استلام الطلبات",
        );
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
    <Modal title={"رمز QR — " + target.title} onClose={onClose} wide>
      <div className="qr-context">
        <img src={"/logos/" + brand.logo} alt={brand.name} />
        <div>
          <b>{target.kind === "brand" ? brand.name : `${brand.name} — ${target.title}`}</b>
          <small>{target.subtitle}</small>
        </div>
      </div>
      {!target.active && (
        <p className="notice">
          {target.kind === "brand" ? "العلامة غير مفعلة" : "الفرع غير نشط"}، ونموذجه لا يستقبل شكاوى
          جديدة.
        </p>
      )}
      <div className="qr-pickup-note">
        <QrCode size={22} />
        <div>
          <b>{target.kind === "brand" ? "رمز واحد لجميع فروع العلامة" : "رمز فرع (سابق)"}</b>
        </div>
      </div>
      {target.active &&
        target.kind === "brand" &&
        !loading &&
        !error &&
        !qrs.some((q) => q.active) && (
          <form className="qr-create-form" onSubmit={create}>
            <Submit busy={busy}>إنشاء رمز العلامة</Submit>
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
            {confirmation.action === "rotate" ? "استبدال الرمز؟" : "إيقاف الرمز؟"} — {target.title}
          </b>
          <p>
            {confirmation.action === "rotate"
              ? "سيتوقف الرابط القديم فوراً. ستحتاج إلى طباعة الرمز الجديد ووضعه في الفروع."
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
          <p>{target.kind === "brand" ? brand.name : `${brand.name} — ${target.title}`}</p>
          <img src={preview.img} alt={"رمز شكوى " + target.title + " — " + preview.placement} />
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
              download={"qr-" + target.fileName + "-" + preview.id + ".png"}
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
          <h3>
            {target.kind === "brand" ? "رمز العلامة والسجل السابق" : "رمز الفرع والسجل السابق"}
          </h3>
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
            title={target.kind === "brand" ? "لم يُنشأ رمز لهذه العلامة" : "لا يوجد رمز لهذا الفرع"}
            detail={target.kind === "brand" ? "أنشئ رمز العلامة باستخدام الزر أعلاه." : ""}
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
                  <b>
                    {q.active
                      ? target.kind === "brand"
                        ? "رمز العلامة"
                        : "رمز الفرع"
                      : "رمز سابق"}
                  </b>
                  {q.active && !q.reusable && (
                    <small>رمز قديم؛ استبدله لتتمكن من إعادة تنزيله</small>
                  )}
                  <small>
                    {q.active ? (target.active ? "نشط" : "متوقف") : "متوقف"} · {n(q.scans)} فتح
                    للنموذج
                  </small>
                  <small>
                    أُنشئ {date(q.createdAt)}
                    {q.revokedAt && " · أُوقف " + date(q.revokedAt)}
                  </small>
                </span>
                {q.active && (
                  <div className="qr-row-actions">
                    {target.active && (
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
