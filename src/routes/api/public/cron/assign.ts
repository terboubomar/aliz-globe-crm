import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Every few minutes: complaints waiting because nobody was on shift go to the
// agents whose shift has started. Once an hour it also applies the data
// retention promised in the privacy notice. Only callable with the cron secret.
export const Route = createFileRoute("/api/public/cron/assign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { assignWaiting } = await import("@/functions/assign.server");
        const assigned = await assignWaiting();
        let retention = null;
        if (new Date().getUTCMinutes() < 5) {
          const { runRetention } = await import("@/functions/retention.server");
          retention = await runRetention();
        }
        return Response.json({ assigned, retention });
      },
    },
  },
});
