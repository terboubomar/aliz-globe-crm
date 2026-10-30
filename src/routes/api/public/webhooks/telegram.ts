import { createFileRoute } from "@tanstack/react-router";

// Telegram bot webhook. Disabled until TELEGRAM_WEBHOOK_SECRET is configured; checks the secret-token header.
// Handles account linking (/start <code>), the menu buttons and commands, and the
// "received" button under assignment alerts.
export const Route = createFileRoute("/api/public/webhooks/telegram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["TELEGRAM_WEBHOOK_SECRET"];
        if (!secret) return new Response(null, { status: 503 });
        const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (given.length !== secret.length) return new Response(null, { status: 401 });
        let r = 0;
        for (let i = 0; i < secret.length; i++) r |= secret.charCodeAt(i) ^ given.charCodeAt(i);
        if (r !== 0) return new Response(null, { status: 401 });
        const raw = await request.text();
        if (raw.length > 64_000) return new Response(null, { status: 413 });
        try {
          const { handleUpdate } = await import("@/functions/telegram.server");
          const reply = await handleUpdate(JSON.parse(raw));
          // Reply inside the webhook response, so no extra call to Telegram is needed.
          if (reply) return Response.json(reply);
        } catch {
          /* Malformed updates are acknowledged and ignored. */
        }
        return new Response(null, { status: 200 });
      },
    },
  },
});
