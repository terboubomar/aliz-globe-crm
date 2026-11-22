import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Every few minutes: complaints and WhatsApp chats waiting because nobody was on
// shift go to the agents whose shift has started, and new Google reviews are fetched. Once an hour it also applies the data
// retention promised in the privacy notice. Only callable with the cron secret.
export const Route = createFileRoute("/api/public/cron/assign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { assignWaiting } = await import("@/functions/assign.server");
        const assigned = await assignWaiting();
        // New WhatsApp chats go to the agents on shift too (when WhatsApp is on).
        const { settings } = await import("@/functions/core.server");
        const { missingBevatel } = await import("@/functions/whatsapp.server");
        const whatsapp =
          (await settings()).whatsapp && !missingBevatel(false).length
            ? await (await import("@/functions/inbox.server")).assignNew()
            : 0;
        const { syncReviews } = await import("@/functions/google.server");
        const google = await syncReviews().catch((e: Error) => ({
          error: e.message.slice(0, 200),
        }));
        let retention = null;
        if (new Date().getUTCMinutes() < 5) {
          const { runRetention } = await import("@/functions/retention.server");
          retention = await runRetention();
        }
        return Response.json({ assigned, whatsapp, google, retention });
      },
    },
  },
});
