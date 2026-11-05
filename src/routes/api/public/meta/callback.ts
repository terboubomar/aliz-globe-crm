import { createFileRoute } from "@tanstack/react-router";

// Facebook sends the admin back here after they choose the Pages to connect.
// The one-time code is exchanged on the server; the browser returns to Settings.
export const Route = createFileRoute("/api/public/meta/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const { finishConnect } = await import("@/functions/meta.server");
        const to = await finishConnect(
          url.searchParams.get("code") ?? "",
          url.searchParams.get("state") ?? "",
        ).catch(() => "/?view=settings&meta=failed");
        return new Response(null, {
          status: 302,
          headers: { Location: to, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
