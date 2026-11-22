import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DomainError, authorize, can } from "@/lib/domain";

/*
 * The shared WhatsApp inbox: staff who contact customers read the WhatsApp
 * conversations held in Bevatel and reply from the CRM. Every reply is
 * written to the audit log with who sent it.
 */
const core = () => import("./core.server");
const inbox = () => import("./inbox.server");
const id = z.string().regex(/^\d{1,12}$/);
// New chats are assigned while staff have the inbox open (at most every 30 s
// per server) and by the every-few-minutes job.
let lastAutoAssign = 0;

async function staff(context: unknown) {
  const c = await core();
  const a = await c.requireActor(context as never);
  authorize(a, "contact");
  const w = await import("./whatsapp.server");
  if (w.missingBevatel(false).length)
    throw new DomainError(
      "NOT_CONFIGURED",
      400,
      "واتساب غير مربوط بعد. أكمل إعداد Bevatel من الإعدادات.",
    );
  return { c, a };
}
/** Bevatel's technical errors become one plain message; our own messages pass through. */
async function bevatel<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const { BevatelError } = await import("./whatsapp.server");
    if (e instanceof BevatelError) {
      console.error("Bevatel inbox", e.message);
      throw new DomainError(
        "BEVATEL_FAILED",
        502,
        "تعذر الاتصال بـ Bevatel. حاول مرة أخرى بعد قليل.",
      );
    }
    if (e instanceof Error && e.name === "TimeoutError")
      throw new DomainError("BEVATEL_TIMEOUT", 504, "Bevatel لا يستجيب حالياً. حاول مرة أخرى.");
    throw e;
  }
}

export const inboxList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        status: z.enum(["open", "pending", "resolved", "all"]).default("open"),
        page: z.number().int().min(1).max(200).default(1),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await staff(context);
    const i = await inbox();
    if (
      data.status !== "resolved" &&
      data.status !== "pending" &&
      Date.now() - lastAutoAssign > 30_000
    ) {
      lastAutoAssign = Date.now();
      await i.assignNew();
    }
    const r = await bevatel(() => i.listConversations(data.status, data.page));
    const [conversations, people] = await Promise.all([
      i.withOwners(r.conversations),
      i.inboxStaff(),
    ]);
    return { ...r, conversations, people };
  });

export const inboxConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id, before: id.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await staff(context);
    const i = await inbox();
    const r = await bevatel(() => i.conversation(data.id, data.before ?? null));
    const [conversation] = await i.withOwners([r.conversation]);
    return { ...r, conversation: conversation! };
  });

export const inboxReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id, text: z.string().trim().min(1, "اكتب الرد").max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { c, a } = await staff(context);
    const message = await bevatel(async () => (await inbox()).reply(data.id, data.text));
    const db = await c.admin();
    await db.rpc("write_audit", { _actor: a.id, _action: "WHATSAPP_REPLY", _entity: data.id });
    return message;
  });

export const inboxSetStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id, status: z.enum(["open", "resolved"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { c, a } = await staff(context);
    await bevatel(async () => (await inbox()).setStatus(data.id, data.status));
    const db = await c.admin();
    await db.rpc("write_audit", {
      _actor: a.id,
      _action: data.status === "resolved" ? "WHATSAPP_RESOLVED" : "WHATSAPP_REOPENED",
      _entity: data.id,
    });
    return { ok: true };
  });

/**
 * Owner of a chat. Shift leads and managers (assign permission) give it to
 * anyone who answers customers, or clear it; an agent can only take an
 * unassigned chat for themselves.
 */
export const inboxAssign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id, to: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { c, a } = await staff(context);
    const i = await inbox();
    if (!can(a, "assign")) {
      const current = (await i.owners([data.id]))[data.id];
      if (data.to !== a.id || (current && current !== a.id))
        throw new DomainError("FORBIDDEN", 403, "يمكنك استلام المحادثات غير المسندة فقط");
    }
    const r = await bevatel(() => i.assignTo(data.id, data.to, a.id));
    const db = await c.admin();
    await db.rpc("write_audit", {
      _actor: a.id,
      _action: data.to ? "WHATSAPP_ASSIGNED" : "WHATSAPP_UNASSIGNED",
      _entity: data.id,
    });
    return r;
  });
