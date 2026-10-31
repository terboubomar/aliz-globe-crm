import { describe, expect, it } from "vitest";
import { orderHint, platformKind } from "@/lib/public-form";

describe("customer form order source", () => {
  it("tells the kind of each source", () => {
    expect(platformKind("الفرع مباشرة", "برقر واقف")).toBe("branch");
    expect(platformKind("طلب هاتف", "برقر واقف")).toBe("phone");
    expect(platformKind("أخرى", "برقر واقف")).toBe("other");
    expect(platformKind("تطبيق واقف", "برقر واقف")).toBe("brand-app");
    expect(platformKind("تطبيق العلامة", "شاورمن")).toBe("brand-app");
    expect(platformKind("هنقرستيشن", "برقر واقف")).toBe("app");
  });
  it("gives a hint for the order number", () => {
    expect(orderHint("جاهز", "app")).toContain("جاهز");
    expect(orderHint("الفرع مباشرة", "branch")).toContain("الفاتورة");
    expect(orderHint("", null)).toContain("تطبيق التوصيل");
  });
});
