// Field encryption (AES-256-GCM) and keyed hashing, replacing source apps/api/src/crypto.ts.
// Uses WebCrypto so it runs on the edge runtime. Key comes from the APP_ENCRYPTION_KEY secret.
const enc = new TextEncoder();
const dec = new TextDecoder();
let aesKey: Promise<CryptoKey> | null = null;
let hmacKey: Promise<CryptoKey> | null = null;

function secret() {
  const s = process.env["APP_ENCRYPTION_KEY"];
  if (!s || s.length < 32) throw new Error("ENCRYPTION_NOT_CONFIGURED");
  return s;
}
async function derive(label: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(label + ":" + secret())));
}
function getAes() {
  aesKey ??= derive("aes").then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  return aesKey;
}
function getHmac() {
  hmacKey ??= derive("hmac").then((raw) =>
    crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  );
  return hmacKey;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u: ArrayBuffer) => [...new Uint8Array(u)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function encrypt(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getAes(), enc.encode(plain)));
  return "v1:" + b64(iv) + ":" + b64(ct);
}
export async function decrypt(value: string) {
  const [v, iv, ct] = value.split(":");
  if (v !== "v1" || !iv || !ct) throw new Error("UNKNOWN_CIPHER");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await getAes(), unb64(ct)));
}
/** Keyed hash for lookups (tokens, phone numbers) so raw values are never stored. */
export async function keyedHash(value: string) {
  return hex(await crypto.subtle.sign("HMAC", await getHmac(), enc.encode(value)));
}
export async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}
export function randomToken(bytes = 24) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
