import { describe, expect, it } from "vitest";
import {
  CATEGORY_ID,
  DEFAULT_CATEGORIES,
  DEFAULT_PLATFORMS,
  categoryLabel,
  grouped,
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
      group: "",
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

describe("reason groups", () => {
  it("keeps each group together, in order of first appearance, ungrouped last", () => {
    const items = [
      { id: "A", group: "الطلب" },
      { id: "X", group: "" },
      { id: "B", group: "الجودة" },
      { id: "C", group: "الطلب" },
    ];
    expect(grouped(items).map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ["الطلب", ["A", "C"]],
      ["الجودة", ["B"]],
      ["", ["X"]],
    ]);
  });

  it("gives the built-in reasons a group", () => {
    const c = toCatalog(undefined, undefined);
    expect(c.categories.find((x) => x.id === "DELAY")?.group).toBe("مشكلة في الطلب");
    expect(c.categories.find((x) => x.id === "SAFETY")?.group).toBe("صحة وسلامة");
    // Saved before groups existed: built-ins get their usual group, others none.
    const old = toCatalog(
      [
        { id: "DELAY", label: "تأخر الطلب", active: true },
        { id: "C_NEW001", label: "سبب جديد", active: true },
      ],
      [],
    );
    expect(old.categories.map((x) => x.group).slice(0, 2)).toEqual(["مشكلة في الطلب", ""]);
  });
});
