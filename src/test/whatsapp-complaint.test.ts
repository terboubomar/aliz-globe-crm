import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = { complaints: [] as Row[], upserts: [] as Row[] };
function query(table: string) {
  let upsert: Row | null = null;
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    upsert: (row: Row) => ((upsert = row), q),
    maybeSingle: () => q,
    then: (done: (r: { data: unknown; error: null }) => void) => {
      if (table === "brands")
        return done({
          data: [
            { id: "waqf", name: "برجر واقف" },
            { id: "kabab", name: "كباب كلوم" },
          ],
          error: null,
        });
      if (table === "branches")
        return done({
          data: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              name: "سيهات",
              city: "سيهات",
              brand_id: "waqf",
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              name: "جدة",
              city: "جدة",
              brand_id: "kabab",
            },
          ],
          error: null,
        });
      if (table === "whatsapp_complaints") {
        if (upsert) {
          db.upserts.push(upsert);
          return done({ data: null, error: null });
        }
        return done({ data: db.complaints[0] ?? null, error: null });
      }
      return done({ data: null, error: null });
    },
  };
  return q;
}
vi.mock("@/functions/core.server", () => ({
  admin: async () => ({ from: query }),
  settings: async () => ({}),
  catalog: async () => ({
    categories: [
      { id: "QUALITY", label: "جودة الطعام", active: true },
      { id: "SAFETY", label: "سلامة الغذاء", active: true, urgent: true },
      { id: "SUGGESTION", label: "اقتراح", active: true },
    ],
    platforms: [
      { label: "جاهز", active: true },
      { label: "هنقرستيشن", active: true },
    ],
  }),
}));
vi.mock("@/functions/crypto.server", () => ({ encrypt: vi.fn(), decrypt: vi.fn() }));

const ic = () => import("@/functions/inbox-complaint.server");
const lists = {
  brands: [
    { id: "waqf", name: "برجر واقف" },
    { id: "kabab", name: "كباب كلوم" },
  ],
  branches: [
    { id: "11111111-1111-4111-8111-111111111111", name: "سيهات", city: "سيهات", brand_id: "waqf" },
    { id: "22222222-2222-4222-8222-222222222222", name: "جدة", city: "جدة", brand_id: "kabab" },
  ],
  categories: [
    { id: "QUALITY", label: "جودة الطعام" },
    { id: "SAFETY", label: "سلامة الغذاء", urgent: true },
  ],
  platforms: ["جاهز", "هنقرستيشن"],
};

describe("reading the AI's suggestion", () => {
  it("keeps only brands, branches, reasons and platforms from our lists", async () => {
    const { parseSuggestion } = await ic();
    const s = parseSuggestion(
      '```json\n{"isComplaint":true,"summary":"الطلب وصل بارد","brandId":"made-up","branchId":"11111111-1111-4111-8111-111111111111","category":"COLD","priority":"P2","externalOrder":"88213","platform":"طلبات"}\n```',
      lists,
    );
    expect(s).toEqual({
      isComplaint: true,
      summary: "الطلب وصل بارد",
      // The branch decides the brand when the brand is unknown.
      brandId: "waqf",
      branchId: "11111111-1111-4111-8111-111111111111",
      category: null,
      priority: "P2",
      externalOrder: "88213",
      platform: null,
    });
  });

  it("drops a branch of another brand and forces food safety to P1", async () => {
    const { parseSuggestion } = await ic();
    const s = parseSuggestion(
      '{"isComplaint":true,"brandId":"waqf","branchId":"22222222-2222-4222-8222-222222222222","category":"SAFETY","priority":"P3"}',
      lists,
    );
    expect(s?.brandId).toBe("waqf");
    expect(s?.branchId).toBeNull();
    expect(s?.priority).toBe("P1");
  });

  it("returns nothing for an answer that is not JSON", async () => {
    const { parseSuggestion } = await ic();
    expect(parseSuggestion("لا أعرف", lists)).toBeNull();
  });

  it("gives the AI customer and staff text only, newest last", async () => {
    const { chatText } = await ic();
    const m = (id: string, kind: string, text: string) =>
      ({
        id,
        kind,
        text,
        at: null,
        status: null,
        error: null,
        sender: null,
        attachments: [],
      }) as never;
    expect(
      chatText([
        m("1", "customer", "الطلب بارد"),
        m("2", "note", "ملاحظة داخلية"),
        m("3", "agent", "نعتذر"),
      ]),
    ).toBe("العميل: الطلب بارد\nالموظف: نعتذر");
  });
});

describe("when the AI runs", () => {
  const bevatelAndAi = (aiCalls: string[]) =>
    (async (url: string, init: RequestInit) => {
      if (url.includes("ai.gateway")) {
        aiCalls.push(String(init.body));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"isComplaint":true,"summary":"بارد","brandId":"waqf","category":"QUALITY","priority":"P2"}',
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/messages"))
        return new Response(
          JSON.stringify({
            payload: [
              { id: 77, content: "الطلب وصل بارد", message_type: 0, created_at: 1795340000 },
            ],
          }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({ id: 41, inbox_id: 7, meta: { sender: { name: "سارة" } } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

  beforeEach(() => {
    vi.stubEnv("BEVATEL_API_TOKEN", "t");
    vi.stubEnv("BEVATEL_ACCOUNT_ID", "3");
    vi.stubEnv("BEVATEL_INBOX_ID", "7");
    vi.stubEnv("LOVABLE_API_KEY", "k");
    db.complaints = [];
    db.upserts = [];
  });

  it("asks the AI once and keeps the answer for that customer message", async () => {
    const { suggestionFor } = await ic();
    const calls: string[] = [];
    const r = await suggestionFor("41", bevatelAndAi(calls));
    expect(r.suggestion?.isComplaint).toBe(true);
    expect(calls).toHaveLength(1);
    // The prompt carries the chat but never the customer's phone number.
    expect(calls[0]).toContain("الطلب وصل بارد");
    expect(db.upserts[0]).toMatchObject({ conversation_id: "41", analyzed_message_id: "77" });

    db.complaints = [{ suggestion: r.suggestion, analyzed_message_id: "77", ticket_id: null }];
    const again = await suggestionFor("41", bevatelAndAi(calls));
    expect(again.suggestion).toEqual(r.suggestion);
    expect(calls).toHaveLength(1);
  });

  it("works without AI: no suggestion, the agent registers by hand", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    const { suggestionFor } = await ic();
    const calls: string[] = [];
    const r = await suggestionFor("41", bevatelAndAi(calls));
    expect(r).toEqual({ ticket: null, suggestion: null, ai: false });
    expect(calls).toHaveLength(0);
  });
});
