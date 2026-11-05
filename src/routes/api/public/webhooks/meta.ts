import { createFileRoute } from "@tanstack/react-router";

// Meta webhook for Instagram DMs and Facebook Messenger. Inactive until
// META_APP_SECRET and META_VERIFY_TOKEN are configured. Every POST must carry
// a valid X-Hub-Signature-256 for the raw body before anything is read.
async function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = [
    ...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const given = header.slice(7);
  if (given.length !== sig.length) return false;
  let r = 0;
  for (let i = 0; i < sig.length; i++) r |= sig.charCodeAt(i) ^ given.charCodeAt(i);
  return r === 0;
}

export const Route = createFileRoute("/api/public/webhooks/meta")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = process.env["META_VERIFY_TOKEN"];
        if (!token) return new Response(null, { status: 503 });
        const u = new URL(request.url);
        if (
          u.searchParams.get("hub.mode") === "subscribe" &&
          u.searchParams.get("hub.verify_token") === token
        )
          return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
        return new Response(null, { status: 403 });
      },
      POST: async ({ request }) => {
        const secret = process.env["META_APP_SECRET"];
        if (!secret) return new Response(null, { status: 503 });
        const raw = await request.text();
        if (raw.length > 512_000) return new Response(null, { status: 413 });
        if (!(await validSignature(raw, request.headers.get("x-hub-signature-256"), secret)))
          return new Response(null, { status: 401 });
        try {
          const { receive } = await import("@/functions/meta.server");
          await receive(JSON.parse(raw));
        } catch {
          /* Acknowledge anyway so Meta does not retry a payload we cannot read. */
        }
        return new Response(null, { status: 200 });
      },
    },
  },
});
