import { describe, expect, it } from "vitest";
import { accountErrorMessage } from "@/lib/auth-errors";

// The add-user form used to show only "تعذر إنشاء الحساب". Each fixable cause
// now gets its own message, and unknown ones keep the provider's code.
describe("account error messages", () => {
  it("explains rejected passwords", () => {
    expect(accountErrorMessage({ code: "weak_password", reasons: ["pwned"] })).toContain("تسريبات");
    expect(accountErrorMessage({ code: "weak_password", reasons: ["characters"] })).toContain(
      "حرف كبير",
    );
    expect(accountErrorMessage({ code: "weak_password", reasons: ["length"] })).toContain("12");
  });

  it("explains used and unaccepted email addresses", () => {
    expect(accountErrorMessage({ code: "email_exists" })).toContain("مسجل مسبقاً");
    expect(accountErrorMessage({ code: "email_address_invalid" })).toContain("غير مقبول");
  });

  it("keeps the code for anything unexpected", () => {
    expect(accountErrorMessage({ code: "unexpected_failure" })).toContain("(unexpected_failure)");
    expect(accountErrorMessage(null)).toContain("(UNKNOWN)");
  });
});
