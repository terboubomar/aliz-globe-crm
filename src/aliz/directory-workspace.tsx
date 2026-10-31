import { useState, FormEvent } from "react";
import {
  Building2,
  MapPin,
  Plus,
  Pencil,
  Link2,
  QrCode,
  ArrowLeft,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { Data, Brand, Branch, n } from "./types";
import { Modal, Field, Submit, Empty } from "./ui";
type Mutation = (path: string, body?: unknown) => Promise<unknown>;
const parse = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
};
export function DirectoryWorkspace({
  data,
  brand,
  mutate,
  busy,
  onQR,
}: {
  data: Data;
  brand: string;
  mutate: Mutation;
  busy: boolean;
  onQR: (id: string) => void;
}) {
  const [tab, setTab] = useState("brands"),
    [selectedBrandId, setSelectedBrandId] = useState<string | null>(null),
    [editingBrand, setBrand] = useState<Brand | null | undefined>(),
    [editingBranch, setBranch] = useState<Branch | null | undefined>(),
    [newBranchBrand, setNewBranchBrand] = useState(""),
    [saved, setSaved] = useState(""),
    [deleting, setDeleting] = useState<{
      kind: "brand" | "branch";
      id: string;
      name: string;
    } | null>(null),
    [confirmName, setConfirmName] = useState(""),
    [error, setError] = useState("");
  const [statusChange, setStatusChange] = useState<{
    kind: "brand" | "branch";
    id: string;
    name: string;
    active: boolean;
  } | null>(null);
  const canActivate = data.permissions.includes("directory.activate");
  const permit = data.permissions.includes("configure"),
    manageBrands = data.permissions.includes("brands.manage"),
    manageBranches = data.permissions.includes("branches.manage"),
    brands = data.brands.filter((b) => brand === "all" || b.id === brand),
    selectedBrand = brands.find((b) => b.id === selectedBrandId),
    branches = brands.flatMap((b) => b.branches.map((branch) => ({ ...branch, brand: b }))),
    visibleBranches = selectedBrand
      ? branches.filter((b) => b.brandId === selectedBrand.id)
      : branches;
  return (
    <>
      <div className="directory-overview">
        <div>
          <Building2 size={24} />
          <b>{n(brands.length)}</b>
          <span>علامة تجارية</span>
        </div>
        <span className="directory-link">
          <Link2 size={23} />
          <small>العلامات والفروع</small>
        </span>
        <div>
          <MapPin size={24} />
          <b>{n(branches.length)}</b>
          <span>فرع مسجل</span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>العلامات التجارية والفروع</h2>
          </div>
          {(manageBrands || manageBranches) && (
            <div className="table-tools">
              {manageBrands && (
                <button
                  className="secondary"
                  onClick={() => {
                    setError("");
                    setBrand(null);
                  }}
                >
                  <Plus size={16} />
                  إضافة علامة
                </button>
              )}
              {manageBranches && (
                <button
                  className="primary"
                  onClick={() => {
                    setError("");
                    setSaved("");
                    setNewBranchBrand(selectedBrand?.id ?? (brand === "all" ? "" : brand));
                    setBranch(null);
                  }}
                >
                  <Plus size={16} />
                  إضافة فرع
                </button>
              )}
            </div>
          )}
        </div>
        {saved && (
          <p className="notice" role="status">
            {saved}
          </p>
        )}
        <div className="queue-tabs">
          <button
            className={tab === "brands" ? "current" : ""}
            onClick={() => {
              setTab("brands");
              setSelectedBrandId(null);
            }}
          >
            العلامات التجارية
          </button>
          <button
            className={tab === "branches" ? "current" : ""}
            onClick={() => {
              setTab("branches");
              setSelectedBrandId(null);
            }}
          >
            الفروع والربط
          </button>
        </div>
        {tab === "branches" && selectedBrand && (
          <div className="directory-brand-heading">
            <button
              className="text-btn"
              onClick={() => {
                setTab("brands");
                setSelectedBrandId(null);
              }}
            >
              <ArrowRight size={16} />
              العودة للعلامات
            </button>
            <h3>
              فروع {selectedBrand.name}{" "}
              <span className="count-badge">{n(visibleBranches.length)}</span>
            </h3>
          </div>
        )}
        {tab === "brands" ? (
          <div className="brand-directory-grid">
            {brands.map((b) => (
              <article className="brand-directory-card" key={b.id}>
                <button
                  type="button"
                  className="brand-directory-open"
                  aria-label={`عرض فروع ${b.name}`}
                  onClick={() => {
                    setSelectedBrandId(b.id);
                    setTab("branches");
                    setSaved("");
                  }}
                >
                  <header>
                    <img src={"/logos/" + b.logo} alt={b.name} />
                    <span className="badge">{b.status === "ACTIVE" ? "نشطة" : "مسودة"}</span>
                  </header>
                  <h3>{b.name}</h3>
                  <p>{b.nameEn}</p>
                  <span className="branch-total">
                    <MapPin size={15} />
                    {n(b.branches.length)} فروع مرتبطة
                  </span>
                  <span className="brand-view-branches">
                    عرض الفروع <ArrowLeft size={16} />
                  </span>
                </button>
                {manageBrands && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setError("");
                      setBrand(b);
                    }}
                  >
                    <Pencil size={15} />
                    تعديل العلامة
                  </button>
                )}
                {manageBrands && (
                  <button
                    className="text-btn directory-delete"
                    aria-label={`حذف العلامة ${b.name}`}
                    onClick={() => {
                      setError("");
                      setConfirmName("");
                      setDeleting({ kind: "brand", id: b.id, name: b.name });
                    }}
                  >
                    <Trash2 size={15} />
                    حذف العلامة
                  </button>
                )}
                {canActivate && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setError("");
                      setStatusChange({
                        kind: "brand",
                        id: b.id,
                        name: b.name,
                        active: b.status === "ACTIVE",
                      });
                    }}
                  >
                    {b.status === "ACTIVE" ? "تعليق العلامة" : "تفعيل العلامة"}
                  </button>
                )}
                {manageBranches && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setError("");
                      setSaved("");
                      setNewBranchBrand(b.id);
                      setBranch(null);
                    }}
                  >
                    <Plus size={15} />
                    إضافة فرع لهذه العلامة
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : visibleBranches.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>اسم الفرع</th>
                  <th>العلامة المرتبطة</th>
                  <th>رمز الفرع</th>
                  <th>المدينة</th>
                  <th>الحالة</th>
                  <th>الربط والإدارة</th>
                </tr>
              </thead>
              <tbody>
                {visibleBranches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <b>{b.name}</b>
                    </td>
                    <td>
                      <div className="table-brand">
                        <img src={"/logos/" + b.brand.logo} alt="" />
                        <b>{b.brand.name}</b>
                      </div>
                    </td>
                    <td dir="ltr">{b.code}</td>
                    <td>
                      <div className="branch-location-cell">
                        <b>
                          {b.city}
                          {b.district ? `، ${b.district}` : ""}
                        </b>
                        {b.address && <small>{b.address}</small>}
                        {(b.mapsUrl || (b.latitude != null && b.longitude != null)) && (
                          <a
                            href={
                              b.mapsUrl ||
                              `https://www.google.com/maps/search/?api=1&query=${b.latitude},${b.longitude}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <MapPin size={14} /> عرض الموقع
                          </a>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="badge">
                        {b.demo ? "تجريبي • " : ""}
                        {b.active ? "نشط" : "مسودة / معلق"}
                      </span>
                    </td>
                    <td>
                      <div className="table-tools">
                        {canActivate && (
                          <button
                            className="text-btn"
                            onClick={() => {
                              setError("");
                              setStatusChange({
                                kind: "branch",
                                id: b.id,
                                name: b.name,
                                active: b.active,
                              });
                            }}
                          >
                            {b.active ? "تعليق الفرع" : "تفعيل الفرع"}
                          </button>
                        )}
                        {manageBranches && (
                          <>
                            <button
                              className="text-btn"
                              onClick={() => {
                                setError("");
                                setBranch(b);
                              }}
                            >
                              <Link2 size={15} />
                              تعديل / ربط العلامة
                            </button>
                            <button
                              className="text-btn directory-delete"
                              aria-label={`حذف الفرع ${b.name}`}
                              onClick={() => {
                                setError("");
                                setConfirmName("");
                                setDeleting({ kind: "branch", id: b.id, name: b.name });
                              }}
                            >
                              <Trash2 size={15} />
                              حذف الفرع
                            </button>
                            {permit && (
                              <button className="text-btn" onClick={() => onQR(b.id)}>
                                <QrCode size={15} />
                                QR
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="لا توجد فروع لهذه العلامة" detail="أضف فرعاً واربطه بالعلامة التجارية." />
        )}
      </section>
      {statusChange && (
        <Modal
          title={statusChange.active ? "تعليق النشاط" : "تفعيل النشاط"}
          onClose={() => setStatusChange(null)}
        >
          <div className="padded">
            <h3>{statusChange.name}</h3>
            <p>
              {statusChange.active
                ? "سيتم إيقاف استقبال الشكاوى لهذا السجل. تبقى السجلات السابقة محفوظة."
                : "تأكيد اعتماد بيانات السجل وتفعيل استقبال الشكاوى."}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="poster-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  try {
                    await mutate(
                      `${statusChange.kind === "brand" ? "brands" : "branches"}/${statusChange.id}/status`,
                      { active: !statusChange.active, expectedActive: statusChange.active },
                    );
                    setStatusChange(null);
                    setSaved("تم تحديث حالة النشاط");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                تأكيد
              </button>
              <button className="secondary" disabled={busy} onClick={() => setStatusChange(null)}>
                تراجع
              </button>
            </div>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal
          title={deleting.kind === "brand" ? "حذف العلامة التجارية" : "حذف الفرع"}
          onClose={() => setDeleting(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (confirmName !== deleting.name) return;
              setError("");
              try {
                await mutate(
                  `${deleting.kind === "brand" ? "brands" : "branches"}/${deleting.id}/delete`,
                  { name: deleting.name },
                );
                setSaved(`تم حذف «${deleting.name}».`);
                if (deleting.kind === "brand") {
                  setSelectedBrandId(null);
                  setTab("brands");
                }
                setDeleting(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <p>حذف «{deleting.name}» نهائي ولا يمكن التراجع عنه.</p>
            <p className="hint">
              لا يمكن حذف سجل له فروع أو شكاوى أو طلبات مالية أو رموز QR مرتبطة.
            </p>
            <Field label="اكتب الاسم للتأكيد" full>
              <input
                aria-label="اكتب الاسم للتأكيد"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                required
                autoComplete="off"
              />
            </Field>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="table-tools directory-delete-actions">
              <button
                type="submit"
                className="primary"
                disabled={busy || confirmName !== deleting.name}
              >
                {busy ? "جارٍ الحذف…" : "تأكيد الحذف"}
              </button>
              <button type="button" className="secondary" onClick={() => setDeleting(null)}>
                إلغاء
              </button>
            </div>
          </form>
        </Modal>
      )}
      {editingBrand !== undefined && (
        <Modal
          title={editingBrand ? "تعديل العلامة التجارية" : "إضافة علامة تجارية"}
          onClose={() => setBrand(undefined)}
        >
          <form
            onSubmit={async (e) => {
              const b = parse(e);
              try {
                await mutate(editingBrand ? "brands/" + editingBrand.id : "brands", b);
                setBrand(undefined);
                setSaved(`تم حفظ العلامة «${b["name"]}».`);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <div className="form-grid">
              <Field label="الاسم بالعربية">
                <input
                  name="name"
                  defaultValue={editingBrand?.name}
                  required
                  minLength={2}
                  maxLength={100}
                />
              </Field>
              <Field label="الاسم بالإنجليزية (اختياري)">
                <input name="nameEn" defaultValue={editingBrand?.nameEn} maxLength={100} />
              </Field>
              {!editingBrand && (
                <Field label="رمز العلامة (حروف إنجليزية صغيرة)">
                  <input
                    name="code"
                    dir="ltr"
                    required
                    pattern="[a-z][a-z0-9-]{1,29}"
                    placeholder="brand-code"
                  />
                </Field>
              )}
              <Field label="لون العلامة">
                <input name="color" type="color" defaultValue={editingBrand?.color ?? "#B62E30"} />
              </Field>
              <Field label="الشعار المعتمد" full>
                <select name="logo" defaultValue={editingBrand?.logo ?? "neutral.svg"}>
                  <option value="neutral.svg">رمز محايد حتى توفير الشعار</option>
                  <option value="waqf.jpeg">واقف — الشعار المرفق</option>
                  <option value="kabab.png">كباب علوم — الشعار المرفق</option>
                  <option value="batatisyon.jpeg">بطاطسيون — الشعار المرفق</option>
                  <option value="mazmuzil.webp">مزمزيل — الشعار المرفق</option>
                </select>
              </Field>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Submit busy={busy}>حفظ العلامة</Submit>
          </form>
        </Modal>
      )}
      {editingBranch !== undefined && (
        <Modal
          wide
          title={editingBranch ? "تعديل بيانات الفرع" : "إضافة فرع جديد"}
          onClose={() => setBranch(undefined)}
        >
          <form
            className="branch-editor"
            onSubmit={async (e) => {
              const b = parse(e);
              setError("");
              if (Boolean(b["latitude"]) !== Boolean(b["longitude"])) {
                setError("أدخل خط العرض وخط الطول معاً، أو اتركهما فارغين.");
                return;
              }
              try {
                await mutate(editingBranch ? "branches/" + editingBranch.id : "branches", {
                  ...b,
                  ...(editingBranch && canActivate ? { active: b["active"] === "on" } : {}),
                });
                setBranch(undefined);
                setTab("branches");
                setSelectedBrandId(b["brandId"] ?? null);
                setSaved(
                  `تم حفظ الفرع «${b["name"]}» وربطه بعلامة «${data.brands.find((x) => x.id === b["brandId"])?.name ?? ""}».`,
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <section className="branch-form-section" aria-labelledby="branch-info-title">
              <h3 id="branch-info-title">
                <Building2 size={19} /> بيانات الفرع
              </h3>
              <div className="form-grid">
                <Field label="العلامة المرتبطة بالفرع">
                  <select
                    name="brandId"
                    aria-label="العلامة المرتبطة بالفرع"
                    defaultValue={editingBranch?.brandId ?? newBranchBrand}
                    required
                  >
                    <option value="">اختر العلامة التجارية</option>
                    {(editingBranch ? data.brands : brands).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="اسم الفرع">
                  <input
                    name="name"
                    defaultValue={editingBranch?.name}
                    required
                    minLength={2}
                    maxLength={100}
                    placeholder="مثال: فرع الملقا"
                  />
                </Field>
                <Field label="رمز الفرع">
                  <input
                    name="code"
                    dir="ltr"
                    required
                    pattern="[A-Z0-9_-]{2,30}"
                    defaultValue={editingBranch?.code}
                    placeholder="RIY-01"
                  />
                </Field>
              </div>
            </section>
            <section className="branch-form-section" aria-labelledby="branch-location-title">
              <h3 id="branch-location-title">
                <MapPin size={19} /> موقع الفرع
              </h3>

              <div className="form-grid">
                <Field label="المدينة">
                  <input
                    name="city"
                    defaultValue={editingBranch?.city}
                    required
                    minLength={2}
                    maxLength={80}
                  />
                </Field>
                <Field label="الحي (اختياري)">
                  <input
                    name="district"
                    defaultValue={editingBranch?.district ?? ""}
                    placeholder="مثال: حي الملقا"
                    maxLength={100}
                  />
                </Field>
                <Field label="العنوان التفصيلي (اختياري)" full>
                  <textarea
                    name="address"
                    defaultValue={editingBranch?.address ?? ""}
                    placeholder="اسم الشارع، رقم المبنى، وأقرب معلم"
                    maxLength={300}
                    rows={2}
                  />
                </Field>
                <Field label="رابط الموقع على الخريطة (اختياري)" full>
                  <input
                    name="mapsUrl"
                    type="url"
                    dir="ltr"
                    defaultValue={editingBranch?.mapsUrl ?? ""}
                    placeholder="https://maps.google.com/…"
                    pattern="https://.*"
                    maxLength={2000}
                  />
                </Field>
                <Field label="خط العرض (اختياري)">
                  <input
                    name="latitude"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    dir="ltr"
                    defaultValue={editingBranch?.latitude ?? ""}
                    placeholder="24.7136"
                  />
                </Field>
                <Field label="خط الطول (اختياري)">
                  <input
                    name="longitude"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    dir="ltr"
                    defaultValue={editingBranch?.longitude ?? ""}
                    placeholder="46.6753"
                  />
                </Field>
              </div>
            </section>
            <section className="branch-form-section" aria-labelledby="branch-contact-title">
              <h3 id="branch-contact-title">التواصل والحالة</h3>
              <div className="form-grid">
                <Field label="هاتف الفرع (اختياري)">
                  <input
                    name="phone"
                    type="tel"
                    dir="ltr"
                    defaultValue={editingBranch?.phone ?? ""}
                    placeholder="+966…"
                    maxLength={25}
                  />
                </Field>
                {editingBranch && canActivate && (
                  <label className="checkbox">
                    <input name="active" type="checkbox" defaultChecked={editingBranch.active} />
                    الفرع نشط
                  </label>
                )}
              </div>
            </section>
            {editingBranch && (
              <p className="hint">
                لا يمكن تغيير علامة فرع مرتبط بشكاوى أو طلبات مالية أو رموز QR.
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="branch-form-footer">
              <div className="table-tools">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setBranch(undefined)}
                  disabled={busy}
                >
                  إلغاء
                </button>
                <Submit busy={busy}>{editingBranch ? "حفظ التغييرات" : "إضافة الفرع"}</Submit>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
