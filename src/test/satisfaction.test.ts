import { beforeEach, describe, expect, it, vi } from "vitest";
import { satisfaction } from "@/aliz/report-aggregate";
import { complaintsBook } from "@/lib/report-export";

describe("satisfaction figures", () => {
  it("averages the rated complaints and counts 4-5 as satisfied", () => {
    expect(
      satisfaction([{ rating: 5 }, { rating: 4 }, { rating: 2 }, { rating: null }, {}]),
    ).toEqual({
      rated: 3,
      avgRating: 3.7,
      satisfiedRate: 67,
    });
    expect(satisfaction([{ rating: null }])).toEqual({
      rated: 0,
      avgRating: null,
      satisfiedRate: null,
    });
  });

  it("puts the score on each Excel row and averages it per group", () => {
    const row = (number: string, rating: number | null) => ({
      number,
      brandId: "waqf",
      branchId: null,
      state: "CLOSED",
      source: "PUBLIC_QR",
      category: "QUALITY",
      priority: "P3",
      escalated: false,
      platform: null,
      owner: "UNASSIGNED",
      receivedAt: "2026-11-10T07:00:00Z",
      closedAt: "2026-11-10T09:00:00Z",
      rating,
    });
    const b = complaintsBook({
      rows: [row("1", 5), row("2", 2), row("3", null)],
      branches: [],
      brandName: () => "برجر واقف",
      personName: () => "",
      reasonOf: (id) => id,
      from: "2026-11-01",
      to: "2026-11-22",
      kind: "complaint",
      filters: {},
    });
    expect(b.details.columns.at(-1)!.header).toBe("تقييم العميل (1-5)");
    expect(b.details.rows.map((r) => r.at(-1))).toEqual([5, 2, null]);
    const brand = b.summaries[0]!;
    expect(brand.columns.at(-1)!.header).toBe("رضا العملاء (من 5)");
    expect(brand.rows[0]!.at(-1)).toBe(3.5);
  });
});

/* ---- rating from the tracking page ---- */
const state = {
  ticket: { state: "RESOLVED" },
  events: 0,
  upserts: [] as unknown[],
  inserts: [] as unknown[],
};
function query(table: string) {
  let upsert: unknown = null;
  let insert: unknown = null;
  let head = false;
  const q = {
    select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
    eq: () => q,
    upsert: (r: unknown) => ((upsert = r), q),
    insert: (r: unknown) => ((insert = r), q),
    maybeSingle: () => q,
    then: (done: (r: Record<string, unknown>) => void) => {
      if (table === "tracking_access")
        return done({
          data: { expires_at: "2099-01-01T00:00:00Z", ticket_id: "t1", tickets: state.ticket },
        });
      if (table === "ticket_events") {
        if (insert) return (state.inserts.push(insert), done({ error: null }));
        if (head) return done({ count: state.events });
      }
      if (table === "complaint_ratings" && upsert)
        return (state.upserts.push(upsert), done({ error: null }));
      return done({ data: null, error: null });
    },
  };
  return q;
}
vi.mock("@/functions/core.server", () => ({ admin: async () => ({ from: query }) }));
vi.mock("@/functions/crypto.server", () => ({
  encrypt: async (v: string) => "enc:" + v,
  decrypt: async (v: string) => v.replace(/^enc:/, ""),
  keyedHash: async (v: string) => "h:" + v,
}));
const low = vi.fn(async () => {});
vi.mock("@/functions/telegram.server", () => ({ notifyLowRating: low }));

describe("rating from the tracking page", () => {
  beforeEach(() => {
    state.ticket = { state: "RESOLVED" };
    state.events = 0;
    state.upserts = [];
    state.inserts = [];
    low.mockClear();
  });

  it("saves the score and comment and writes it to the complaint history", async () => {
    const { rateByToken } = await import("@/functions/ratings.server");
    await rateByToken("token-1234567890ab", 5, "  خدمة   ممتازة ");
    expect(state.upserts[0]).toMatchObject({
      ticket_id: "t1",
      score: 5,
      comment_enc: "enc:خدمة ممتازة",
      source: "TRACKING",
    });
    expect(state.inserts[0]).toMatchObject({
      ticket_id: "t1",
      type: "CUSTOMER_RATED",
      actor: "CUSTOMER",
      note_enc: "enc:5 / 5 — خدمة ممتازة",
    });
    expect(low).not.toHaveBeenCalled();
  });

  it("alerts the team on a 1 or 2", async () => {
    const { rateByToken } = await import("@/functions/ratings.server");
    await rateByToken("token-1234567890ab", 2, "تأخر");
    expect(low).toHaveBeenCalledWith("t1", 2, "تأخر");
  });

  it("refuses before the complaint is solved, and after too many changes", async () => {
    const { rateByToken } = await import("@/functions/ratings.server");
    state.ticket = { state: "IN_PROGRESS" };
    await expect(rateByToken("token-1234567890ab", 4, "")).rejects.toThrow("بعد معالجة");
    state.ticket = { state: "CLOSED" };
    state.events = 5;
    await expect(rateByToken("token-1234567890ab", 4, "")).rejects.toThrow("تم استلام تقييمك");
    expect(state.upserts).toHaveLength(0);
  });
});
