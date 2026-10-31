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

describe("order source logos", () => {
  it("finds the logo by Arabic or English name", async () => {
    const { platformLogo } = await import("@/lib/public-form");
    expect(platformLogo("هنقرستيشن")).toBe("/platforms/hungerstation.webp");
    expect(platformLogo("Talabat")).toBe("/platforms/talabat.webp");
    expect(platformLogo("Locate")).toBe("/platforms/locate.webp");
    expect(platformLogo("ذا شفز")).toBe("/platforms/thechefz.webp");
    expect(platformLogo("تطبيق واقف")).toBe("/platforms/waqf-app.webp");
    expect(platformLogo("الفرع مباشرة")).toBeUndefined();
    expect(platformLogo("طلب هاتف")).toBeUndefined();
  });
});
