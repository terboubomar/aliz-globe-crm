import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Clock,
  Hammer,
  Inbox,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  MAINTENANCE_PRIORITIES,
  maintenanceActionLabels,
  maintenanceActions,
  maintenanceAsksDetail,
  maintenanceCategoryText,
  maintenanceLate,
  maintenanceNumber,
  maintenancePriorityLabels,
  maintenanceStateLabels,
  type MaintenanceAction,
  type MaintenancePriority,
  type MaintenanceRequest,
  type MaintenanceSettings,
} from "@/lib/maintenance";
import { ago } from "@/lib/dashboard";
import { KpiCards, type Kpi } from "./dashboard-bits";
import { Empty, Field, Modal } from "./ui";
import { n, type Data } from "./types";
import { maintenanceApi, type MaintenanceBoard, type MaintenanceDetail } from "./maintenance-api";

/*
 * The Maintenance app. Branch managers ask for repairs and confirm them; the
 * maintenance manager assigns each request to a technician; technicians see
 * and work only their own jobs. The server checks every step again.
 */

const eventLabels: Record<string, string> = {
  CREATED: "تم إنشاء الطلب",
  ASSIGN: "أُسند إلى",
  START: "بدأ العمل",
  DONE: "تم الإصلاح",
  CONFIRM: "أكد الفرع الإصلاح",
  REOPEN: "أعاد الفرع فتح الطلب",
  CANCEL: "أُلغي الطلب",
  COMMENT: "ملاحظة",
  PHOTO_BEFORE: "أُضيفت صورة للعطل",
  PHOTO_AFTER: "أُضيفت صورة بعد الإصلاح",
};
const stateTone: Record<string, string> = {
  NEW: "amber",
  ASSIGNED: "blue",
  IN_PROGRESS: "blue",
  DONE: "green",
  CONFIRMED: "neutral",
  CANCELLED: "neutral",
};
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    calendar: "gregory",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(new Date(iso));

type Queue = "open" | "new" | "working" | "done" | "late" | "closed";

