import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Link2, MapPin, RefreshCw, Search, Star, Unlink } from "lucide-react";
import { placesBranch, placesLink, placesSearch, placesStatus } from "@/functions/places.functions";
import { StarRow } from "./google-reviews";
import { Empty } from "./ui";
import { errorText, when } from "./whatsapp-integration";
import { n, type Data } from "./types";

/*
 * Google ratings and the latest reviews of each branch, read-only (Places API).
 * Staff read them here; replying happens in Google Maps through the link.
 */
type Status = Awaited<ReturnType<typeof placesStatus>>;
type Place = Awaited<ReturnType<typeof placesBranch>>;
type Match = Awaited<ReturnType<typeof placesSearch>>[number];

function usePlacesStatus() {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      placesStatus()
        .then((s) => {
          setStatus(s);
          setError("");
        })
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { status, error, load };
}

/* ------------------------- reviews page section ------------------------- */

export function PlacesReviews({ data, brand }: { data: Data; brand: string }) {
  const { status, error } = usePlacesStatus();
  if (error) return null;
  if (!status) return null;
  const linked = new Set(status.links.map((l) => l.branchId));
  const brands = data.brands.filter((b) => brand === "all" || b.id === brand);
  const branches = brands.flatMap((b) =>
    b.branches.filter((x) => linked.has(x.id)).map((x) => ({ ...x, brand: b })),
  );
  const unlinked = brands.flatMap((b) => b.branches.filter((x) => x.active && !linked.has(x.id)));
  return (
    <section className="panel places-reviews">
      <div className="panel-head">
        <h2>
          <MapPin size={19} /> تقييمات الفروع في خرائط Google
        </h2>
        <span className="badge neutral">قراءة فقط</span>
      </div>
      <div className="padded">
        {!status.configured ? (
          <Empty
            title="لم يُضف مفتاح Google Places بعد"
            detail="أضف السر GOOGLE_PLACES_API_KEY في Lovable ← Cloud ← Secrets، ثم اربط الفروع من الإعدادات ← التكاملات ← تقييمات Google."
          />
        ) : !branches.length ? (
          <Empty
            title="لم يُربط أي فرع بمكانه في خرائط Google"
            detail="اربط الفروع من الإعدادات ← التكاملات ← تقييمات Google ← «ربط الفروع بخرائط Google»."
          />
        ) : (
          <>
            <p className="hint">
              يعرض Google أحدث 5 تقييمات لكل فرع مع متوسط التقييم. للرد افتح التقييم في خرائط
              Google.
              {unlinked.length > 0 && (
                <>
                  <br />
                  {n(unlinked.length)} فرع غير مربوط بعد (اربطه من الإعدادات).
                </>
              )}
            </p>
            <div className="places-list">
              {branches.map((b) => (
                <BranchCard
                  key={b.id}
                  branchId={b.id}
                  title={b.name}
                  brandName={b.brand.name}
                  logo={b.brand.logo}
                  autoLoad={brand !== "all" || branches.length <= 6}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function BranchCard({
  branchId,
  title,
  brandName,
  logo,
  autoLoad,
}: {
  branchId: string;
  title: string;
  brandName: string;
  logo: string;
  autoLoad: boolean;
}) {
  const [place, setPlace] = useState<Place | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(
    async (fresh = false) => {
      setBusy(true);
      setError("");
      try {
        setPlace(await placesBranch({ data: { branchId, fresh } }));
      } catch (e) {
        setError(errorText(e));
      }
      setBusy(false);
    },
    [branchId],
  );
  useEffect(() => {
    if (autoLoad) void load();
  }, [autoLoad, load]);
  return (
    <article className="place-card">
      <header>
        <div className="place-title">
          {logo && <img src={"/logos/" + logo} alt="" />}
          <div>
            <b>{title}</b>
            <small>{brandName}</small>
          </div>
        </div>
        {place ? (
          <div className="place-score" aria-label={`التقييم ${place.rating ?? "—"} من 5`}>
            <b>{place.rating?.toFixed(1) ?? "—"}</b>
            <StarRow rating={Math.round(place.rating ?? 0)} />
            <small>{n(place.total)} تقييم</small>
          </div>
        ) : (
          <button className="secondary" disabled={busy} onClick={() => void load()}>
            <Star size={15} /> {busy ? "جارٍ التحميل…" : "عرض التقييم"}
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {place && (
        <>
          {place.reviews.length === 0 ? (
            <p className="hint">لا توجد تقييمات مكتوبة لهذا الفرع في Google.</p>
          ) : (
            <ul className="place-reviews">
              {place.reviews.map((r, i) => (
                <li key={(r.publishedAt ?? "") + i}>
                  <div className="place-review-head">
                    <StarRow rating={r.rating} size={13} />
                    <bdi className="place-author">{r.author}</bdi>
                    <time dateTime={r.publishedAt ?? undefined}>{r.when}</time>
                  </div>
                  {r.text && <p>{r.text}</p>}
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-btn">
                      <ExternalLink size={13} /> فتح في Google للرد
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <footer>
            {place.reviewsUrl && (
              <a href={place.reviewsUrl} target="_blank" rel="noreferrer" className="text-btn">
                <ExternalLink size={14} /> كل التقييمات في Google
              </a>
            )}
            <button className="text-btn" disabled={busy} onClick={() => void load(true)}>
              <RefreshCw size={14} /> تحديث
            </button>
            <small>
              من Google · <bdi>{when(place.fetchedAt)}</bdi>
            </small>
          </footer>
        </>
      )}
    </article>
  );
}

/* ----------------------- settings: link branches ----------------------- */

export function PlacesLinking({ data }: { data: Data }) {
  const { status, error, load } = usePlacesStatus();
  const [open, setOpen] = useState<string | null>(null);
  const canLink = data.me.role === "SUPER_ADMIN" || data.permissions.includes("branches.manage");
  if (!canLink) return null;
  const linked = new Map(status?.links.map((l) => [l.branchId, l.placeId]) ?? []);
  const rows = data.brands.flatMap((b) =>
    b.branches.filter((x) => x.active).map((x) => ({ ...x, brand: b })),
  );
  return (
    <section className="panel places-linking">
      <div className="panel-head">
        <h2>
          <MapPin size={19} /> ربط الفروع بخرائط Google (قراءة التقييمات)
        </h2>
        {status && (
          <span className={"badge " + (status.configured ? "green" : "neutral")}>
            {status.configured
              ? `${n(linked.size)} من ${n(rows.length)} مربوط`
              : "المفتاح غير مضاف"}
          </span>
        )}
      </div>
      <div className="padded">
        <p className="hint">
          يعمل دون انتظار موافقة Google: يعرض متوسط تقييم كل فرع وأحدث 5 تقييمات في صفحة «تقييمات
          Google». يحتاج السر GOOGLE_PLACES_API_KEY. ابحث عن الفرع واختر المكان الصحيح مرة واحدة.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {status && !status.configured && (
          <p className="notice">
            أضف GOOGLE_PLACES_API_KEY في Lovable ← Cloud ← Secrets ثم اضغط تحديث الصفحة.
          </p>
        )}
        {status?.configured && (
          <ul className="places-link-list">
            {rows.map((b) => (
              <li key={b.id}>
                <div className="places-link-row">
                  <div>
                    <b>{b.name}</b>
                    <small>
                      {b.brand.name} · {b.city}
                    </small>
                  </div>
                  {linked.has(b.id) ? (
                    <span className="badge green">
                      <Link2 size={12} /> مربوط
                    </span>
                  ) : (
                    <span className="badge neutral">غير مربوط</span>
                  )}
                  <button className="text-btn" onClick={() => setOpen(open === b.id ? null : b.id)}>
                    <Search size={14} /> {linked.has(b.id) ? "تغيير" : "بحث وربط"}
                  </button>
                  {linked.has(b.id) && <UnlinkButton branchId={b.id} onDone={() => void load()} />}
                </div>
                {open === b.id && (
                  <PlaceSearch
                    branchId={b.id}
                    initial={suggestQuery(b.brand.name, b.name, b.city)}
                    current={linked.get(b.id) ?? null}
                    onLinked={() => {
                      setOpen(null);
                      void load();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** "برجر واقف - الدمام" already names the brand and city; don't repeat them. */
export const suggestQuery = (brand: string, branch: string, city: string) =>
  [branch.includes(brand) ? "" : brand, branch, branch.includes(city) ? "" : city]
    .filter(Boolean)
    .join(" ");

function UnlinkButton({ branchId, onDone }: { branchId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="text-btn"
      disabled={busy}
      onClick={async () => {
        if (!confirm("إلغاء ربط هذا الفرع بمكانه في خرائط Google؟")) return;
        setBusy(true);
        await placesLink({ data: { branchId, placeId: null } }).catch(() => undefined);
        setBusy(false);
        onDone();
      }}
    >
      <Unlink size={14} /> إلغاء الربط
    </button>
  );
}

function PlaceSearch({
  branchId,
  initial,
  current,
  onLinked,
}: {
  branchId: string;
  initial: string;
  current: string | null;
  onLinked: () => void;
}) {
  const [query, setQuery] = useState(initial),
    [results, setResults] = useState<Match[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResults(await placesSearch({ data: { branchId, query } }));
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }
  useEffect(() => {
    void search();
    // Search once with the suggested name when the box opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function pick(placeId: string) {
    setBusy(true);
    setError("");
    try {
      await placesLink({ data: { branchId, placeId } });
      onLinked();
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }
  return (
    <div className="place-search">
      <form onSubmit={(e) => void search(e)}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="البحث عن الفرع في خرائط Google"
        />
        <button className="secondary" disabled={busy || query.trim().length < 2}>
          <Search size={14} /> بحث
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {results && results.length === 0 && <p className="hint">لا نتائج. جرّب اسماً أو حياً آخر.</p>}
      {results && results.length > 0 && (
        <ul>
          {results.map((r) => (
            <li key={r.placeId}>
              <div>
                <b>{r.name}</b>
                <small>{r.address}</small>
                <small>
                  {r.rating !== null
                    ? `★ ${r.rating.toFixed(1)} · ${n(r.total)} تقييم`
                    : "بلا تقييم"}
                </small>
              </div>
              {r.placeId === current ? (
                <span className="badge green">المكان الحالي</span>
              ) : (
                <button className="primary" disabled={busy} onClick={() => void pick(r.placeId)}>
                  <Link2 size={14} /> ربط
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
