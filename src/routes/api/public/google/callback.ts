import { createFileRoute } from "@tanstack/react-router";

// Google sends the admin back here after they allow access to the Business
// Profile. The one-time code is exchanged on the server; the browser is then
// returned to Settings with the result.
export const Route = createFileRoute("/api/public/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const { finishConnect } = await import("@/functions/google.server");
        const to = await finishConnect(
          url.searchParams.get("code") ?? "",
          url.searchParams.get("state") ?? "",
        ).catch(() => "/?view=settings&google=failed");
        return new Response(null, {
          status: 302,
          headers: { Location: to, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
