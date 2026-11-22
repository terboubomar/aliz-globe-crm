import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canOpenView, hiddenViews } from "@/aliz/access";
import { permissionsForRole } from "@/lib/domain";

vi.mock("@/functions/core.server", () => ({ admin: vi.fn(), settings: vi.fn() }));
vi.mock("@/functions/crypto.server", () => ({ encrypt: vi.fn(), decrypt: vi.fn() }));

const inbox = () => import("@/functions/inbox.server");

const conv = (over: Record<string, unknown> = {}) => ({
  id: 41,
  inbox_id: 7,
  status: "open",
  unread_count: 2,
  can_reply: true,
  last_activity_at: 1795340000,
  meta: { sender: { name: "سارة", phone_number: "+966500000001" }, assignee: null },
  messages: [{ id: 900, content: "الطلب وصل بارد", message_type: 0, created_at: 1795340000 }],
  ...over,
});

type Call = { url: string; method: string; body: unknown };
function fakeBevatel(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace("https://chat.bevatel.com/api/v1/accounts/3", "");
    calls.push({
      url: path,
      method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const key = Object.keys(routes).find((k) => `${init.method} ${path}`.startsWith(k));
    if (!key) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

beforeEach(() => {
  vi.stubEnv("BEVATEL_API_TOKEN", "test-token");
  vi.stubEnv("BEVATEL_ACCOUNT_ID", "3");
  vi.stubEnv("BEVATEL_INBOX_ID", "7");
  vi.stubEnv("BEVATEL_BASE_URL", "https://chat.bevatel.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("reading conversations", () => {
  it("maps a Chatwoot conversation for the list", async () => {
    const { toConversation } = await inbox();
    expect(toConversation(conv())).toEqual({
      id: "41",
      status: "open",
      name: "سارة",
      phone: "+966500000001",
      unread: 2,
      canReply: true,
      lastAt: new Date(1795340000 * 1000).toISOString(),
      lastText: "الطلب وصل بارد",
      lastFromCustomer: true,
      assignee: null,
      owner: null,
    });
  });

  it("lists only the WhatsApp inbox, newest Bevatel shape", async () => {
    const { listConversations } = await inbox();
    const { fetcher, calls } = fakeBevatel({
      "GET /conversations?": {
        data: { meta: { all_count: 2 }, payload: [conv(), conv({ id: 42, inbox_id: 99 })] },
      },
    });
    const r = await listConversations("open", 1, fetcher);
    expect(r.conversations.map((c) => c.id)).toEqual(["41"]);
    expect(calls[0]!.url).toContain("inbox_id=7");
    expect(calls[0]!.url).toContain("status=open");
  });

  it("reads every page, not only Bevatel's first 10 chats", async () => {
    const { listMany } = await inbox();
    const page = (from: number, n: number) => ({
      data: {
        meta: { all_count: 23 },
        payload: Array.from({ length: n }, (_, i) => conv({ id: from + i })),
      },
    });
    const q = (p: number) =>
      `GET /conversations?inbox_id=7&status=open&assignee_type=all&page=${p}`;
    const { fetcher, calls } = fakeBevatel({
      [q(1)]: page(1, 10),
      // A chat that moved down while reading shows once.
      [q(2)]: page(10, 10),
      [q(3)]: page(20, 3),
    });
    const r = await listMany("open", 1, fetcher);
    expect(r.conversations).toHaveLength(22);
    expect(new Set(r.conversations.map((c) => c.id)).size).toBe(22);
    expect(r.nextPage).toBeNull();
    expect(calls).toHaveLength(3);

    const capped = await listMany("open", 1, fetcher, 2);
    expect(capped.nextPage).toBe(3);
  });

  it("never opens a conversation from another inbox", async () => {
    const { conversation } = await inbox();
    const { fetcher } = fakeBevatel({ "GET /conversations/42": conv({ id: 42, inbox_id: 99 }) });
    await expect(conversation("42", null, fetcher)).rejects.toThrow("المحادثة غير موجودة");
  });

  it("returns messages oldest first and marks the chat read", async () => {
    const { conversation } = await inbox();
    const { fetcher, calls } = fakeBevatel({
      "GET /conversations/41/messages": {
        payload: [
          {
            id: 902,
            content: "تم، نعتذر",
            message_type: 1,
            created_at: 1795340100,
            status: "read",
            sender: { name: "نورة" },
          },
          {
            id: 901,
            content: "",
            message_type: 0,
            created_at: 1795340050,
            attachments: [
              { file_type: "image", data_url: "https://chat.bevatel.com/a.jpg" },
              { file_type: "file", data_url: "javascript:alert(1)" },
            ],
          },
          {
            id: 903,
            content: "تذكير داخلي",
            message_type: 1,
            private: true,
            created_at: 1795340200,
          },
          { id: 904, content: "Conversation resolved", message_type: 2, created_at: 1795340300 },
        ],
      },
      "GET /conversations/41": conv(),
      "POST /conversations/41/update_last_seen": {},
    });
    const r = await conversation("41", null, fetcher);
    expect(r.messages.map((m) => [m.id, m.kind])).toEqual([
      ["901", "customer"],
      ["902", "agent"],
      ["903", "note"],
      ["904", "event"],
    ]);
    // Only https links are shown.
    expect(r.messages[0]!.attachments).toEqual([
      { type: "image", url: "https://chat.bevatel.com/a.jpg", thumb: null, name: null },
    ]);
    expect(calls.some((c) => c.url.endsWith("/update_last_seen"))).toBe(true);
  });
});

describe("replying", () => {
  it("sends an outgoing, public message", async () => {
    const { reply } = await inbox();
    const { fetcher, calls } = fakeBevatel({
      "POST /conversations/41/messages": {
        id: 950,
        content: "أهلاً سارة",
        message_type: 1,
        created_at: 1795340400,
        status: "sent",
      },
      "GET /conversations/41": conv(),
    });
    const m = await reply("41", "أهلاً سارة", fetcher);
    expect(m.kind).toBe("agent");
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      content: "أهلاً سارة",
      message_type: "outgoing",
      private: false,
    });
  });

  it("refuses after WhatsApp's 24-hour window, without calling Bevatel to send", async () => {
    const { reply } = await inbox();
    const { fetcher, calls } = fakeBevatel({ "GET /conversations/41": conv({ can_reply: false }) });
    await expect(reply("41", "مرحبا", fetcher)).rejects.toThrow("24 ساعة");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("who sees the inbox", () => {
  const sees = (role: string, whatsapp = true) =>
    canOpenView(
      "inbox",
      permissionsForRole(role),
      role,
      hiddenViews({ integrations: { whatsapp } }),
    );
  it("staff who contact customers, once WhatsApp is on", () => {
    for (const r of ["AGENT", "SHIFT_LEAD", "MARKETING_MANAGER", "SUPER_ADMIN", "CEO", "OWNER"])
      expect(sees(r)).toBe(true);
    for (const r of ["BRANCH_MANAGER", "TECHNICIAN", "IT_SPECIALIST", "OPERATIONS_MANAGER"])
      expect(sees(r)).toBe(false);
    expect(sees("AGENT", false)).toBe(false);
  });
});
