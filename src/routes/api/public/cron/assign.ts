import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Every few minutes: complaints waiting because nobody was on shift go to the
// agents whose shift has started. Only callable with the project's cron secret.
export const Route = createFileRoute("/api/public/cron/assign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { assignWaiting } = await import("@/functions/assign.server");
        return Response.json({ assigned: await assignWaiting() });
      },
    },
  },
});
