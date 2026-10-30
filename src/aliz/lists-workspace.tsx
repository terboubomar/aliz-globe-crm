import { useState, type FormEvent } from "react";
import { GripVertical, ListChecks, Plus, Trash2 } from "lucide-react";
import { newCategoryId, type Catalog, type CategoryItem, type PlatformItem } from "@/lib/catalog";
import { api, lists, n } from "./types";

const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

/**
 * Drag to reorder: hold the handle (⋮⋮) and move the row, with a mouse, finger
 * or pen. With the keyboard, focus the handle and use the up/down arrows.
 * The order here is the order in every form.
 */
function useDragSort(onMove: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const handle = (index: number, count: number, name: string) => ({
    type: "button" as const,
    className: "drag-handle",
    "aria-label": `اسحب لترتيب ${name} (الترتيب ${index + 1} من ${count})`,
    title: "اسحب لتغيير الترتيب",
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDragging(index);
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (dragging === null) return;
      const list = e.currentTarget.closest("ul");
      const row = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-drag-index]");
      if (!row || !list?.contains(row)) return;
      const to = Number(row.dataset["dragIndex"]);
      if (to !== dragging) {
        onMove(dragging, to);
        setDragging(to);
      }
    },
    onPointerUp: () => setDragging(null),
    onPointerCancel: () => setDragging(null),
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : -1;
      if (to < 0 || to >= count) return;
      e.preventDefault();
      onMove(index, to);
    },
  });
  const row = (index: number, off: boolean) => ({
    "data-drag-index": index,
    className: [off ? "off" : "", dragging === index ? "dragging" : ""].join(" ").trim(),
  });
  return { handle, row, dragging };
}

let uid = 0;
type PlatformRow = PlatformItem & { key: number };
const withKeys = (list: PlatformItem[]): PlatformRow[] => list.map((p) => ({ ...p, key: ++uid }));

/** Complaint reasons and order platforms, managed in Settings → Lists. */
export function ListsPanel() {
  const [cats, setCats] = useState<(CategoryItem & { fresh?: boolean })[]>(() =>
      lists.categories.map((c) => ({ ...c })),
    ),
    [plats, setPlats] = useState<PlatformRow[]>(() => withKeys(lists.platforms)),
    [newCat, setNewCat] = useState(""),
    [newPlat, setNewPlat] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const catDrag = useDragSort((from, to) => setCats((list) => move(list, from, to)));
  const platDrag = useDragSort((from, to) => setPlats((list) => move(list, from, to)));

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
    setPlats([...plats, ...withKeys([{ label, active: true }])]);
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
        platforms: plats.map(({ label, active }) => ({ label, active })),
      });
      setCats(saved.categories.map((c) => ({ ...c })));
      setPlats(withKeys(saved.platforms));
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
            كما هي. السبب «العاجل» يجعل الشكوى P1 تلقائياً. اسحب أي سطر من المقبض ⋮⋮ لتغيير ترتيبه.
          </p>
          <ul className="list-editor">
            {cats.map((c, i) => (
              <li key={c.id} {...catDrag.row(i, !c.active)}>
                <button {...catDrag.handle(i, cats.length, c.label)}>
                  <GripVertical size={16} />
                </button>
                <b className="list-position">{n(i + 1)}</b>
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
            المنصات التي يختار منها الفريق والعميل مصدر الطلب، بهذا الترتيب. اسحب أي سطر من المقبض
            ⋮⋮ ليظهر الأكثر استخداماً أولاً.
          </p>
          <ul className="list-editor">
            {plats.map((p, i) => (
              <li key={p.key} {...platDrag.row(i, !p.active)}>
                <button {...platDrag.handle(i, plats.length, p.label)}>
                  <GripVertical size={16} />
                </button>
                <b className="list-position">{n(i + 1)}</b>
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
