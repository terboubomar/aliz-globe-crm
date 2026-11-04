/*
 * Google Business Profile reviews: the rules that decide, for each new review,
 * whether it becomes a complaint and how it is answered. Pure functions so the
 * server, the settings screen and the tests all share them.
 */

export type Stars = 1 | 2 | 3 | 4 | 5;
/** How the reply text is written: none, a saved script, or drafted by AI. */
export type ReplyMode = "off" | "script" | "ai";
/** Whether the reply is posted straight away or waits for a staff member. */
export type SendMode = "auto" | "approve";
export type StarRule = { mode: ReplyMode; send: SendMode; text: string };
export type GoogleRules = {
  enabled: boolean;
  /** Reviews with this many stars or fewer become complaints (0 = never). */
  complaintMaxStars: 0 | 1 | 2 | 3 | 4;
  rules: Record<Stars, StarRule>;
};

export const STARS: Stars[] = [5, 4, 3, 2, 1];
export const MAX_SCRIPT = 1000;
// Google allows longer replies, but short answers read better on Maps.
export const MAX_REPLY = 1500;
export const HOTLINE = "920031754";

export const PLACEHOLDERS = ["{الاسم}", "{العلامة}", "{الفرع}", "{الرقم}"] as const;

export const DEFAULT_RULES: GoogleRules = {
  enabled: false,
  complaintMaxStars: 3,
  rules: {
    5: {
      mode: "script",
      send: "auto",
      text: "شكراً جزيلاً {الاسم} على تقييمك الرائع! سعداء إن تجربتك في {العلامة} أعجبتك، ونتطلع لزيارتك القادمة 🌟",
    },
    4: {
      mode: "script",
      send: "auto",
      text: "شكراً {الاسم} على تقييمك ووقتك. يسعدنا إن تجربتك كانت جميلة، ونسعى نكون عند حسن ظنك دائماً في {العلامة}.",
    },
    3: {
      mode: "script",
      send: "approve",
      text: "شكراً {الاسم} على ملاحظاتك. نبي نسمع منك أكثر عشان نحسن تجربتك في {الفرع}، تواصل معنا على الرقم الموحد {الرقم}.",
    },
    2: {
      mode: "script",
      send: "approve",
      text: "نعتذر منك {الاسم} على تجربتك في {الفرع}. تم رفع ملاحظتك لفريق خدمة العملاء، ونتمنى تتواصل معنا على {الرقم} حتى نخدمك بشكل أفضل.",
    },
    1: {
      mode: "script",
      send: "approve",
      text: "نأسف جداً {الاسم} على اللي صار، وهذا ما يمثل مستوانا في {العلامة}. تم رفع الموضوع للإدارة، ونرجو التواصل معنا على {الرقم} لنعالج المشكلة مباشرة.",
    },
  },
};

const WORD: Record<string, Stars> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
/** Google sends star ratings as words ("FOUR"); unknown values give null. */
export function starsOf(value: unknown): Stars | null {
  if (typeof value === "number" && value >= 1 && value <= 5) return Math.round(value) as Stars;
  return typeof value === "string" ? (WORD[value] ?? null) : null;
}

/** Merges saved settings over the defaults, dropping anything malformed. */
export function readRules(saved: unknown): GoogleRules {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<GoogleRules>;
  const max = s.complaintMaxStars;
  const rules = { ...DEFAULT_RULES.rules };
  for (const star of STARS) {
    const r = (s.rules as Record<string, Partial<StarRule>> | undefined)?.[star];
    if (!r) continue;
    rules[star] = {
      mode: r.mode === "off" || r.mode === "ai" || r.mode === "script" ? r.mode : rules[star].mode,
      send: r.send === "auto" || r.send === "approve" ? r.send : rules[star].send,
      text: typeof r.text === "string" ? r.text.slice(0, MAX_SCRIPT) : rules[star].text,
    };
  }
  return {
    enabled: s.enabled === true,
    complaintMaxStars:
      max === 0 || max === 1 || max === 2 || max === 3 || max === 4
        ? max
        : DEFAULT_RULES.complaintMaxStars,
    rules,
  };
}

export type ReviewFacts = { reviewer: string; brand: string; branch: string };

/** Fills a script's placeholders. An anonymous reviewer is addressed politely. */
export function fillScript(text: string, f: ReviewFacts) {
  const name =
    f.reviewer.trim() && !/^(a google user|مستخدم google)$/i.test(f.reviewer.trim())
      ? f.reviewer.trim()
      : "عميلنا العزيز";
  return text
    .replaceAll("{الاسم}", name)
    .replaceAll("{العلامة}", f.brand)
    .replaceAll("{الفرع}", f.branch || f.brand)
    .replaceAll("{الرقم}", HOTLINE)
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_REPLY);
}

export type Decision = {
  /** Older than the connection, or already answered on Google: kept for the record only. */
  history: boolean;
  complaint: boolean;
  priority: "P2" | "P3";
  reply: StarRule | null;
};

export function decide(
  r: { stars: Stars; createdAt: string; hasReply: boolean },
  rules: GoogleRules,
  connectedAt: string,
): Decision {
  const history = r.hasReply || +new Date(r.createdAt) < +new Date(connectedAt);
  const complaint = !history && rules.enabled && r.stars <= rules.complaintMaxStars;
  const rule = rules.rules[r.stars];
  return {
    history,
    complaint,
    priority: r.stars === 1 ? "P2" : "P3",
    reply: !history && rules.enabled && rule.mode !== "off" ? rule : null,
  };
}

/** Instructions for the AI that drafts a reply. Personal data is never sent. */
export function aiMessages(r: { stars: Stars; comment: string; brand: string; branch: string }) {
  const low = r.stars <= 3;
  return [
    {
      role: "system",
      content: [
        `أنت مسؤول خدمة العملاء في مطعم «${r.brand}» في السعودية، وتكتب رداً علنياً على تقييم في خرائط Google.`,
        "اكتب بالعربية بلهجة سعودية مهذبة وقريبة، في جملتين إلى أربع جمل، بدون عناوين أو تنسيق أو علامات تنصيص.",
        "لا تذكر أسماء موظفين، ولا تعد بتعويض أو مبلغ، ولا تعترف بخطأ قانوني، ولا تضع روابط.",
        "ابدأ بـ {الاسم} كما هو حرفياً ليُستبدل باسم العميل.",
        low
          ? `اعتذر بلطف عن التجربة، وأوضح أن الملاحظة وصلت للفريق، وادعُ العميل للتواصل على الرقم الموحد ${HOTLINE}.`
          : "اشكر العميل على تقييمه بطريقة طبيعية غير مكررة، وادعُه لزيارة قادمة.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `عدد النجوم: ${r.stars} من 5\nالفرع: ${r.branch || r.brand}\nنص التقييم: ${r.comment.trim() || "(بدون نص)"}`,
    },
  ];
}

/** Tidies an AI draft: no markdown, links or extra phone numbers; capped length. */
export function cleanAi(text: string) {
  return text
    .replace(/[*_#`>]+/g, "")
    .replace(/^["«“'\s]+|["»”'\s]+$/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\+?\d[\d\s-]{7,}\d/g, (m) => (m.replace(/\D/g, "") === HOTLINE ? m : HOTLINE))
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_REPLY);
}

export const replyStateLabels: Record<string, string> = {
  NONE: "بدون رد",
  DRAFT: "بانتظار الموافقة",
  SENT: "تم الرد",
  FAILED: "تعذر الإرسال",
  HISTORY: "قبل الربط",
};
