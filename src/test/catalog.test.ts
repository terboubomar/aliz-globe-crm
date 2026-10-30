import { describe, expect, it } from "vitest";
import {
  CATEGORY_ID,
  DEFAULT_CATEGORIES,
  DEFAULT_PLATFORMS,
  categoryLabel,
  asksDetail,
  SUGGESTED_CATEGORIES,
  newCategoryId,
  toCatalog,
} from "@/lib/catalog";

describe("complaint reasons and order platforms", () => {
  it("starts from the default lists, with food safety urgent", () => {
    const c = toCatalog(undefined, undefined);
    expect(c.categories.map((x) => x.id)).toEqual(DEFAULT_CATEGORIES.map((x) => x.id));
    expect(c.categories.find((x) => x.id === "SAFETY")?.urgent).toBe(true);
    expect(c.platforms).toEqual(DEFAULT_PLATFORMS);
  });

  it("keeps the team's reasons and still knows built-in ones for older complaints", () => {
    const c = toCatalog(
      [
        { id: "C_BILL01", label: "  خطأ   في الفاتورة ", active: true, urgent: false },
        { id: "bad id", label: "x" },
      ],
      [{ label: "نون فود", active: true }, { label: "" }],
    );
    expect(c.categories[0]).toEqual({
      id: "C_BILL01",
      label: "خطأ في الفاتورة",
      active: true,
      urgent: false,
    });
    // Built-ins the team did not keep stay known, but switched off.
    const delay = c.categories.find((x) => x.id === "DELAY")!;
    expect(delay.active).toBe(false);
    expect(categoryLabel(c, "DELAY")).toBe("تأخر الطلب");
    expect(c.categories.some((x) => x.id === "bad id")).toBe(false);
    expect(c.platforms).toEqual([{ label: "نون فود", active: true }]);
    // An empty saved platform list stays empty.
    expect(toCatalog(undefined, []).platforms).toEqual([]);
  });

  it("makes new reason ids that are valid and unique", () => {
    const id = newCategoryId(["C_AAAAAA"]);
    expect(CATEGORY_ID.test(id)).toBe(true);
    expect(id).not.toBe("C_AAAAAA");
  });
});

describe("other", () => {
  it("is the reason that asks for details, and suggestions no longer include اقتراح", () => {
    expect(asksDetail({ id: "OTHER", label: "أخرى" })).toBe(true);
    expect(asksDetail({ id: "C_X12345", label: "أخرى" })).toBe(true);
    expect(asksDetail({ id: "DELAY", label: "تأخر الطلب" })).toBe(false);
    expect(SUGGESTED_CATEGORIES.some((s) => s.label === "اقتراح")).toBe(false);
    // Saved lists that still carry a group from before are read without it.
    const c = toCatalog([{ id: "DELAY", label: "تأخر الطلب", active: true, group: "x" }], []);
    expect(c.categories[0]).toEqual({
      id: "DELAY",
      label: "تأخر الطلب",
      active: true,
      urgent: false,
    });
  });
});
