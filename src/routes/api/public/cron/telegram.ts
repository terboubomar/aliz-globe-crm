import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Hourly run: shift reminders, Saturday's next-week schedule and the 09:00
// summary for super admins. Only callable with the project's cron secret.
export const Route = createFileRoute("/api/public/cron/telegram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { runScheduled } = await import("@/functions/telegram.server");
        return Response.json(await runScheduled());
      },
    },
  },
});
