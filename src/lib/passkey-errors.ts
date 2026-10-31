/* Plain Arabic messages for passkey (Face ID / Touch ID) failures. */

/**
 * Face ID / Touch ID sign-in is built but hidden: the hosting (Lovable Cloud)
 * does not offer passkeys in its auth settings yet. Set to true once it does.
 */
export const PASSKEYS_ENABLED = false;

export function passkeyMessage(e: unknown, when: "signin" | "register") {
  const err = (e ?? {}) as { name?: string; code?: string; message?: string; status?: number };
  const text = `${err.name ?? ""} ${err.code ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (/notallowed|cancel|abort|timed? ?out/.test(text)) return "تم إلغاء التحقق. حاول مرة أخرى.";
  if (/disabled|not enabled|not_enabled|feature/.test(text) || err.status === 404)
    return "الدخول بـ Face ID / Touch ID غير مفعّل على الخادم بعد. تواصل مع مسؤول النظام.";
  if (/invalidstate|already registered|exists/.test(text)) return "هذا الجهاز مسجّل مسبقاً لحسابك.";
  if (when === "signin")
    return "لم نتمكن من الدخول بالبصمة. إذا لم تفعّلها لهذا الحساب بعد، ادخل بكلمة المرور ثم فعّلها من قائمة الحساب.";
  return "تعذر تفعيل Face ID / Touch ID على هذا الجهاز. حاول مرة أخرى.";
}

/** Whether this device can do Face ID / Touch ID / Windows Hello for websites. */
export async function deviceSupportsPasskey() {
  try {
    const P = (
      globalThis as {
        PublicKeyCredential?: {
          isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
        };
      }
    ).PublicKeyCredential;
    return (
      !!P?.isUserVerifyingPlatformAuthenticatorAvailable &&
      (await P.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

/** A session signed in with a passkey counts as two-step: device + face/fingerprint. */
export function signedInWithPasskey(claims: Record<string, unknown>) {
  const amr = Array.isArray(claims["amr"]) ? (claims["amr"] as unknown[]) : [];
  return amr.some((m) => {
    const method = typeof m === "string" ? m : (m as { method?: unknown })?.method;
    return typeof method === "string" && /passkey|webauthn/i.test(method);
  });
}
