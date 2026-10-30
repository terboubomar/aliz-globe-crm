import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileText, Pencil, Plus, Send, Trash2 } from "lucide-react";
import {
  PLACEHOLDERS,
  STARTER_TEMPLATES,
  TEMPLATE_ACTIONS,
  type ReplyTemplate,
} from "@/lib/reply-templates";
import { WORDS, WORD_KEYS, MAX_WORD_LENGTH, type WordKey } from "@/lib/telegram-words";
import { api, categories, n, type Data } from "./types";
import { Empty, Field, Modal, Submit } from "./ui";
import { loadReplyTemplates, setReplyTemplatesCache } from "./reply-templates-cache";

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const chips = (ids: string[], names: Record<string, string>, all: string) =>
  ids.length ? ids.map((id) => names[id] ?? id).join("، ") : all;

export function ReplyTemplatesPanel({ data }: { data: Data }) {
  const [list, setList] = useState<ReplyTemplate[] | null>(null),
    [editing, setEditing] = useState<ReplyTemplate | null>(null),
    [removing, setRemoving] = useState<ReplyTemplate | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const brandNames = Object.fromEntries(data.brands.map((b) => [b.id, b.name]));
  useEffect(() => {
    void loadReplyTemplates(true).then(setList);
  }, []);
  const save = useCallback(async (next: ReplyTemplate[], done: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("templates/replies", { templates: next });
      setList(next);
      setReplyTemplatesCache(next);
      setNotice(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="panel templates-panel">
      <div className="panel-head">
        <h2>
          <FileText size={18} /> الردود الجاهزة
        </h2>
        <button
          className="primary"
          disabled={busy || !list}
          onClick={() =>
            setEditing({
              id: newId(),
              title: "",
              text: "",
              actions: [],
              categories: [],
              brandIds: [],
            })
          }
        >
          <Plus size={16} /> قالب جديد
        </button>
      </div>
      <div className="padded">
        <p className="hint">
          تظهر هذه القوالب للفريق فوق خانة الملاحظة في إجراءات الشكوى، حسب الإجراء وسبب الشكوى
          والعلامة. يختار الموظف القالب ثم يعدّل النص قبل الحفظ.
        </p>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {error && !editing && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {list && !list.length && (
          <Empty
            title="لا توجد ردود جاهزة بعد"
            detail="ابدأ بقوالب مقترحة وعدّلها، أو أضف قالبك الأول."
            action={
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void save(
                    STARTER_TEMPLATES.map((t) => ({ ...t, id: newId() })),
                    "تمت إضافة القوالب المقترحة؛ عدّلها بما يناسب فريقك.",
                  )
                }
              >
                إضافة القوالب المقترحة
              </button>
            }
          />
        )}
        {list && list.length > 0 && (
          <ul className="template-list">
            {list.map((t) => (
              <li key={t.id}>
                <div>
                  <b>{t.title}</b>
                  <p>{t.text}</p>
                  <small>
                    {chips(t.actions, TEMPLATE_ACTIONS, "كل الإجراءات")} ·{" "}
                    {chips(t.categories, categories, "كل الأسباب")} ·{" "}
                    {chips(t.brandIds, brandNames, "كل العلامات")}
                  </small>
                </div>
                <span className="template-row-actions">
                  <button
                    className="icon-btn"
                    aria-label={`تعديل ${t.title}`}
                    onClick={() => setEditing(t)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`حذف ${t.title}`}
                    onClick={() => setRemoving(t)}
                  >
                    <Trash2 size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {list && list.length > 0 && <p className="hint">{n(list.length)} قالب</p>}
      </div>
      {editing && list && (
        <TemplateForm
          template={editing}
          brands={data.brands}
          busy={busy}
          error={error}
          onClose={() => {
            setEditing(null);
            setError("");
          }}
          onSave={async (t) => {
            const exists = list.some((x) => x.id === t.id);
            const ok = await save(
              exists ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t],
              exists ? "تم حفظ القالب." : "تمت إضافة القالب.",
            );
            if (ok) setEditing(null);
          }}
        />
      )}
      {removing && list && (
        <Modal title="حذف القالب" onClose={() => setRemoving(null)}>
          <p>
            حذف «<b>{removing.title}</b>»؟ لن يظهر للفريق بعد ذلك. الملاحظات المحفوظة سابقاً لا
            تتغير.
          </p>
          <div className="table-tools">
            <button
              className="secondary danger"
              disabled={busy}
              onClick={async () => {
                if (
                  await save(
                    list.filter((x) => x.id !== removing.id),
                    "تم حذف القالب.",
                  )
                )
                  setRemoving(null);
              }}
            >
              حذف
            </button>
            <button className="secondary" onClick={() => setRemoving(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Checks({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: [string, string][];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="template-checks">
      <legend>
        {name} <small>(بدون اختيار = الكل)</small>
      </legend>
      {options.map(([id, label]) => (
        <label key={id} className="checkbox">
          <input
            type="checkbox"
            checked={value.includes(id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, id] : value.filter((x) => x !== id))
            }
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function TemplateForm({
  template,
  brands,
  busy,
  error,
  onClose,
  onSave,
}: {
  template: ReplyTemplate;
  brands: Data["brands"];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (t: ReplyTemplate) => void;
}) {
  const [t, setT] = useState(template);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ ...t, title: t.title.trim(), text: t.text.trim() });
  };
  return (
    <Modal title={template.title ? "تعديل القالب" : "قالب جديد"} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="عنوان القالب (يراه الموظف في القائمة)" full>
            <input
              value={t.title}
              required
              minLength={2}
              maxLength={80}
              onChange={(e) => setT({ ...t, title: e.target.value })}
            />
          </Field>
          <Field label="نص الرد" full>
            <textarea
              id="template-text"
              value={t.text}
              required
              minLength={3}
              maxLength={2000}
              rows={4}
              onChange={(e) => setT({ ...t, text: e.target.value })}
            />
            <small className="template-placeholders">
              إضافة تلقائية:{" "}
              {Object.entries(PLACEHOLDERS).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className="text-btn"
                  title={label}
                  onClick={() => setT({ ...t, text: (t.text ? t.text + " " : "") + key })}
                >
                  {key}
                </button>
              ))}
            </small>
          </Field>
        </div>
        <Checks
          name="يظهر في الإجراءات"
          options={Object.entries(TEMPLATE_ACTIONS)}
          value={t.actions}
          onChange={(actions) => setT({ ...t, actions })}
        />
        <Checks
          name="سبب الشكوى"
          options={Object.entries(categories)}
          value={t.categories}
          onChange={(c) => setT({ ...t, categories: c })}
        />
        {brands.length > 1 && (
          <Checks
            name="العلامات"
            options={brands.map((b) => [b.id, b.name])}
            value={t.brandIds}
            onChange={(brandIds) => setT({ ...t, brandIds })}
          />
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <Submit busy={busy}>حفظ القالب</Submit>
        </div>
      </form>
    </Modal>
  );
}

/** Wording of the Telegram bot's messages (super admin). */
export function TelegramWordsPanel() {
  const [words, setWords] = useState<Partial<Record<WordKey, string>> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    api<{ words: Record<string, string> }>("templates/telegram")
      .then((r) => setWords(r.words))
      .catch((e: Error) => setError(e.message));
  }, []);
  const changed = words ? WORD_KEYS.filter((k) => words[k]?.trim()).length : 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!words) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("templates/telegram", { words });
      setNotice("تم حفظ نصوص الرسائل. تُستخدم في الرسائل القادمة خلال دقيقة.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel templates-panel">
      <div className="panel-head">
        <h2>
          <Send size={18} /> نصوص رسائل تيليجرام
        </h2>
        {words && changed > 0 && <span className="badge neutral">{n(changed)} نص معدّل</span>}
      </div>
      <form className="padded" onSubmit={submit}>
        <p className="hint">
          غيّر عناوين رسائل البوت للفريق. اترك الحقل فارغاً لاستخدام النص الافتراضي. تفاصيل الشكوى
          والوردية والأزرار تُضاف تلقائياً، ولا تُرسل بيانات العملاء.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {words && (
          <div className="form-grid">
            {WORD_KEYS.map((k) => (
              <Field key={k} label={WORDS[k].label} full>
                <span className="template-word">
                  <input
                    value={words[k] ?? ""}
                    maxLength={MAX_WORD_LENGTH}
                    placeholder={WORDS[k].default || "بدون سطر إضافي"}
                    onChange={(e) => setWords({ ...words, [k]: e.target.value })}
                  />
                  {words[k]?.trim() && (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setWords({ ...words, [k]: "" })}
                    >
                      الافتراضي
                    </button>
                  )}
                </span>
                {WORDS[k].hint && <small>{WORDS[k].hint}</small>}
              </Field>
            ))}
          </div>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <div className="form-footer">
          <Submit busy={busy || !words}>حفظ النصوص</Submit>
        </div>
      </form>
    </section>
  );
}
