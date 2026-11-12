import { hasFullAccess } from "@/lib/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_REPLY, MAX_SCRIPT } from "@/lib/google-reviews";

// Google Business Profile reviews: settings for super admins, replies for the
// customer-service team. Every handler checks who is asking on the server.
const core = () => import("./core.server");
const google = () => import("./google.server");
const actor = async (context: unknown) => (await core()).requireActor(context as never);

const reviewId = z.string().regex(/^accounts\/\d+\/locations\/\d+\/reviews\/[\w-]{5,200}$/);
const starRule = z.object({
  mode: z.enum(["off", "script", "ai"]),
  send: z.enum(["auto", "approve"]),
  text: z.string().max(MAX_SCRIPT),
});

export const googleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await google()).status(await actor(context)));

export const googleConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await google()).beginConnect(await actor(context)));

export const googleDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await google()).disconnect(await actor(context)));

export const googleLocations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await google()).listLocations(await actor(context)));

export const googleLinkLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ branchId: z.string().uuid(), location: z.string().max(120).nullable() }).parse(d),
  )
  .handler(async ({ data, context }) =>
    (await google()).linkLocation(await actor(context), data.branchId, data.location),
  );

export const googleSaveRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        complaintMaxStars: z.union([
          z.literal(0),
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4),
        ]),
        rules: z.object({ 1: starRule, 2: starRule, 3: starRule, 4: starRule, 5: starRule }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => (await google()).saveRules(await actor(context), data));

export const googleSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const a = await actor(context);
    if (!hasFullAccess(a.role)) throw new Error("متاح لمدير النظام فقط");
    return (await google()).syncReviews();
  });

export const googleReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        filter: z.enum(["pending", "unanswered", "all"]).default("unanswered"),
        brandId: z.string().max(60).optional(),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => (await google()).listReviews(await actor(context), data));

export const googleReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: reviewId, text: z.string().min(2).max(MAX_REPLY) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    (await google()).replyReview(await actor(context), data.id, data.text),
  );

export const googleSuggest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: reviewId }).parse(d))
  .handler(async ({ data, context }) =>
    (await google()).suggestReply(await actor(context), data.id),
  );
