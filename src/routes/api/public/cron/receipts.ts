import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Scheduled run (every few minutes): retries customer receipts that hit a rate
// limit, expires ones older than an hour, and marks unfinished sends as UNKNOWN.
// Only callable with the project's cron secret.
export const Route = createFileRoute("/api/public/cron/receipts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { runQueue } = await import("@/functions/receipts.server");
        const result = await runQueue();
        return Response.json(result);
      },
    },
  },
});