export function MaintenanceWorkspace({
  data,
  brand,
  newRequest = 0,
}: {
  data: Data;
  brand: string;
  /** Changes when the phone quick bar asks for a new request. */
  newRequest?: number;
}) {
  const [board, setBoard] = useState<MaintenanceBoard | null>(null),
    [closed, setClosed] = useState(false),
    [queue, setQueue] = useState<Queue>("open"),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [openId, setOpenId] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [configuring, setConfiguring] = useState(false),
    [toast, setToast] = useState("");
  const permissions = data.permissions,
    has = (p: string) => permissions.includes(p),
    me = data.me;
  const technician = me.role === "TECHNICIAN";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await maintenanceApi.board(closed ? "all" : "open"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [closed]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (newRequest) setCreating(true);
  }, [newRequest]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const branches = useMemo(
    () =>
      data.brands.flatMap((b) =>
        b.branches.map((r) => ({ id: r.id, name: r.name, brandId: b.id, brandName: b.name })),
      ),
    [data.brands],
  );
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "فرع";
  const logoOf = (brandId: string) => data.brands.find((b) => b.id === brandId)?.logo ?? "";
  const personName = (id: string | null) =>
    !id
      ? "غير مسند"
      : id === me.id
        ? "أنت"
        : (board?.people.find((p) => p.id === id)?.name ??
          data.users.find((u) => u.id === id)?.name ??
          "موظف");
  const categoryText = (r: MaintenanceRequest) =>
    maintenanceCategoryText(r, board?.settings.categories ?? []);

  const all = (board?.requests ?? []).filter((r) => brand === "all" || r.brandId === brand);
  const active = all.filter((r) => !["CONFIRMED", "CANCELLED"].includes(r.state));
  const counts = {
    new: active.filter((r) => r.state === "NEW").length,
    working: active.filter((r) => ["ASSIGNED", "IN_PROGRESS"].includes(r.state)).length,
    done: active.filter((r) => r.state === "DONE").length,
    late: active.filter((r) => maintenanceLate(r)).length,
  };
  const visible = all
    .filter((r) => {
      if (queue === "closed") return ["CONFIRMED", "CANCELLED"].includes(r.state);
      if (["CONFIRMED", "CANCELLED"].includes(r.state)) return false;
      if (queue === "new") return r.state === "NEW";
      if (queue === "working") return ["ASSIGNED", "IN_PROGRESS"].includes(r.state);
      if (queue === "done") return r.state === "DONE";
      if (queue === "late") return !!maintenanceLate(r);
      return true;
    })
    .filter(
      (r) =>
        !search.trim() ||
        [maintenanceNumber(r.number), r.title, branchName(r.branchId), categoryText(r)]
          .join(" ")
          .includes(search.trim()),
    )
    .sort(
      (a, b) =>
        Number(!!maintenanceLate(b)) - Number(!!maintenanceLate(a)) ||
        MAINTENANCE_PRIORITIES.indexOf(a.priority) - MAINTENANCE_PRIORITIES.indexOf(b.priority) ||
        +new Date(a.createdAt) - +new Date(b.createdAt),
    );

  const kpis: Kpi[] = [
    {
      key: "new",
      label: technician ? "بانتظار البدء" : "طلبات جديدة",
      value: technician ? active.filter((r) => r.state === "ASSIGNED").length : counts.new,
      icon: Inbox,
      tone: "amber",
    },
    { key: "working", label: "قيد التنفيذ", value: counts.working, icon: Hammer, tone: "blue" },
    {
      key: "done",
      label: "بانتظار تأكيد الفرع",
      value: counts.done,
      icon: CheckCircle2,
      tone: "green",
    },
    { key: "late", label: "متأخرة", value: counts.late, icon: AlertTriangle, tone: "red" },
  ];
  const canCreate = has("mnt.request") || has("mnt.assign");

  return (
    <div className="mnt-workspace">
      <div className="mnt-toolbar">
        <div className="mnt-toolbar-start">
          {canCreate && (
            <button className="primary" onClick={() => setCreating(true)}>
              <Plus size={18} /> طلب صيانة جديد
            </button>
          )}
          {has("mnt.configure") && (
            <button className="secondary" onClick={() => setConfiguring(true)}>
              <Settings2 size={17} /> أنواع الأعطال والمهل
            </button>
          )}
        </div>
        <button className="text-btn" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} /> تحديث
        </button>
      </div>
      {toast && (
        <div className="notice" role="status">
          {toast}
        </div>
      )}
      {error && (
        <div className="error-bar" role="alert">
          {error}
          <button className="text-btn" onClick={load}>
            إعادة المحاولة
          </button>
        </div>
      )}
      <KpiCards
        items={kpis}
        selected={queue}
        onPick={(key) => setQueue(queue === key ? "open" : (key as Queue))}
      />
      <section className="panel">
        <div className="panel-head">
          <h2>{technician ? "الأعمال المسندة إليّ" : "طلبات الصيانة"}</h2>
          <span className="badge neutral">{n(visible.length)} طلب</span>
        </div>
        <div className="agent-queue-controls">
          <label className="qr-search">
            <Wrench size={17} />
            <input
              aria-label="بحث طلبات الصيانة"
              placeholder="رقم الطلب، العطل أو الفرع"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="تصفية طلبات الصيانة"
            value={queue}
            onChange={(e) => {
              const q = e.target.value as Queue;
              setQueue(q);
              if (q === "closed") setClosed(true);
            }}
          >
            <option value="open">المفتوحة</option>
            <option value="new">جديدة</option>
            <option value="working">قيد التنفيذ</option>
            <option value="done">بانتظار تأكيد الفرع</option>
            <option value="late">متأخرة</option>
            <option value="closed">المغلقة</option>
          </select>
        </div>
        {loading && !board ? (
          <div className="padded" role="status">
            <RefreshCw className="spin" size={18} /> جارٍ التحميل…
          </div>
        ) : !visible.length ? (
          <Empty
            title={technician ? "لا توجد أعمال مسندة إليك هنا" : "لا توجد طلبات في هذه القائمة"}
            detail={
              canCreate ? "اطلب صيانة جديدة عند وجود عطل في الفرع." : "تظهر الطلبات هنا عند وصولها."
            }
          />
        ) : (
          <div className="dash-case-list">
            {visible.map((r) => {
              const late = maintenanceLate(r);
              return (
                <article
                  key={r.id}
                  className={"dash-case mnt-row" + (r.priority === "URGENT" ? " urgent" : "")}
                >
                  {logoOf(r.brandId) ? (
                    <img src={"/logos/" + logoOf(r.brandId)} alt="" />
                  ) : (
                    <span className="mnt-row-icon">
                      <Wrench size={20} />
                    </span>
                  )}
                  <div className="dash-case-main">
                    <div className="dash-case-top">
                      <b dir="ltr">{maintenanceNumber(r.number)}</b>
                      {r.priority !== "NORMAL" && (
                        <span className={"badge " + (r.priority === "URGENT" ? "red" : "amber")}>
                          {maintenancePriorityLabels[r.priority]}
                        </span>
                      )}
                      <span className={"badge " + stateTone[r.state]}>
                        {maintenanceStateLabels[r.state]}
                      </span>
                      {late && (
                        <span className="dash-deadline late">
                          <Clock size={12} />
                          {late === "respond" ? "متأخر عن البدء" : "متأخر عن الإصلاح"}
                        </span>
                      )}
                    </div>
                    <h3>{r.title}</h3>
                    <p>
                      {categoryText(r)} · {branchName(r.branchId)} · {ago(r.createdAt)}
                      {!technician && " · " + personName(r.assignee)}
                    </p>
                  </div>
                  <button type="button" className="secondary" onClick={() => setOpenId(r.id)}>
                    {primaryLabel(r, me.id, permissions)}
                    <ArrowLeft size={16} />
                  </button>
                </article>
              );
            })}
          </div>
        )}
        {!closed && (
          <div className="padded">
            <button
              className="text-btn"
              onClick={() => {
                setClosed(true);
                setQueue("closed");
              }}
            >
              عرض الطلبات المغلقة
            </button>
          </div>
        )}
      </section>

      {creating && board && (
        <NewRequest
          branches={branches.filter((b) => brand === "all" || b.brandId === brand)}
          settings={board.settings}
          onClose={() => setCreating(false)}
          onCreated={(number, warning) => {
            setCreating(false);
            setToast(
              "تم إرسال طلب الصيانة " + maintenanceNumber(number) + (warning ? ". " + warning : ""),
            );
            load();
          }}
        />
      )}
      {openId && board && (
        <RequestDetail
          id={openId}
          me={me.id}
          permissions={permissions}
          people={board.people}
          branchName={branchName}
          categoryText={categoryText}
          personName={personName}
          onClose={() => setOpenId(null)}
          onChanged={(msg) => {
            setToast(msg);
            load();
          }}
        />
      )}
      {configuring && board && (
        <SettingsDialog
          settings={board.settings}
          onClose={() => setConfiguring(false)}
          onSaved={(s) => {
            setBoard({ ...board, settings: s });
            setConfiguring(false);
            setToast("تم حفظ أنواع الأعطال والمهل");
          }}
        />
      )}
    </div>
  );
}

