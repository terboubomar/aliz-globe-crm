import { describe, expect, it } from "vitest";
import { fill, matching, type ReplyTemplate } from "@/lib/reply-templates";
import { word } from "@/lib/telegram-words";

const t = (id: string, over: Partial<ReplyTemplate> = {}): ReplyTemplate => ({
  id,
  title: id,
  text: "نص",
  actions: [],
  categories: [],
  brandIds: [],
  ...over,
});

describe("reply templates", () => {
  it("shows only templates for this action, category and brand, most specific first", () => {
    const list = [
      t("general"),
      t("resolve-only", { actions: ["resolve"] }),
      t("delay-waqf", { actions: ["comment"], categories: ["DELAY"], brandIds: ["waqf"] }),
      t("other-brand", { brandIds: ["other"] }),
    ];
    expect(
      matching(list, { action: "comment", category: "DELAY", brandId: "waqf" }).map((x) => x.id),
    ).toEqual(["delay-waqf", "general"]);
    expect(
      matching(list, { action: "resolve", category: "MISSING", brandId: "waqf" }).map((x) => x.id),
    ).toEqual(["resolve-only", "general"]);
  });

  it("fills the placeholders", () => {
    expect(
      fill("الشكوى {رقم_الشكوى} في {الفرع} ({العلامة}) — {اسمي}", {
        number: "AG-1",
        brand: "واقف",
        branch: "العليا",
        me: "إيناس",
      }),
    ).toBe("الشكوى AG-1 في العليا (واقف) — إيناس");
  });
});

describe("telegram wording", () => {
  it("uses the saved text, the default when empty, and fills the stage", () => {
    expect(word({}, "assigned")).toBe("تم إسناد شكوى إليك");
    expect(word({ assigned: "  " }, "assigned")).toBe("تم إسناد شكوى إليك");
    expect(word({ assigned: "لديك شكوى جديدة" }, "assigned")).toBe("لديك شكوى جديدة");
    expect(word({}, "deadlineWarn", { المرحلة: "الاستلام" })).toBe(
      "اقتربت مهلة الاستلام لشكوى مسندة إليك",
    );
    expect(word({}, "assignedNote")).toBe("");
  });
});
