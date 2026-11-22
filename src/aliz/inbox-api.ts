// The WhatsApp inbox's calls to the server (direct server functions).
import {
  inboxAssign,
  inboxConversation,
  inboxList,
  inboxReply,
  inboxSetStatus,
} from "@/functions/inbox.functions";
import type { InboxConversation, InboxMessage, Staff } from "@/functions/inbox.server";

export type { InboxConversation, InboxMessage, Staff };
export type InboxFilter = "open" | "pending" | "resolved" | "all";

const message = (e: unknown) => {
  const m = (e as Error)?.message ?? "";
  try {
    const list = JSON.parse(m) as { message?: string }[];
    if (Array.isArray(list) && list[0]?.message) return list[0].message;
  } catch {
    /* plain message */
  }
  return m || "تعذر إكمال الطلب";
};
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw new Error(message(e));
  }
}

export const inboxApi = {
  list: (status: InboxFilter, page = 1) =>
    call(
      () =>
        inboxList({ data: { status, page } }) as Promise<{
          conversations: InboxConversation[];
          total: number;
          people: Staff[];
        }>,
    ),
  open: (id: string, before?: string) =>
    call(
      () =>
        inboxConversation({ data: { id, ...(before ? { before } : {}) } }) as Promise<{
          conversation: InboxConversation;
          messages: InboxMessage[];
          more: boolean;
        }>,
    ),
  reply: (id: string, text: string) =>
    call(() => inboxReply({ data: { id, text } }) as Promise<InboxMessage>),
  assign: (id: string, to: string | null) =>
    call(() => inboxAssign({ data: { id, to } }) as Promise<{ owner: string | null }>),
  setStatus: (id: string, status: "open" | "resolved") =>
    call(() => inboxSetStatus({ data: { id, status } })),
};
