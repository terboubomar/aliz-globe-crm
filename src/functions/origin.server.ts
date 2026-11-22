// Server-only: the CRM's public address, used in every link we send to
// customers and staff (WhatsApp tracking links, Telegram buttons, receipts,
// the Google sign-in callback).

/** The CRM's own domain. */
export const CRM_ORIGIN = "https://care.alizglobe.cloud";

/**
 * PUBLIC_APP_ORIGIN when it is a public https address; the CRM's domain when it
 * is unset or still the old lovable.app address; "" when it is unsafe (http,
 * localhost, or with a user name), so callers can report it as missing.
 */
export function appOrigin(): string {
  const raw = (process.env["PUBLIC_APP_ORIGIN"] ?? "").trim();
  if (!raw) return CRM_ORIGIN;
  try {
    const u = new URL(raw);
    if (u.hostname.endsWith(".lovable.app")) return CRM_ORIGIN;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return u.protocol === "https:" && !local && !u.username && !u.password ? u.origin : "";
  } catch {
    return "";
  }
}
