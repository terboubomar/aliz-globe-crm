import { describe, expect, it } from "vitest";
import { passkeyMessage, signedInWithPasskey } from "@/lib/passkey-errors";

describe("passkey sign-in", () => {
  it("counts a passkey session as two-step", () => {
    expect(signedInWithPasskey({ amr: [{ method: "passkey", timestamp: 1 }] })).toBe(true);
    expect(signedInWithPasskey({ amr: ["mfa/webauthn"] })).toBe(true);
    expect(signedInWithPasskey({ amr: [{ method: "password", timestamp: 1 }] })).toBe(false);
    expect(signedInWithPasskey({})).toBe(false);
  });
  it("explains failures in plain words", () => {
    expect(passkeyMessage({ name: "NotAllowedError" }, "signin")).toContain("إلغاء");
    expect(passkeyMessage({ code: "passkey_disabled" }, "register")).toContain("غير مفعّل");
    expect(passkeyMessage({ message: "x" }, "signin")).toContain("كلمة المرور");
  });
});
