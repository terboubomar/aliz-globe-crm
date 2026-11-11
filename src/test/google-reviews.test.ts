import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  HOTLINE,
  aiMessages,
  cleanAi,
  decide,
  fillScript,
  readRules,
  starsOf,
} from "@/lib/google-reviews";

const connectedAt = "2026-11-04T10:00:00Z";
const on = { ...DEFAULT_RULES, enabled: true };

describe("Google review rules", () => {
  it("reads Google's star words", () => {
    expect(starsOf("FIVE")).toBe(5);
    expect(starsOf("ONE")).toBe(1);
    expect(starsOf(3)).toBe(3);
    expect(starsOf("STAR_RATING_UNSPECIFIED")).toBeNull();
    expect(starsOf(undefined)).toBeNull();
  });

  it("turns low reviews into complaints and answers by the star rule", () => {
    const low = decide(
      { stars: 1, createdAt: "2026-11-04T12:00:00Z", hasReply: false },
      on,
      connectedAt,
    );
    expect(low).toMatchObject({ history: false, complaint: true, priority: "P2" });
    expect(low.reply?.send).toBe("approve");

    const three = decide(
      { stars: 3, createdAt: "2026-11-04T12:00:00Z", hasReply: false },
      on,
      connectedAt,
    );
    expect(three).toMatchObject({ complaint: false, priority: "P3" });

    const two = decide(
      { stars: 2, createdAt: "2026-11-04T12:00:00Z", hasReply: false },
      on,
      connectedAt,
    );
    expect(two).toMatchObject({ complaint: true, priority: "P3" });

    const five = decide(
      { stars: 5, createdAt: "2026-11-04T12:00:00Z", hasReply: false },
      on,
      connectedAt,
    );
    expect(five.complaint).toBe(false);
    expect(five.reply).toMatchObject({ mode: "script", send: "auto" });
  });

  it("only records reviews from before the connection or already answered", () => {
    const old = decide(
      { stars: 1, createdAt: "2026-10-01T00:00:00Z", hasReply: false },
      on,
      connectedAt,
    );
    expect(old).toMatchObject({ history: true, complaint: false, reply: null });
    const answered = decide(
      { stars: 1, createdAt: "2026-11-05T00:00:00Z", hasReply: true },
      on,
      connectedAt,
    );
    expect(answered).toMatchObject({ history: true, complaint: false, reply: null });
  });

  it("does nothing automatic while switched off", () => {
    const d = decide(
      { stars: 1, createdAt: "2026-11-05T00:00:00Z", hasReply: false },
      DEFAULT_RULES,
      connectedAt,
    );
    expect(d).toMatchObject({ complaint: false, reply: null });
  });

  it("respects the complaint threshold and 'no reply' rules", () => {
    const rules = readRules({
      enabled: true,
      complaintMaxStars: 1,
      rules: { 2: { mode: "off", send: "auto", text: "" } },
    });
    const d = decide(
      { stars: 2, createdAt: "2026-11-05T00:00:00Z", hasReply: false },
      rules,
      connectedAt,
    );
    expect(d).toMatchObject({ complaint: false, reply: null });
  });

  it("falls back to defaults for malformed saved settings", () => {
    const r = readRules({
      enabled: "yes",
      complaintMaxStars: 9,
      rules: { 5: { mode: "shout", send: "now", text: 4 } },
    });
    expect(r.enabled).toBe(false);
    expect(r.complaintMaxStars).toBe(2);
    expect(r.rules[5]).toEqual(DEFAULT_RULES.rules[5]);
    expect(readRules(null)).toEqual(DEFAULT_RULES);
  });

  it("fills script placeholders and addresses anonymous reviewers politely", () => {
    const text = "شكراً {الاسم} على زيارة {الفرع} من {العلامة}، تواصل على {الرقم}";
    expect(fillScript(text, { reviewer: "سارة", brand: "واقف", branch: "برجر واقف - سيهات" })).toBe(
      "شكراً سارة على زيارة برجر واقف - سيهات من واقف، تواصل على " + HOTLINE,
    );
    expect(fillScript("أهلاً {الاسم}", { reviewer: "", brand: "واقف", branch: "" })).toBe(
      "أهلاً عميلنا العزيز",
    );
    expect(fillScript("{الفرع}", { reviewer: "x", brand: "واقف", branch: "" })).toBe("واقف");
  });

  it("never sends personal data to the AI", () => {
    const m = aiMessages({ stars: 2, comment: "الأكل بارد", brand: "واقف", branch: "سيهات" });
    const all = JSON.stringify(m);
    expect(all).toContain("الأكل بارد");
    expect(all).toContain(HOTLINE);
    expect(all).not.toContain("سارة");
  });

  it("cleans AI drafts: no markdown, links or other phone numbers", () => {
    const out = cleanAi(
      '"**شكراً {الاسم}!** زورونا https://x.com أو اتصل 0551234567 أو 920031754"',
    );
    expect(out).not.toMatch(/\*|https?:|0551234567|"/);
    expect(out).toContain(HOTLINE);
    expect(out.startsWith("شكراً")).toBe(true);
    expect(cleanAi("x".repeat(3000)).length).toBe(1500);
  });
});
