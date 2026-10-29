import { FormEvent, useCallback, useEffect, useState } from "react";
import { Plus, Search, Pencil, ShieldCheck, Users, RefreshCw } from "lucide-react";
import { Data, api, n, roleNames } from "./types";
import { Field, Empty, Modal, Submit } from "./ui";
import { permissionLabels, roleDescriptions } from "./access";
type ManagedUser = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  financeDuty?: string;
  brandIds: string[];
  branchIds: string[];
  enabled: boolean;
  version: number;
  loginType: "password" | "oidc" | "none";
  subject: string | null;
};
type UserDirectory = {
  users: ManagedUser[];
  roles: { id: string; permissions: string[] }[];
  financeDuties?: { id: string; permissions: string[] }[];
  passwordLogin: boolean;
};
export function UsersWorkspace({
  data,
  onChanged,
  brand,
}: {
  data: Data;
  brand: string;
  onChanged: () => Promise<void>;
}) {
  const [directory, setDirectory] = useState<UserDirectory | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [role, setRole] = useState("all"),
    [tab, setTab] = useState("users"),
    [editing, setEditing] = useState<ManagedUser | null | undefined>(),
    [confirmation, setConfirmation] = useState<ManagedUser | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const permitted = data.permissions.includes("users.manage");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDirectory(await api<UserDirectory>("users"));
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
  if (!permitted)
    return (
      <section className="panel">
        <Empty title="إدارة المستخدمين متاحة للمسؤول الأعلى فقط" />
      </section>
    );
  const users =
    directory?.users?.filter(
      (u) =>
        (brand === "all" || u.role === "SUPER_ADMIN" || u.brandIds.includes(brand)) &&
        (role === "all" || u.role === role) &&
        (!search ||
          [u.name, u.email, roleNames[u.role]]
            .join(" ")
            .toLowerCase()
            .includes(search.trim().toLowerCase())),
    ) ?? [];
  async function changeStatus() {
    if (!confirmation) return;
    setBusy(true);
    setError("");
    try {
      await api(`users/${confirmation.id}/status`, {
        enabled: !confirmation.enabled,
        version: confirmation.version,
      });
      setNotice(confirmation.enabled ? "تم إيقاف الحساب وإنهاء جلساته السابقة" : "تم تفعيل الحساب");
      setConfirmation(null);
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel users-workspace">
        <div className="panel-head">
          <div>
            <h2>المستخدمون والصلاحيات</h2>
          </div>
          <button
            className="primary"
            disabled={!directory || loading}
            onClick={() => {
              setError("");
              setEditing(null);
            }}
          >
            <Plus size={17} />
            إضافة مستخدم
          </button>
        </div>
        <div className="queue-tabs">
          <button className={tab === "users" ? "current" : ""} onClick={() => setTab("users")}>
            <Users size={16} />
            المستخدمون {directory && n((directory.users?.length ?? 0))}
          </button>
          <button className={tab === "roles" ? "current" : ""} onClick={() => setTab("roles")}>
            <ShieldCheck size={16} />
            الأدوار والصلاحيات
          </button>
        </div>
        {error && (
          <div className="padded" role="alert">
            <p className="error">{error}</p>
            <button className="secondary" onClick={load}>
              تحديث القائمة
            </button>
          </div>
        )}
        {notice && (
          <p className="users-notice" role="status">
            {notice}
          </p>
        )}
        {loading && !directory ? (
          <p className="padded" role="status">
            جارٍ تحميل المستخدمين…
          </p>
        ) : directory && tab === "users" ? (
          <>
            <div className="qr-controls">
              <label className="qr-search">
                <Search size={18} />
                <input
                  aria-label="البحث عن مستخدم"
                  placeholder="ابحث بالاسم أو البريد الإلكتروني"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <select
                aria-label="تصفية المستخدمين حسب الدور"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="all">جميع الأدوار</option>
                {(directory.roles ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleNames[r.id] ?? r.id}
                  </option>
                ))}
              </select>
              <button className="secondary" disabled={loading} onClick={load}>
                <RefreshCw size={16} />
                تحديث
              </button>
            </div>
            {!users.length ? (
              <Empty title="لا يوجد مستخدمون مطابقون" detail="غيّر البحث أو الدور المحدد." />
            ) : (
              <div className="users-table-scroll">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>المستخدم</th>
                      <th>الدور</th>
                      <th>نطاق الوصول</th>
                      <th>الحالة</th>
                      <th>الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <b>{u.name}</b>
                          <small dir="ltr">{u.email ?? "لم يُضف بريد إلكتروني"}</small>
                          {u.id === data.me.id && <small>حسابك الحالي</small>}
                        </td>
                        <td>{roleNames[u.role] ?? u.role}</td>
                        <td>
                          {u.role === "SUPER_ADMIN" ? (
                            <span>جميع العلامات والفروع</span>
                          ) : (
                            <>
                              <span>
                                {u.brandIds
                                  .map(
                                    (id) =>
                                      data.brands.find((b) => b.id === id)?.name ??
                                      "علامة غير متاحة",
                                  )
                                  .join("، ") || "دون علامات"}
                              </span>
                              <small>
                                {u.branchIds.length
                                  ? u.branchIds
                                      .map(
                                        (id) =>
                                          data.brands
                                            .flatMap((b) => b.branches)
                                            .find((b) => b.id === id)?.name ?? "فرع غير متاح",
                                      )
                                      .join("، ")
                                  : "جميع فروع العلامات المحددة"}
                              </small>
                            </>
                          )}
                        </td>
                        <td>
                          <span className={"badge " + (u.enabled ? "green" : "neutral")}>
                            {u.enabled ? "نشط" : "موقوف"}
                          </span>
                          {(directory.passwordLogin
                            ? u.loginType !== "password"
                            : u.loginType !== "oidc") && <small>يلزم إعداد الدخول</small>}
                        </td>
                        <td>
                          {u.id !== data.me.id ? (
                            <div className="users-actions">
                              <button
                                className="secondary"
                                onClick={() => {
                                  setError("");
                                  setEditing(u);
                                }}
                              >
                                <Pencil size={15} />
                                تعديل
                              </button>
                              <button
                                className={"text-btn " + (u.enabled ? "danger" : "")}
                                onClick={() => {
                                  setError("");
                                  setConfirmation(u);
                                }}
                              >
                                {u.enabled ? "إيقاف" : "تفعيل"}
                              </button>
                            </div>
                          ) : (
                            <span className="hint">محمي من التعديل الذاتي</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          directory && (
            <div className="roles-list">
              {(directory.roles ?? []).map((r) => (
                <article key={r.id}>
                  <h3>{roleNames[r.id] ?? r.id}</h3>
                  <p>{roleDescriptions[r.id]}</p>
                  <div className="permission-list">
                    {r.permissions.map((p) => (
                      <span key={p}>{permissionLabels[p] ?? p}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )
        )}
      </section>
      {editing !== undefined && directory && (
        <UserEditor
          key={editing?.id ?? "new"}
          user={editing}
          data={data}
          directory={directory}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            setNotice("تم حفظ المستخدم وصلاحياته");
            await load();
            await onChanged();
          }}
        />
      )}
      {confirmation && (
        <Modal
          title={confirmation.enabled ? "إيقاف المستخدم" : "تفعيل المستخدم"}
          onClose={() => !busy && setConfirmation(null)}
        >
          <div className="padded">
            <h3>{confirmation.name}</h3>
            <p>
              {confirmation.enabled
                ? "سيتوقف تسجيل الدخول فوراً وستنتهي الجلسات السابقة. ستبقى الشكاوى والمهام وسجل النشاط محفوظة."
                : "سيتمكن المستخدم من تسجيل الدخول ضمن دوره والعلامات والفروع المحددة له."}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="poster-actions">
              <button className="primary" disabled={busy} onClick={changeStatus}>
                {busy ? "جارٍ الحفظ…" : confirmation.enabled ? "تأكيد الإيقاف" : "تأكيد التفعيل"}
              </button>
              <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
                تراجع
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function UserEditor({
  user,
  data,
  directory,
  onClose,
  onSaved,
}: {
  user: ManagedUser | null;
  data: Data;
  directory: UserDirectory;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [role, setRole] = useState(user?.role ?? "AGENT"),
    [financeDuty, setFinanceDuty] = useState(user?.financeDuty ?? "NONE"),
    [brands, setBrands] = useState<string[]>(
      (user?.brandIds ?? []).filter((id) => data.brands.some((b) => b.id === id)),
    ),
    [branches, setBranches] = useState<string[]>(
      (user?.branchIds ?? []).filter((id) =>
        data.brands.some((b) => b.branches.some((branch) => branch.id === id)),
      ),
    ),
    [restricted, setRestricted] = useState(!!user?.branchIds.length),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const selectedRole = (directory.roles ?? []).find((r) => r.id === role);
  const previewPermissions = [
    ...new Set([
      ...(selectedRole?.permissions ?? []),
      ...(role === "SUPER_ADMIN"
        ? []
        : (directory.financeDuties?.find((d) => d.id === financeDuty)?.permissions ?? [])),
    ]),
  ];
  const availableBranches = data.brands
    .filter((b) => brands.includes(b.id))
    .flatMap((b) => b.branches.map((branch) => ({ ...branch, brandName: b.name })));
  function toggleBrand(id: string) {
    const next = brands.includes(id) ? brands.filter((x) => x !== id) : [...brands, id];
    setBrands(next);
    setBranches((current) =>
      current.filter((id) =>
        data.brands.some((b) => next.includes(b.id) && b.branches.some((x) => x.id === id)),
      ),
    );
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(user ? "users/" + user.id : "users", {
        name: String(f.get("name")),
        email: String(f.get("email")),
        role,
        financeDuty: role === "SUPER_ADMIN" ? "NONE" : financeDuty,
        brandIds: role === "SUPER_ADMIN" ? [] : brands,
        branchIds: role === "SUPER_ADMIN" || !restricted ? [] : branches,
        enabled: f.get("enabled") === "on",
        branchMode: role === "SUPER_ADMIN" || !restricted ? "all" : "selected",
        ...(user ? { version: user.version } : {}),
        ...(f.get("password") ? { password: String(f.get("password")) } : {}),
        ...(!directory.passwordLogin ? { subject: String(f.get("subject")) } : {}),
      });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={user ? "تعديل المستخدم والصلاحيات" : "إضافة مستخدم"}
      onClose={() => !busy && onClose()}
      wide
    >
      <form onSubmit={submit}>
        <fieldset className="user-editor-fields" disabled={busy}>
          <div className="form-grid">
            <Field label="الاسم">
              <input
                name="name"
                defaultValue={user?.name}
                required
                minLength={2}
                maxLength={100}
                autoComplete="off"
              />
            </Field>
            <Field label="البريد الإلكتروني">
              <input
                name="email"
                type="email"
                dir="ltr"
                defaultValue={user?.email ?? ""}
                required
                maxLength={254}
                autoComplete="off"
              />
            </Field>
            <Field label="الدور الوظيفي">
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  if (e.target.value === "BRANCH_MANAGER") setRestricted(true);
                }}
              >
                {(directory.roles ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleNames[r.id] ?? r.id}
                  </option>
                ))}
              </select>
            </Field>
            {role !== "SUPER_ADMIN" && (
              <Field label="المهمة المالية">
                <select
                  name="financeDuty"
                  value={financeDuty}
                  onChange={(event) => setFinanceDuty(event.target.value)}
                >
                  <option value="NONE">بدون مهمة مالية</option>
                  <option value="APPROVER">مراجعة واعتماد</option>
                  <option value="PROCESSOR">تنفيذ وإبلاغ العميل</option>
                  <option value="VERIFIER">تحقق مستقل</option>
                </select>
              </Field>
            )}
            {directory.passwordLogin ? (
              <Field label={user ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور"}>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required={!user || user.loginType !== "password"}
                  placeholder="12 حرفاً على الأقل"
                />
                <small>
                  {user
                    ? "اتركها فارغة للإبقاء على كلمة المرور الحالية."
                    : "يستخدم الموظف هذا البريد وكلمة المرور لتسجيل الدخول."}
                </small>
              </Field>
            ) : (
              <Field label="معرّف الهوية المؤسسية">
                <input
                  name="subject"
                  dir="ltr"
                  required
                  maxLength={200}
                  defaultValue={user?.subject ?? ""}
                />
                <small>معرّف sub المطابق لحساب المستخدم في نظام الهوية.</small>
              </Field>
            )}
          </div>
          <div className="user-role-preview">
            <b>{roleNames[role]}</b>
            <p>{roleDescriptions[role]}</p>
            <div className="permission-list">
              {previewPermissions.map((p) => (
                <span key={p}>{permissionLabels[p] ?? p}</span>
              ))}
            </div>
          </div>
          {role === "SUPER_ADMIN" ? (
            <div className="notice">
              هذا الدور يمنح جميع صلاحيات النظام وبيانات العملاء والوصول إلى جميع العلامات والفروع
              الحالية والمستقبلية.
            </div>
          ) : (
            <>
              <fieldset className="user-scope">
                <legend>العلامات المسموح بها</legend>
                <div className="user-scope-options">
                  {data.brands.map((b) => (
                    <label className="checkbox" key={b.id}>
                      <input
                        type="checkbox"
                        checked={brands.includes(b.id)}
                        onChange={() => toggleBrand(b.id)}
                      />
                      <img src={"/logos/" + b.logo} alt="" />
                      {b.name}
                    </label>
                  ))}
                </div>
                {!data.brands.length && <p>أضف علامة تجارية أولاً.</p>}
              </fieldset>
              <fieldset className="user-scope">
                <legend>الفروع المسموح بها</legend>
                <div className="user-scope-mode">
                  <label className="checkbox">
                    <input
                      type="radio"
                      name="branchMode"
                      checked={!restricted}
                      disabled={role === "BRANCH_MANAGER"}
                      onChange={() => setRestricted(false)}
                    />
                    جميع فروع العلامات المحددة، الحالية والجديدة
                  </label>
                  <label className="checkbox">
                    <input
                      type="radio"
                      name="branchMode"
                      checked={restricted}
                      onChange={() => setRestricted(true)}
                    />
                    فروع محددة فقط
                  </label>
                </div>
                {restricted && (
                  <div className="user-scope-options">
                    {availableBranches.map((b) => (
                      <label className="checkbox" key={b.id}>
                        <input
                          type="checkbox"
                          checked={branches.includes(b.id)}
                          onChange={() =>
                            setBranches((current) =>
                              current.includes(b.id)
                                ? current.filter((id) => id !== b.id)
                                : [...current, b.id],
                            )
                          }
                        />
                        {b.brandName} — {b.name}
                      </label>
                    ))}
                    {!availableBranches.length && <p>اختر علامة بها فروع أولاً.</p>}
                  </div>
                )}
              </fieldset>
            </>
          )}
          <label className="checkbox">
            <input name="enabled" type="checkbox" defaultChecked={user?.enabled ?? true} />
            الحساب نشط ويمكنه تسجيل الدخول
          </label>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="poster-actions">
          <Submit busy={busy}>{user ? "حفظ الصلاحيات" : "إضافة المستخدم"}</Submit>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
}
