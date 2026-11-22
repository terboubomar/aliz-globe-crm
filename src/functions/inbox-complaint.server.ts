// Server-only: turning a WhatsApp chat into a complaint. AI reads the chat and
// suggests whether it is a complaint and its brand, branch and reason; the
// agent checks the suggestion and registers it. Suggestions are kept per chat
// and refreshed only when the customer has written something new.
import { type Actor, DomainError, saudiMobile } from "@/lib/domain";
import { admin, catalog } from "./core.server";
import { conversation, type InboxMessage } from "./inbox.server";
import { call } from "./whatsapp.server";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const env = (k: string) => (process.env[k] ?? "").trim();
export const aiAvailable = () => !!env("LOVABLE_API_KEY");

export type Suggestion = {
  isComplaint: boolean;
  summary: string;
  brandId: string | null;
  branchId: string | null;
  category: string | null;
  priority: "P1" | "P2" | "P3";
  externalOrder: string | null;
  platform: string | null;
};
type Lists = {
  brands: { id: string; name: string }[];
  branches: { id: string; name: string; city: string; brand_id: string }[];
  categories: { id: string; label: string; urgent?: boolean }[];
  platforms: string[];
};

async function lists(): Promise<Lists> {
  const db = await admin();
  const [{ data: brands }, { data: branches }, c] = await Promise.all([
    db.from("brands").select("id,name").eq("status", "ACTIVE"),
    db.from("branches").select("id,name,city,brand_id").eq("active", true),
    catalog(),
  ]);
  return {
    brands: (brands ?? []) as Lists["brands"],
    branches: (branches ?? []) as Lists["branches"],
    categories: c.categories.filter((x) => x.active && x.id !== "SUGGESTION"),
    platforms: c.platforms.filter((p) => p.active).map((p) => p.label),
  };
}

/** The chat as plain lines for the AI: customer and staff text only, newest last. */
export function chatText(messages: InboxMessage[]) {
  const lines = messages
    .filter((m) => (m.kind === "customer" || m.kind === "agent") && m.text.trim())
    .map((m) => `${m.kind === "customer" ? "العميل" : "الموظف"}: ${m.text.trim()}`);
  let text = lines.join("\n");
  // Keep the most recent part when the chat is long.
  if (text.length > 4000) text = text.slice(-4000);
  return text;
}

export function prompt(chat: string, l: Lists) {
  return [
    {
      role: "system",
      content: [
        "You read WhatsApp chats sent to the customer service of a Saudi restaurant group with several brands.",
        "Decide if the customer is making a complaint (a problem with food, an order, delivery, staff, hygiene or a branch).",
        "Questions, orders, bookings, catering requests, job applications and thanks are NOT complaints.",
        "Pick the brand, branch, reason and platform only from the lists, by id or exact label; use null when the chat does not say.",
        "Priority: P1 for food safety, health or injury; P2 for a clear problem with a paid order; P3 otherwise.",
        'Answer with JSON only: {"isComplaint":boolean,"summary":string,"brandId":string|null,"branchId":string|null,"category":string|null,"priority":"P1"|"P2"|"P3","externalOrder":string|null,"platform":string|null}.',
        "summary: one or two short sentences in Arabic describing the problem.",
        "externalOrder: the order number if the customer gave one.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "Brands (id | name):",
        ...l.brands.map((b) => `${b.id} | ${b.name}`),
        "",
        "Branches (id | brand id | name | city):",
        ...l.branches.map((b) => `${b.id} | ${b.brand_id} | ${b.name} | ${b.city}`),
        "",
        "Reasons (id | label):",
        ...l.categories.map((c) => `${c.id} | ${c.label}`),
        "",
        "Order platforms:",
        l.platforms.join("، "),
        "",
        "Chat:",
        chat,
      ].join("\n"),
    },
  ];
}

