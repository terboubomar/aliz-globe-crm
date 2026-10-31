/*
 * What the customer sees on the tracking page: four plain steps instead of the
 * team's internal states, and a short message for where the complaint is now.
 */

export const TRACK_STEPS = [
  "استلمنا بلاغك",
  "وصل للفريق المختص",
  "نعمل على الحل",
  "تم الحل",
] as const;

const STEP_OF: Record<string, number> = {
  NEW: 0,
  TRIAGED: 0,
  ASSIGNED: 1,
  ACKNOWLEDGED: 2,
  IN_PROGRESS: 2,
  RESOLVED: 3,
  CLOSED: 3,
};

/** The current step (0–3) and whether the last step is fully done. */
export function trackStep(state: string) {
  const step = STEP_OF[state] ?? 0;
  return { step, finished: state === "CLOSED" };
}

export function trackMessage(state: string): {
  title: string;
  body: string;
  tone: "work" | "done";
} {
  switch (state) {
    case "ASSIGNED":
      return {
        title: "وصل بلاغك للفريق المختص",
        body: "تم تحويل بلاغك للموظف المسؤول، وبيبدأ عليه قريباً.",
        tone: "work",
      };
    case "ACKNOWLEDGED":
    case "IN_PROGRESS":
      return {
        title: "نعمل على حل المشكلة",
        body: "الفريق يتابع بلاغك الآن، وبنتواصل معك إذا احتجنا أي تفاصيل.",
        tone: "work",
      };
    case "RESOLVED":
      return {
        title: "تم حل المشكلة",
        body: "بنتواصل معك للتأكد إن كل شيء تمام قبل إغلاق البلاغ.",
        tone: "done",
      };
    case "CLOSED":
      return {
        title: "تم إغلاق البلاغ",
        body: "شكراً لصبرك وثقتك، يسعدنا نخدمك دائماً.",
        tone: "done",
      };
    default:
      return {
        title: "استلمنا بلاغك",
        body: "بلاغك وصل لفريق خدمة العملاء، وبتتم مراجعته خلال دقائق.",
        tone: "work",
      };
  }
}
