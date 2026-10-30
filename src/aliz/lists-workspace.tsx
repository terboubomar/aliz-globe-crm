import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from "lucide-react";
import { newCategoryId, type Catalog, type CategoryItem, type PlatformItem } from "@/lib/catalog";
import { api, lists, n } from "./types";

const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

/** Position number with up/down buttons; the order here is the order in every form. */
function Order({
  index,
  count,
  name,
  onMove,
}: {
  index: number;
  count: number;
  name: string;
  onMove: (to: number) => void;
}) {
  return (
    <span className="list-order">
      <b>{n(index + 1)}</b>
      <button
        type="button"
        className="icon-btn"
        aria-label={`رفع ${name}`}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ArrowUp size={15} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={`خفض ${name}`}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ArrowDown size={15} />
      </button>
    </span>
  );
}

/** Complaint reasons and order platforms, managed in Settings → Lists. */
export function ListsPanel() {
  const [cats, setCats] = useState<(CategoryItem & { fresh?: boolean })[]>(() =>
      lists.categories.map((c) => ({ ...c })),
    ),
    [plats, setPlats] = useState<PlatformItem[]>(() => lists.platforms.map((p) => ({ ...p }))),
    [newCat, setNewCat] = useState(""),
    [newPlat, setNewPlat] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");

  const addCat = () => {
    const label = newCat.trim();
    if (label.length < 2) return;
    setCats([
      ...cats,
      {
        id: newCategoryId(cats.map((c) => c.id)),
        label,
        active: true,
        urgent: false,
        fresh: true,
      },
    ]);
    setNewCat("");
  };
  const addPlat = () => {
    const label = newPlat.trim();
    if (label.length < 2) return;
    setPlats([...plats, { label, active: true }]);
    setNewPlat("");
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<Catalog>("settings/lists", {
        categories: cats.map(({ id, label, active, urgent }) => ({ id, label, active, urgent })),
        platforms: plats,
      });
      setCats(saved.categories.map((c) => ({ ...c })));
      setPlats(saved.platforms.map((p) => ({ ...p })));
      setNotice("تم حفظ القوائم. تظهر الآن في نموذج الشكوى ونموذج QR وطلبات الاسترجاع.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fn();
    }
  };

  return (
    <form className="lists-workspace" onSubmit={save}>
      <section className="panel">
        <div className="panel-head">
          <h2>
            <ListChecks size={18} /> أسباب الشكوى
          </h2>
          <span className="badge neutral">{n(cats.filter((c) => c.active).length)} مفعّل</span>
        </div>
        <div className="padded">
          <p className="hint">
            تظهر الأسباب المفعّلة بهذا الترتيب في نموذج تسجيل الشكوى ونموذج QR للعملاء، والأول هو
            الاختيار الافتراضي. الأسباب المستخدمة لا تُحذف؛ أوقفها لإخفائها مع بقاء الشكاوى السابقة
            كما هي. السبب «العاجل» يجعل الشكوى P1 تلقائياً.
          </p>
          <ul className="list-editor">
            {cats.map((c, i) => (
              <li key={c.id} className={c.active ? "" : "off"}>
                <Order
                  index={i}
                  count={cats.length}
                  name={c.label}
                  onMove={(to) => setCats(move(cats, i, to))}
                />
                <input
                  aria-label="اسم السبب"
                  value={c.label}
                  maxLength={60}
                  required
                  minLength={2}
                  onChange={(e) =>
                    setCats(cats.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={c.urgent}
                    onChange={(e) =>
                      setCats(
                        cats.map((x, j) => (j === i ? { ...x, urgent: e.target.checked } : x)),
                      )
                    }
                  />
                  عاجلة P1
                </label>
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
                  مفعّل
                </label>
                {c.fresh ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`إزالة ${c.label}`}
                    onClick={() => setCats(cats.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={16} />
                  </button>
                ) : (
                  <span className="list-editor-spacer" />
                )}
              </li>
            ))}
          </ul>
          <div className="list-editor-add">
            <input
              aria-label="سبب جديد"
              placeholder="سبب جديد، مثل: خطأ في الفاتورة"
              value={newCat}
              maxLength={60}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={onEnter(addCat)}
            />
            <button type="button" className="secondary" onClick={addCat}>
              <Plus size={16} /> إضافة سبب
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <ListChecks size={18} /> منصات الطلب
          </h2>
          <span className="badge neutral">{n(plats.filter((p) => p.active).length)} مفعّلة</span>
        </div>
        <div className="padded">
          <p className="hint">
            المنصات التي يختار منها الفريق والعميل مصدر الطلب، مثل تطبيقات التوصيل أو الطلب من
            الفرع.
          </p>
          <ul className="list-editor">
            {plats.map((p, i) => (
              <li key={i} className={p.active ? "" : "off"}>
                <Order
                  index={i}
                  count={plats.length}
                  name={p.label}
                  onMove={(to) => setPlats(move(plats, i, to))}
                />
                <input
                  aria-label="اسم المنصة"
                  value={p.label}
                  maxLength={60}
                  required
                  minLength={2}
                  onChange={(e) =>
                    setPlats(plats.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={p.active}
                    onChange={(e) =>
                      setPlats(
                        plats.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)),
                      )
                    }
                  />
                  مفعّلة
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`حذف ${p.label}`}
                  onClick={() => setPlats(plats.filter((_, j) => j !== i))}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          <div className="list-editor-add">
            <input
              aria-label="منصة جديدة"
              placeholder="منصة جديدة، مثل: نون فود"
              value={newPlat}
              maxLength={60}
              onChange={(e) => setNewPlat(e.target.value)}
              onKeyDown={onEnter(addPlat)}
            />
            <button type="button" className="secondary" onClick={addPlat}>
              <Plus size={16} /> إضافة منصة
            </button>
          </div>
        </div>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="form-footer">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : "حفظ القوائم"}
        </button>
      </div>
    </form>
  );
}