/** Reads the AI's answer and keeps only values that exist in our lists. */
export function parseSuggestion(raw: string, l: Lists): Suggestion | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  let branch = l.branches.find((b) => b.id === s(v["branchId"])) ?? null;
  let brandId = l.brands.find((b) => b.id === s(v["brandId"]))?.id ?? null;
  // A branch decides its brand; a branch of another brand is dropped.
  if (branch && brandId && branch.brand_id !== brandId) branch = null;
  if (branch && !brandId) brandId = branch.brand_id;
  const category = l.categories.find((c) => c.id === s(v["category"]))?.id ?? null;
  const urgent = l.categories.find((c) => c.id === category)?.urgent;
  const priority = urgent
    ? "P1"
    : ((["P1", "P2", "P3"] as const).find((p) => p === v["priority"]) ?? "P3");
  return {
    isComplaint: v["isComplaint"] === true,
    summary: (s(v["summary"]) ?? "").slice(0, 600),
    brandId,
    branchId: branch?.id ?? null,
    category,
    priority,
    externalOrder: (s(v["externalOrder"]) ?? "").replace(/[^\w#\-/]/g, "").slice(0, 100) || null,
    platform: l.platforms.find((p) => p === s(v["platform"])) ?? null,
  };
}

type Row = {
  suggestion: Suggestion | null;
  analyzed_message_id: string | null;
  ticket_id: string | null;
};
async function rowOf(id: string) {
  const db = await admin();
  const { data } = await db
    .from("whatsapp_complaints" as never)
    .select("suggestion,analyzed_message_id,ticket_id")
    .eq("conversation_id", id)
    .maybeSingle();
  return data as Row | null;
}
async function ticketRef(ticketId: string) {
  const db = await admin();
  const { data } = await db
    .from("tickets")
    .select("id,sequence,created_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (!data) return null;
  const { ticketNumber } = await import("@/lib/domain");
  return {
    id: data.id as string,
    number: ticketNumber(data.sequence as number, data.created_at as string),
  };
}

/**
 * The complaint already registered from this chat, or the AI's suggestion
 * (cached until the customer writes again). Never throws for AI failures.
 */
export async function suggestionFor(id: string, fetcher: typeof fetch = fetch) {
  const row = await rowOf(id);
  if (row?.ticket_id) {
    const ticket = await ticketRef(row.ticket_id);
    if (ticket) return { ticket, suggestion: null, ai: aiAvailable() };
  }
  const { messages } = await conversation(id, null, fetcher);
  const lastCustomer = [...messages].reverse().find((m) => m.kind === "customer");
  if (!lastCustomer) return { ticket: null, suggestion: null, ai: aiAvailable() };
  if (row?.suggestion && row.analyzed_message_id === lastCustomer.id)
    return { ticket: null, suggestion: row.suggestion, ai: aiAvailable() };
  if (!aiAvailable()) return { ticket: null, suggestion: null, ai: false };

  const l = await lists();
  const chat = chatText(messages);
  let suggestion: Suggestion | null = null;
  try {
    const res = await fetcher(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("LOVABLE_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: prompt(chat, l),
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const out = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      suggestion = parseSuggestion(out.choices?.[0]?.message?.content ?? "", l);
    }
  } catch {
    /* no suggestion this time; the agent can still register by hand */
  }
  if (suggestion) {
    const db = await admin();
    await db.from("whatsapp_complaints" as never).upsert(
      {
        conversation_id: id,
        suggestion,
        analyzed_message_id: lastCustomer.id,
        analyzed_at: new Date().toISOString(),
      } as never,
      { onConflict: "conversation_id" },
    );
  }
  return { ticket: null, suggestion, ai: true };
}

export type RegisterInput = {
  brandId: string;
  branchId: string | null;
  unknownReason?: string | undefined;
  category: string;
  otherDetail?: string | undefined;
  priority: "P1" | "P2" | "P3";
  description: string;
  externalOrder?: string | undefined;
  platform?: string | undefined;
};

/** Registers the chat as a complaint, with the customer's name and number from Bevatel. */
export async function register(
  id: string,
  input: RegisterInput,
  actor: Actor,
  fetcher: typeof fetch = fetch,
) {
  const row = await rowOf(id);
  if (row?.ticket_id) {
    const t = await ticketRef(row.ticket_id);
    if (t)
      throw new DomainError("ALREADY_REGISTERED", 409, `هذه المحادثة مسجلة كشكوى رقم ${t.number}`);
  }
  const { conversation: conv, messages } = await conversation(id, null, fetcher);
  const raw = conv.phone.replace(/[\s()-]/g, "");
  const phone = saudiMobile.test(raw) ? raw : "";
  const firstCustomer = messages.find((m) => m.kind === "customer" && m.at)?.at;
  const oldest = Date.now() - 29 * 86400000;
  const receivedAt = new Date(
    Math.max(firstCustomer ? +new Date(firstCustomer) : Date.now(), oldest),
  );
  const { createTicketCore } = await import("./tickets.server");
  const created = await createTicketCore(
    actor.id,
    {
      ...input,
      branchId: input.branchId,
      name: conv.name.slice(0, 100),
      phone,
      receivedAt: receivedAt.toISOString(),
      // The customer wrote to us on WhatsApp: send them the complaint number and tracking link.
      whatsappConsent: !!phone,
    },
    "whatsapp:" + id,
    undefined,
    actor,
    "WHATSAPP",
  );
  const ticketId = (created as { id?: string }).id;
  if (ticketId) {
    const db = await admin();
    await db.from("whatsapp_complaints" as never).upsert(
      {
        conversation_id: id,
        ticket_id: ticketId,
        registered_by: actor.id,
        registered_at: new Date().toISOString(),
      } as never,
      { onConflict: "conversation_id" },
    );
    // A private note in Bevatel, so the chat shows it was registered (best effort).
    await call(fetcher, "POST", `/conversations/${encodeURIComponent(id)}/messages`, {
      content: `تم تسجيل الشكوى رقم ${created.number} في نظام الشكاوى.`,
      message_type: "outgoing",
      private: true,
    }).catch(() => null);
  }
  return { id: ticketId ?? null, number: created.number };
}
