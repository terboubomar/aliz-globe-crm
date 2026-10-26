import { createFileRoute } from "@tanstack/react-router";

// Telegram bot webhook. Disabled until TELEGRAM_WEBHOOK_SECRET is configured; checks the secret-token header.
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
        // Staff linking/alerts are not yet ported; acknowledge without storing or echoing the update.
        return new Response(null, { status: 200 });
      },
    },
  },
});
