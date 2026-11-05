import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_MESSAGE } from "@/lib/meta-inbox";

// Meta inbox: settings for super admins, the shared inbox for the
// customer-service team. Every handler checks who is asking on the server.
const core = () => import("./core.server");
const meta = () => import("./meta.server");
const actor = async (context: unknown) => (await core()).requireActor(context as never);
const threadId = z.string().regex(/^(FB|IG):\d{3,30}:\d{3,40}$/);

export const metaStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await meta()).status(await actor(context)));

export const metaConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await meta()).beginConnect(await actor(context)));

export const metaPageBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ pageId: z.string().regex(/^\d{3,30}$/), brandId: z.string().max(60).nullable() })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    (await meta()).setPageBrand(await actor(context), data.pageId, data.brandId),
  );

export const metaDisconnectPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ pageId: z.string().regex(/^\d{3,30}$/) }).parse(d))
  .handler(async ({ data, context }) =>
    (await meta()).disconnectPage(await actor(context), data.pageId),
  );

export const inboxThreads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        filter: z.enum(["open", "unread", "mine", "closed"]).default("open"),
        brandId: z.string().max(60).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => (await meta()).listThreads(await actor(context), data));

export const inboxUnread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await meta()).unreadCount(await actor(context)));

export const inboxThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: threadId }).parse(d))
  .handler(async ({ data, context }) => (await meta()).getThread(await actor(context), data.id));

export const inboxReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: threadId, text: z.string().min(1).max(MAX_MESSAGE) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    (await meta()).reply(await actor(context), data.id, data.text),
  );

export const inboxSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: threadId, change: z.enum(["take", "release", "close", "reopen"]) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    (await meta()).setThread(await actor(context), data.id, data.change),
  );

export const inboxConvert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: threadId,
        category: z.string().min(2).max(60),
        otherDetail: z.string().max(200).optional(),
        branchId: z.string().uuid().nullable(),
        unknownReason: z.string().max(300).optional(),
        priority: z.enum(["P1", "P2", "P3"]).default("P3"),
        phone: z.string().max(20).optional(),
        note: z.string().max(1500).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...input } = data;
    return (await meta()).convert(await actor(context), id, input);
  });
