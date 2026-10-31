import { describe, expect, it } from "vitest";
import { permissionsForRole } from "@/lib/domain";
import { canOpenView } from "@/aliz/access";
import {
  destinationHint,
  methodLabel,
  methodsForPlatform,
  normalizeIban,
  validIban,
} from "@/lib/refund-request";

describe("IT manager", () => {
  const perms = permissionsForRole("IT_MANAGER");

  it("works on refunds only, with no access to complaints or customer data", () => {
    expect(perms).toEqual(
      expect.arrayContaining(["refund.view", "refund.execute", "refund.notify", "evidence.view"]),
    );
    for (const p of ["read", "pii", "create", "refund.request", "refund.decide", "users.manage"])
      expect(perms).not.toContain(p);
  });

  it("sees only the refunds section", () => {
    const views = ["overview", "tickets", "refunds", "customers", "tasks", "schedule", "reports"];
    expect(views.filter((v) => canOpenView(v, perms, "IT_MANAGER"))).toEqual(["refunds"]);
  });
});

describe("refund destination", () => {
  it("accepts a valid Saudi IBAN with spaces and rejects bad ones", () => {
    expect(normalizeIban("sa03 8000 0000 6080 1016 7519")).toBe("SA0380000000608010167519");
    expect(validIban("SA03 8000 0000 6080 1016 7519")).toBe(true);
    expect(validIban("SA0480000000608010167519")).toBe(false); // wrong check digits
    expect(validIban("AE070331234567890123456")).toBe(false);
    expect(validIban("SA038000")).toBe(false);
  });

  it("shows only the last digits in alerts", () => {
    expect(
      destinationHint({ method: "BANK", holder: "Test", iban: "SA0380000000608010167519" }),
    ).toBe("تحويل بنكي لحساب العميل (ينتهي بـ 7519)");
    expect(destinationHint({ method: "WALLET", phone: "966500000123" })).toContain("0123");
  });
});

describe("refund methods per platform", () => {
  it("offers the wallet and a bank transfer everywhere, in each platform's order", () => {
    expect(methodsForPlatform("طلب هاتف")).toEqual(["WALLET", "BANK"]);
    expect(methodsForPlatform("تطبيق واقف")).toEqual(["APP_BANK", "WALLET"]);
    expect(methodsForPlatform("الفرع مباشرة")).toEqual(["WALLET", "BANK"]);
    expect(methodLabel("APP_BANK")).toContain("لوحة تحكم تطبيق واقف");
    expect(destinationHint({ method: "APP_BANK" })).toContain("برقم الطلب");
    expect(methodLabel("BANK", "طلب هاتف")).toBe("تحويل بنكي لحساب العميل");
  });
});
