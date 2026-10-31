import {
  Bike,
  Check,
  CircleAlert,
  Clock,
  Hourglass,
  MapPinOff,
  MoreHorizontal,
  Package,
  PackageMinus,
  Phone,
  Receipt,
  ShieldAlert,
  Shuffle,
  Smartphone,
  Sparkles,
  Store,
  Thermometer,
  UserRound,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { platformKind } from "@/lib/public-form";

/*
 * The two pickers of the customer (QR) complaint form: the complaint reason as
 * cards with an icon, and the order source as tiles. Both lists come from
 * Settings → Lists, so the icons are chosen from the reason's id or words, with
 * a neutral icon for anything new.
 */

const REASON_IDS: Record<string, LucideIcon> = {
  DELAY: Clock,
  MISSING: PackageMinus,
  WRONG_BRANCH: MapPinOff,
  QUALITY: UtensilsCrossed,
  SAFETY: ShieldAlert,
  SERVICE: UserRound,
  OTHER: MoreHorizontal,
};

const REASON_WORDS: [RegExp, LucideIcon][] = [
  [/أخرى/, MoreHorizontal],
  [/تأخ|انتظار|وقت/, Hourglass],
  [/ناقص|الكمية|لم يصل/, PackageMinus],
  [/خاطئ|خطأ في الطلب|ملاحظات/, Shuffle],
  [/بارد|حرارة/, Thermometer],
  [/تغليف|انسكاب/, Package],
  [/فاتورة|سعر|خصم|عرض|مبلغ|مخصوم/, Receipt],
  [/مندوب|توصيل|العنوان/, Bike],
  [/سلامة|تسمم|حساسية|غريب|رائحة|مطهو/, ShieldAlert],
  [/نظافة/, Sparkles],
  [/موظف|تعامل|خدمة/, UserRound],
  [/مغلق|فرع/, Store],
  [/تطبيق|إلكتروني/, Smartphone],
  [/طعام|جودة|طعم/, UtensilsCrossed],
];

function reasonIcon(reason: { id: string; label: string }): LucideIcon {
  return (
    REASON_IDS[reason.id] ?? REASON_WORDS.find(([re]) => re.test(reason.label))?.[1] ?? CircleAlert
  );
}

export function ReasonCards({
  reasons,
  value,
  onChange,
}: {
  reasons: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="qf-reasons" role="radiogroup" aria-label="سبب البلاغ">
      {reasons.map((r) => {
        const Icon = reasonIcon(r);
        const on = value === r.id;
        return (
          <label key={r.id} className={"qf-reason" + (on ? " on" : "")}>
            <input
              type="radio"
              name="category"
              value={r.id}
              checked={on}
              onChange={() => onChange(r.id)}
            />
            <span className="qf-reason-icon" aria-hidden="true">
              <Icon size={22} strokeWidth={1.8} />
            </span>
            <span className="qf-reason-label">{r.label}</span>
            <span className="qf-tick" aria-hidden="true">
              <Check size={13} strokeWidth={3} />
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function PlatformTiles({
  platforms,
  brand,
  logo,
  value,
  onChange,
}: {
  platforms: string[];
  brand: string;
  logo: string;
  value: string;
  onChange: (p: string) => void;
}) {
  return (
    <div className="qf-platforms" role="radiogroup" aria-label="منصة الطلب">
      {platforms.map((p) => {
        const kind = platformKind(p, brand);
        const on = value === p;
        return (
          <label key={p} className={"qf-platform" + (on ? " on" : "")}>
            <input
              type="radio"
              name="platform"
              value={p}
              checked={on}
              // Tapping the chosen source again clears it (the step is optional).
              onClick={() => on && onChange("")}
              onChange={() => onChange(p)}
            />
            <span className={"qf-platform-mark " + kind} aria-hidden="true">
              {kind === "brand-app" ? (
                <img src={"/logos/" + logo} alt="" />
              ) : kind === "branch" ? (
                <Store size={20} strokeWidth={1.8} />
              ) : kind === "phone" ? (
                <Phone size={19} strokeWidth={1.8} />
              ) : kind === "other" ? (
                <MoreHorizontal size={20} strokeWidth={1.8} />
              ) : (
                <b>{p.trim().charAt(0)}</b>
              )}
            </span>
            <span className="qf-platform-label">{p}</span>
            <span className="qf-tick" aria-hidden="true">
              <Check size={12} strokeWidth={3} />
            </span>
          </label>
        );
      })}
    </div>
  );
}