function primaryLabel(r: MaintenanceRequest, me: string, permissions: string[]) {
  const actions = maintenanceActions(r, { id: me, permissions });
  if (actions.includes("assign") && r.state === "NEW") return "إسناد";
  if (actions.includes("start")) return "بدء العمل";
  if (actions.includes("done")) return "إنهاء العمل";
  if (actions.includes("confirm")) return "تأكيد الإصلاح";
  return "عرض التفاصيل";
}

function NewRequest({
  branches,
  settings,
  onClose,
  onCreated,
}: {
  branches: { id: string; name: string; brandId: string; brandName: string }[];
  settings: MaintenanceSettings;
  onClose: () => void;
  onCreated: (number: number, warning: string) => void;
}) {
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0]!.id : ""),
    [category, setCategory] = useState(""),
    [categoryDetail, setCategoryDetail] = useState(""),
    [priority, setPriority] = useState<MaintenancePriority>("NORMAL"),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const brands = [...new Set(branches.map((b) => b.brandName))];
  const picked = settings.categories.find((c) => c.id === category);
  const asksDetail = !!picked && maintenanceAsksDetail(picked);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!branchId) return setError("اختر الفرع");
    if (!category) return setError("اختر نوع العطل");
    if (asksDetail && categoryDetail.trim().length < 3) return setError("اكتب نوع العطل");
    if (title.trim().length < 3) return setError("اكتب عنواناً قصيراً للعطل");
    setBusy(true);
    setError("");
    try {
      const res = await maintenanceApi.create({
        branchId,
        category,
        categoryDetail: asksDetail ? categoryDetail.trim() : "",
        priority,
        title,
        description,
      });
      let warning = "";
      if (files.length)
        await maintenanceApi.photos(res.id, "BEFORE", files).catch((err: Error) => {
          warning = "تعذر رفع الصور: " + err.message + " — أضفها من صفحة الطلب.";
        });
      onCreated(res.number, warning);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="طلب صيانة جديد" onClose={onClose} wide>
      <form className="form-grid" onSubmit={submit} noValidate>
        <Field label="الفرع">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">اختر الفرع</option>
            {brands.map((name) => (
              <optgroup key={name} label={name}>
                {branches
                  .filter((b) => b.brandName === name)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="نوع العطل">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">اختر نوع العطل</option>
            {settings.categories
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </Field>
        {asksDetail && (
          <Field label="ما نوع العطل؟" full>
            <input
              value={categoryDetail}
              onChange={(e) => setCategoryDetail(e.target.value)}
              maxLength={120}
              autoFocus
              placeholder="اكتب نوع العطل بكلمات قليلة، مثال: باب المستودع لا يقفل"
            />
          </Field>
        )}
        <Field label="الأولوية" full>
          <div className="mnt-priorities" role="radiogroup" aria-label="الأولوية">
            {MAINTENANCE_PRIORITIES.map((p) => (
              <label
                key={p}
                className={"mnt-priority " + p.toLowerCase() + (priority === p ? " on" : "")}
              >
                <input
                  type="radio"
                  name="priority"
                  checked={priority === p}
                  onChange={() => setPriority(p)}
                />
                <b>{maintenancePriorityLabels[p]}</b>
                <small>
                  البدء خلال {settings.sla[p].respond} س · الإصلاح خلال {settings.sla[p].fix} س
                </small>
              </label>
            ))}
          </div>
        </Field>
        <Field label="عنوان العطل" full>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="مثال: المكيف في الصالة لا يبرد"
          />
        </Field>
        <Field label="التفاصيل (اختياري)" full>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            placeholder="متى بدأ العطل، وأي معلومة تساعد الفني"
          />
        </Field>
        <div className="field full">
          <span>صور العطل (اختياري، حتى 3)</span>
          <PhotoPicker files={files} onChange={setFiles} input={input} />
        </div>
        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions full">
          <button type="button" className="secondary" onClick={onClose}>
            إلغاء
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "جارٍ الإرسال…" : "إرسال الطلب"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PhotoPicker({
  files,
  onChange,
  input,
}: {
  files: File[];
  onChange: (f: File[]) => void;
  input: React.RefObject<HTMLInputElement | null>;
}) {
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  return (
    <div className="mnt-photos">
      {previews.map((src, i) => (
        <div className="mnt-photo" key={src}>
          <img src={src} alt={"صورة " + (i + 1)} />
          <button
            type="button"
            className="icon-btn"
            aria-label={"حذف الصورة " + (i + 1)}
            onClick={() => onChange(files.filter((_, j) => j !== i))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {files.length < 3 && (
        <button type="button" className="mnt-photo add" onClick={() => input.current?.click()}>
          <Camera size={22} />
          أضف صورة
        </button>
      )}
      <input
        ref={input}
        className="upload-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          e.target.value = "";
          onChange([...files, ...chosen].slice(0, 3));
        }}
      />
    </div>
  );
}

function PhotoThumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    maintenanceApi
      .photoUrl(id)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id]);
  if (failed) return <div className="mnt-photo empty">تعذر عرض الصورة</div>;
  if (!url) return <div className="mnt-photo empty">…</div>;
  return (
    <a className="mnt-photo" href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="صورة الطلب" />
    </a>
  );
}

function RequestDetail({
  id,
  me,
  permissions,
  people,
  branchName,
  categoryText,
  personName,
  onClose,
  onChanged,
}: {
  id: string;
  me: string;
  permissions: string[];
  people: MaintenanceBoard["people"];
  branchName: (id: string) => string;
  categoryText: (r: MaintenanceRequest) => string;
  personName: (id: string | null) => string;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [detail, setDetail] = useState<MaintenanceDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [assignee, setAssignee] = useState(""),
    [files, setFiles] = useState<File[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const d = await maintenanceApi.detail(id);
      setDetail(d);
      setAssignee(d.request.assignee ?? "");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!detail)
    return (
      <Modal title="طلب صيانة" onClose={onClose} wide>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p className="padded" role="status">
            جارٍ التحميل…
          </p>
        )}
      </Modal>
    );
  const r = detail.request;
  const actions = maintenanceActions(r, { id: me, permissions });
  const technicians = people.filter(
    (p) =>
      ["TECHNICIAN", "MAINTENANCE_MANAGER"].includes(p.role) &&
      p.brandIds.includes(r.brandId) &&
      (!p.branchIds.length || p.branchIds.includes(r.branchId)),
  );
  const late = maintenanceLate(r);
  const stage: "BEFORE" | "AFTER" =
    ["IN_PROGRESS", "DONE"].includes(r.state) && permissions.includes("mnt.work")
      ? "AFTER"
      : "BEFORE";
  const canPhoto = !["CONFIRMED", "CANCELLED"].includes(r.state) && actions.length > 0;

  async function act(action: MaintenanceAction) {
    if (action === "assign" && !assignee) return setError("اختر الفني");
    if ((action === "reopen" || action === "comment") && !note.trim())
      return setError(action === "reopen" ? "اكتب سبب إعادة الفتح" : "اكتب الملاحظة");
    setBusy(true);
    setError("");
    try {
      await maintenanceApi.act({
        id: r.id,
        version: r.version,
        action,
        ...(action === "assign" ? { assignee } : {}),
        note: note.trim(),
      });
      setNote("");
      await load();
      onChanged(
        action === "comment" ? "تمت إضافة الملاحظة" : "تم: " + maintenanceActionLabels[action],
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      await maintenanceApi.photos(r.id, stage, files);
      setFiles([]);
      await load();
      onChanged("تمت إضافة الصور");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const before = detail.photos.filter((p) => p.stage === "BEFORE"),
    after = detail.photos.filter((p) => p.stage === "AFTER");

  return (
    <Modal title={maintenanceNumber(r.number) + " — " + r.title} onClose={onClose} wide>
      <div className="mnt-detail">
        <div className="mnt-detail-badges">
          <span className={"badge " + stateTone[r.state]}>{maintenanceStateLabels[r.state]}</span>
          <span
            className={
              "badge " +
              (r.priority === "URGENT" ? "red" : r.priority === "HIGH" ? "amber" : "neutral")
            }
          >
            {maintenancePriorityLabels[r.priority]}
          </span>
          {late && (
            <span className="dash-deadline late">
              <Clock size={12} />
              {late === "respond" ? "متأخر عن البدء" : "متأخر عن الإصلاح"}
            </span>
          )}
        </div>
        <dl className="mnt-facts">
          <div>
            <dt>الفرع</dt>
            <dd>{branchName(r.branchId)}</dd>
          </div>
          <div>
            <dt>نوع العطل</dt>
            <dd>{categoryText(r)}</dd>
          </div>
          <div>
            <dt>طلبه</dt>
            <dd>{personName(r.requester)}</dd>
          </div>
          <div>
            <dt>الفني</dt>
            <dd>{personName(r.assignee)}</dd>
          </div>
          {r.respondDueAt && (
            <div>
              <dt>البدء قبل</dt>
              <dd>{dateTime(r.respondDueAt)}</dd>
            </div>
          )}
          {r.fixDueAt && (
            <div>
              <dt>الإصلاح قبل</dt>
              <dd>{dateTime(r.fixDueAt)}</dd>
            </div>
          )}
        </dl>
        {r.description && <p className="mnt-description">{r.description}</p>}

        {(before.length > 0 || after.length > 0) && (
          <div className="mnt-photo-groups">
            {before.length > 0 && (
              <div>
                <h3>صور العطل</h3>
                <div className="mnt-photos">
                  {before.map((p) => (
                    <PhotoThumb key={p.id} id={p.id} />
                  ))}
                </div>
              </div>
            )}
            {after.length > 0 && (
              <div>
                <h3>بعد الإصلاح</h3>
                <div className="mnt-photos">
                  {after.map((p) => (
                    <PhotoThumb key={p.id} id={p.id} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {actions.length > 0 && (
          <section className="mnt-actions panel">
            {actions.includes("assign") && (
              <div className="mnt-assign">
                <Field label="الفني">
                  <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">اختر الفني</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  className="primary"
                  disabled={busy || !assignee || assignee === r.assignee}
                  onClick={() => act("assign")}
                >
                  {r.assignee ? "تغيير الفني" : "إسناد"}
                </button>
                {!technicians.length && (
                  <small className="hint">
                    لا يوجد فنيون لهذا الفرع. أضف حساباً بدور «فني صيانة» من المستخدمين والصلاحيات.
                  </small>
                )}
              </div>
            )}
            <Field label="ملاحظة">
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                placeholder={
                  actions.includes("reopen")
                    ? "عند إعادة الفتح اكتب ما لم يُصلح"
                    : "ملاحظة تظهر في سجل الطلب"
                }
              />
            </Field>
            <div className="mnt-action-buttons">
              {actions.includes("start") && (
                <button className="primary" disabled={busy} onClick={() => act("start")}>
                  بدء العمل
                </button>
              )}
              {actions.includes("done") && (
                <button className="primary" disabled={busy} onClick={() => act("done")}>
                  تم الإصلاح
                </button>
              )}
              {actions.includes("confirm") && (
                <button className="primary" disabled={busy} onClick={() => act("confirm")}>
                  تأكيد الإصلاح
                </button>
              )}
              {actions.includes("reopen") && (
                <button className="secondary" disabled={busy} onClick={() => act("reopen")}>
                  لم يُصلح — إعادة فتح
                </button>
              )}
              {actions.includes("comment") && (
                <button className="secondary" disabled={busy} onClick={() => act("comment")}>
                  إضافة ملاحظة
                </button>
              )}
              {actions.includes("cancel") && (
                <button className="text-btn danger" disabled={busy} onClick={() => act("cancel")}>
                  إلغاء الطلب
                </button>
              )}
            </div>
            {canPhoto && (
              <div className="mnt-upload">
                <span className="qf-label">
                  {stage === "AFTER" ? "صور بعد الإصلاح" : "صور العطل"}
                </span>
                <PhotoPicker files={files} onChange={setFiles} input={input} />
                {files.length > 0 && (
                  <button className="secondary" disabled={busy} onClick={upload}>
                    رفع الصور
                  </button>
                )}
              </div>
            )}
          </section>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <section className="mnt-timeline">
          <h3>سجل الطلب</h3>
          <ol>
            {detail.events.map((e) => (
              <li key={e.id}>
                <b>{eventLabels[e.type] ?? e.type}</b>
                {e.note && <span> {e.note}</span>}
                <small>
                  {personName(e.actor)} · {dateTime(e.createdAt)}
                </small>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Modal>
  );
}

function SettingsDialog({
  settings,
  onClose,
  onSaved,
}: {
  settings: MaintenanceSettings;
  onClose: () => void;
  onSaved: (s: MaintenanceSettings) => void;
}) {
  const [cats, setCats] = useState(settings.categories.map((c) => ({ ...c }))),
    [sla, setSla] = useState(structuredClone(settings.sla)),
    [label, setLabel] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function add() {
    const clean = label.replace(/\s+/g, " ").trim();
    if (clean.length < 2) return setError("اكتب اسم نوع العطل");
    if (cats.some((c) => c.label === clean)) return setError("نوع العطل موجود");
    let id = "";
    do id = "M_" + Math.random().toString(36).slice(2, 8).toUpperCase();
    while (cats.some((c) => c.id === id));
    setCats([...cats, { id, label: clean, active: true }]);
    setLabel("");
    setError("");
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      onSaved(await maintenanceApi.saveSettings({ categories: cats, sla }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="أنواع الأعطال والمهل" onClose={onClose} wide>
      <div className="mnt-settings">
        <section>
          <h3>المهل بالساعات</h3>
          <table className="mnt-sla">
            <thead>
              <tr>
                <th>الأولوية</th>
                <th>بدء العمل خلال</th>
                <th>الإصلاح خلال</th>
              </tr>
            </thead>
            <tbody>
              {MAINTENANCE_PRIORITIES.map((p) => (
                <tr key={p}>
                  <th>{maintenancePriorityLabels[p]}</th>
                  {(["respond", "fix"] as const).map((k) => (
                    <td key={k}>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        dir="ltr"
                        aria-label={
                          maintenancePriorityLabels[p] +
                          " " +
                          (k === "respond" ? "بدء العمل" : "الإصلاح")
                        }
                        value={sla[p][k]}
                        onChange={(e) =>
                          setSla({ ...sla, [p]: { ...sla[p], [k]: Number(e.target.value) } })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">تُحسب المهلة من وقت إرسال الطلب. التغيير يسري على الطلبات الجديدة.</p>
        </section>
        <section>
          <h3>أنواع الأعطال</h3>
          <ul className="mnt-cats">
            {cats.map((c, i) => (
              <li key={c.id}>
                <input
                  aria-label="اسم نوع العطل"
                  value={c.label}
                  maxLength={60}
                  onChange={(e) =>
                    setCats(cats.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={c.active}
                    onChange={(e) =>
                      setCats(
                        cats.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)),
                      )
                    }
                  />
                  <span>مفعل</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mnt-cat-add">
            <input
              aria-label="نوع عطل جديد"
              placeholder="نوع عطل جديد"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="secondary" onClick={add}>
              <Plus size={16} /> إضافة
            </button>
          </div>
          <p className="hint">أوقف النوع بدل حذفه، فتبقى الطلبات القديمة تعرض اسمه.</p>
        </section>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="secondary" onClick={onClose}>
            إلغاء
          </button>
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
