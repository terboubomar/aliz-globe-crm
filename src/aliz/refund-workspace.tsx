import { useEffect, useState, FormEvent } from "react";
import { Wallet, Plus, ArrowLeft, Clock, Upload, ShieldCheck, MapPin } from "lucide-react";
import { Data, Refund, api, date, n, refundStates, eventNames } from "./types";
import { EvidenceLink } from "./evidence";
import { Modal, Field, Submit, Empty } from "./ui";
type Mutation = (path: string, body?: unknown) => Promise<unknown>;
const fields = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
};
const financialStages = [
  { label: "الطلب", states: ["REQUESTED"] },
  { label: "الموافقة", states: ["UNDER_REVIEW"] },
  { label: "التنفيذ الخارجي", states: ["AWAITING_EXTERNAL_EXECUTION"] },
  { label: "التحقق", states: ["EXECUTED_UNVERIFIED"] },
  { label: "إبلاغ العميل", states: ["VERIFIED", "CUSTOMER_NOTIFIED"] },
  { label: "مكتمل", states: ["COMPLETED"] },
];
export function RefundWorkspace({
  data,
  brand,
  mutate,
  busy,
  reload,
  onComplaint,
}: {
  data: Data;
  brand: string;
  mutate: Mutation;
  busy: boolean;
  reload: () => Promise<void>;
  onComplaint: (id: string) => void;
}) {
  const [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false);
  // Fast Refresh can preserve a bootstrap loaded before independent refunds existed.
  // Missing data must trigger a refresh, never masquerade as an empty financial list.
  const records = Array.isArray(data.refunds) ? data.refunds : null;
  const needsReload = records === null;
  useEffect(() => {
    if (needsReload) void reload();
  }, [needsReload, reload]);
  if (!records) {
    return (
      <section className="panel" role="status">
        <h2>تحديث بيانات الاسترجاع والإلغاء</h2>
        <p>
          لم تكتمل بيانات الطلبات المالية. جارٍ تحديثها؛ يمكنك إعادة المحاولة إذا استمرت المشكلة.
        </p>
        <button className="primary" onClick={() => void reload()} disabled={busy}>
          إعادة تحميل الطلبات المالية
        </button>
      </section>
    );
  }
  const isAgent =
    data.me?.role === "AGENT" && (!data.me.financeDuty || data.me.financeDuty === "NONE");
  const canProcess = data.permissions.some((p) =>
    ["refund.decide", "refund.execute", "refund.verify", "refund.notify"].includes(p),
  );
  const canRequest = data.permissions.includes("refund.request");
  const refunds = records.filter(
    (r) => (brand === "all" || r.brandId === brand) && (status === "all" || r.status === status),
  );
  const r = records.find((r) => r.id === selected);
  return (
    <>
      <div className="financial-heading">
        <div>
          <Wallet size={22} />
          <div>
            <h2>{isAgent ? "طلباتي للاسترجاع والإلغاء" : "مساحة الاسترجاع والإلغاء"}</h2>
          </div>
        </div>
        {data.permissions.includes("refund.request") && (
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={18} />
            طلب استرجاع أو إلغاء
          </button>
        )}
      </div>
      <div className="notice">
        <ShieldCheck size={20} />
        {isAgent
          ? "طلباتك بانتظار مراجعة الجهة المختصة."
          : "يُنفّذ الاسترجاع والإلغاء على نظام الطلبات الخارجي."}
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>
            الطلبات المالية <span className="count-badge">{n(refunds.length)}</span>
          </h2>
          <select
            aria-label="حالة الطلب المالي"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">جميع المراحل</option>
            {Object.entries(refundStates).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {refunds.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الطلب المالي</th>
                  <th>العلامة / الفرع</th>
                  <th>الطلب الخارجي</th>
                  <th>المبلغ المطلوب</th>
                  <th>الحالة</th>
                  <th>وقت التسجيل</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button className="ticket-link" onClick={() => setSelected(r.id)}>
                        <b dir="ltr">{r.number}</b>
                        <small>{r.kind === "REFUND" ? "استرجاع" : "إلغاء"}</small>
                      </button>
                    </td>
                    <td>
                      <b>{r.branch?.name ?? "غير محدد"}</b>
                      <small className="block">{r.brand.name}</small>
                    </td>
                    <td>
                      <span dir="ltr">{r.externalOrder}</span>
                      <small className="block">{r.platform}</small>
                    </td>
                    <td>{r.amountMinor ? n(r.amountMinor / 100) + " ر.س" : "غير محدد"}</td>
                    <td>
                      <span className="badge amber">{refundStates[r.status]}</span>
                    </td>
                    <td>
                      <time dateTime={r.createdAt}>{date(r.createdAt)}</time>
                    </td>
                    <td>
                      <button className="text-btn" onClick={() => setSelected(r.id)}>
                        {canProcess ? "إدارة الطلب" : "عرض الطلب"} <ArrowLeft size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="لا توجد طلبات مالية مطابقة"
            detail={
              canRequest
                ? "أنشئ طلب استرجاع أو إلغاء من الزر أعلاه."
                : "تظهر الطلبات هنا ضمن العلامات والحالات المسموح بها لدورك."
            }
          />
        )}
      </section>
      {creating && (
        <NewRefund
          data={data}
          brand={brand}
          mutate={mutate}
          busy={busy}
          onClose={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            setSelected(id);
          }}
        />
      )}
      {r && (
        <RefundDetail
          r={r}
          data={data}
          busy={busy}
          mutate={mutate}
          reload={reload}
          onClose={() => setSelected(null)}
          onComplaint={(id) => {
            setSelected(null);
            onComplaint(id);
          }}
        />
      )}
    </>
  );
}
function NewRefund({
  data,
  brand,
  mutate,
  busy,
  onClose,
  onDone,
}: {
  data: Data;
  brand: string;
  mutate: Mutation;
  busy: boolean;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [brandId, setBrand] = useState(brand === "all" ? data.brands[0]?.id : brand),
    [ticketId, setTicket] = useState(""),
    [error, setError] = useState("");
  const ticket = data.tickets.find((t) => t.id === ticketId);
  return (
    <Modal title="طلب استرجاع أو إلغاء مستقل" onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          const b = fields(e);
          try {
            const r = (await mutate("refunds", {
              ...b,
              ticketId: ticketId || undefined,
              branchId: b["branchId"] || null,
              amountMinor: b["amount"] ? Math.round(Number(b["amount"]) * 100) : undefined,
            })) as { id: string };
            onDone(r.id);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="العلامة التجارية">
            <select
              name="brandId"
              value={brandId}
              onChange={(e) => {
                setBrand(e.target.value);
                setTicket("");
              }}
            >
              {data.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="شكوى مرتبطة (اختياري)">
            <select value={ticketId} onChange={(e) => setTicket(e.target.value)}>
              <option value="">طلب مستقل دون شكوى</option>
              {data.tickets
                .filter((t) => t.brandId === brandId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.number} — {t.branch?.name ?? "غير محدد"}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="الفرع">
            <select
              name="branchId"
              key={brandId + ticketId}
              defaultValue={ticket?.branchId ?? ""}
              required
            >
              <option value="">اختر الفرع</option>
              {data.brands
                .find((b) => b.id === brandId)
                ?.branches.filter((b) => b.active)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="نوع الطلب">
            <select name="kind">
              <option value="REFUND">طلب استرجاع</option>
              <option value="CANCELLATION">طلب إلغاء</option>
            </select>
          </Field>
          <Field label="رقم الطلب الخارجي">
            <input
              name="externalOrder"
              key={"order-" + ticketId}
              defaultValue={ticket?.externalOrder ?? ""}
              dir="ltr"
              required
              maxLength={100}
            />
          </Field>
          <Field label="منصة الطلب">
            <input
              name="platform"
              key={"platform-" + ticketId}
              defaultValue={ticket?.platform ?? ""}
              required
              maxLength={80}
            />
          </Field>
          <Field label="المبلغ المطلوب (ر.س، اختياري)">
            <input name="amount" type="number" min="0.01" max="100000" step="0.01" />
          </Field>
          <Field label="سبب الطلب" full>
            <textarea name="reason" required minLength={5} maxLength={1000} rows={3} />
          </Field>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <p>تسجيل الطلب لا ينفّذ أي إلغاء أو حركة مالية.</p>
          <Submit busy={busy}>تسجيل الطلب المالي</Submit>
        </div>
      </form>
    </Modal>
  );
}
function RefundDetail({
  r,
  data,
  busy,
  mutate,
  reload,
  onClose,
  onComplaint,
}: {
  r: Refund;
  data: Data;
  busy: boolean;
  mutate: Mutation;
  reload: () => Promise<void>;
  onClose: () => void;
  onComplaint: (id: string) => void;
}) {
  const [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  const allowed = [
    {
      id: "resubmit",
      perm: r.requester === data.me.id ? "refund.request" : "__deny",
      state: "REJECTED",
      label: "إعادة تقديم الطلب",
    },
    { id: "review", perm: "refund.decide", state: "REQUESTED", label: "بدء المراجعة" },
    { id: "approve", perm: "refund.decide", state: "UNDER_REVIEW", label: "اعتماد الطلب" },
    { id: "reject", perm: "refund.decide", state: "UNDER_REVIEW", label: "رفض مع السبب" },
    {
      id: "execute",
      perm: "refund.execute",
      state: "AWAITING_EXTERNAL_EXECUTION",
      label: "توثيق التنفيذ الخارجي",
    },
    {
      id: "verify",
      perm: "refund.verify",
      state: "EXECUTED_UNVERIFIED",
      label: "التحقق المستقل من الإثبات",
    },
    { id: "notify", perm: "refund.notify", state: "VERIFIED", label: "توثيق إبلاغ العميل" },
    { id: "complete", perm: "refund.notify", state: "CUSTOMER_NOTIFIED", label: "إكمال الطلب" },
  ].filter((a) => data.permissions.includes(a.perm) && a.state === r.status);
  const [action, setAction] = useState(allowed[0]?.id ?? "");
  const proofs = [
    ...r.attachments,
    ...(r.ticketId ? (data.tickets.find((t) => t.id === r.ticketId)?.attachments ?? []) : []),
  ];
  const name = (id: string | null) => data.users.find((u) => u.id === id)?.name ?? "لم يحدد";
  return (
    <Modal title={r.number} onClose={onClose} wide>
      <div className="refund-case-header">
        <img src={"/logos/" + r.brand.logo} alt={r.brand.name} />
        <div>
          <h2>{r.kind === "REFUND" ? "طلب استرجاع" : "طلب إلغاء"}</h2>
          <p>
            <MapPin size={14} />
            {r.brand.name} — {r.branch?.name ?? "غير محدد"}
          </p>
          <small>
            <Clock size={13} />
            سُجل في {date(r.createdAt)}
          </small>
        </div>
        <span className="badge amber">{refundStates[r.status]}</span>
      </div>
      <div className="financial-path">
        {financialStages.map((stage, i) => (
          <div key={stage.label} className={stage.states.includes(r.status) ? "current" : ""}>
            <span>{n(i + 1)}</span>
            <b>{stage.label}</b>
          </div>
        ))}
      </div>
      <div className="detail-facts">
        <div>
          <small>الطلب الخارجي</small>
          <b dir="ltr">{r.externalOrder}</b>
        </div>
        <div>
          <small>المنصة</small>
          <b>{r.platform}</b>
        </div>
        <div>
          <small>المبلغ المطلوب</small>
          <b>{r.amountMinor ? n(r.amountMinor / 100) + " ر.س" : "غير محدد"}</b>
        </div>
        <div>
          <small>الموافق</small>
          <b>{name(r.approver)}</b>
        </div>
        <div>
          <small>مسؤول التنفيذ</small>
          <b>{name(r.processor)}</b>
        </div>
        <div>
          <small>المتحقق</small>
          <b>{name(r.verifier)}</b>
        </div>
      </div>
      <p className="description">{r.reason}</p>
      {r.ticket && (
        <div className="linked-record">
          <span>
            شكوى مرتبطة للمرجعية فقط: <b dir="ltr">{r.ticket.number}</b>
          </span>
          <button className="text-btn" onClick={() => onComplaint(r.ticket!.id)}>
            فتح الشكوى <ArrowLeft size={15} />
          </button>
        </div>
      )}
      {r.externalReference && (
        <p className="linked-record">
          مرجع التنفيذ الخارجي: <b dir="ltr">{r.externalReference}</b>
        </p>
      )}
      <section className="padded">
        <h3>إثباتات الطلب المالي</h3>
        <div className="attachment-grid">
          {proofs.map((f, i) => (
            <EvidenceLink key={f.id} id={f.id} alt={"إثبات مالي " + (i + 1)}>
              <small>إثبات {n(i + 1)}</small>
            </EvidenceLink>
          ))}
        </div>
        {data.permissions.includes("evidence.attach") && r.attachments.length < 3 && (
          <label className="upload-zone">
            <Upload size={22} />
            <span>{uploading ? "جارٍ رفع الإثبات…" : "إرفاق إثبات مالي لهذا الطلب"}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={uploading}
              onChange={async (e) => {
                if (!e.target.files?.length) return;
                const body = new FormData();
                Array.from(e.target.files).forEach((f) => body.append("files", f));
                setUploading(true);
                try {
                  await api(`refunds/${r.id}/evidence/images`, undefined, { method: "POST", body });
                  await reload();
                } catch (e) {
                  setError((e as Error).message);
                }
                setUploading(false);
              }}
            />
          </label>
        )}
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {allowed.length > 0 && (
        <form
          className="action-form"
          key={r.status}
          onSubmit={async (e) => {
            const b = fields(e);
            try {
              await mutate(`refunds/${r.id}/${b["action"]}`, {
                ...b,
                version: r.version,
                ...(b["amount"] ? { amountMinor: Math.round(Number(b["amount"]) * 100) } : {}),
              });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <h3>الإجراء المالي التالي</h3>
          <div className="form-grid">
            <Field label="الإجراء المالي">
              <select
                name="action"
                value={allowed.some((a) => a.id === action) ? action : (allowed[0]?.id ?? "")}
                onChange={(e) => setAction(e.target.value)}
              >
                {allowed.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            {allowed.some((a) => a.id === "execute") && (
              <>
                <Field label="مرجع التنفيذ الخارجي">
                  <input name="reference" required maxLength={200} />
                </Field>
                <Field label="إثبات التنفيذ">
                  <select name="proofId" required>
                    <option value="">اختر الإثبات</option>
                    {proofs.map((f, i) => (
                      <option key={f.id} value={f.id}>
                        إثبات {n(i + 1)}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            <Field label="ملاحظة القرار / الإجراء" full>
              <textarea name="note" required minLength={3} maxLength={1000} />
            </Field>
            {allowed.some((a) => a.id === "resubmit") && (
              <>
                <Field label="سبب الطلب بعد التصحيح" full>
                  <textarea
                    name="reason"
                    required
                    defaultValue={r.reason}
                    minLength={5}
                    maxLength={1000}
                  />
                </Field>
                <Field label="المبلغ بعد التصحيح (ر.س)">
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max="100000"
                    step="0.01"
                    defaultValue={r.amountMinor ? r.amountMinor / 100 : ""}
                  />
                </Field>
              </>
            )}
          </div>
          <Submit busy={busy}>حفظ المرحلة المالية</Submit>
        </form>
      )}
      <section className="padded">
        <h3>سجل الطلب المالي</h3>
        <div className="timeline">
          {r.events.map((e) => (
            <article key={e.id}>
              <span className="timeline-dot" />
              <div>
                <b>{eventNames[e.type] ?? e.type}</b>
                <small>
                  {name(e.actor)} • {date(e.createdAt)}
                </small>
                {e.note && <p>{e.note}</p>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </Modal>
  );
}
