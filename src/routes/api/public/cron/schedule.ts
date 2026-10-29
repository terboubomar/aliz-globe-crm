import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Weekly run: keeps the next weeks of the staff rotation scheduled even if
// nobody signs in. Only callable with the project's cron secret.
export const Route = createFileRoute("/api/public/cron/schedule")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { ensureUpcoming } = await import("@/functions/rotation.server");
        return Response.json({ weeks: await ensureUpcoming() });
      },
    },
  },
});
