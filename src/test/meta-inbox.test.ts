import { describe, expect, it } from "vitest";
import { parseWebhook, preview, threadId, transcript, windowOpen } from "@/lib/meta-inbox";

const fb = (messaging: unknown[]) => ({ object: "page", entry: [{ id: "111", messaging }] });

describe("Meta inbox webhook", () => {
  it("reads a Messenger message from a customer", () => {
    const [e] = parseWebhook(
      fb([
        {
          sender: { id: "999" },
          recipient: { id: "111" },
          timestamp: 1793836800000,
          message: { mid: "m1", text: "السلام عليكم" },
        },
      ]),
    );
    expect(e).toMatchObject({
      platform: "FB",
      accountId: "111",
      customerId: "999",
      mid: "m1",
      text: "السلام عليكم",
      direction: "IN",
    });
    expect(e!.at).toBe(new Date(1793836800000).toISOString());
  });

  it("reads Instagram messages and attachments", () => {
    const [e] = parseWebhook({
      object: "instagram",
      entry: [
        {
          id: "222",
          messaging: [
            {
              sender: { id: "777" },
              recipient: { id: "222" },
              timestamp: 1,
              message: {
                mid: "m2",
                attachments: [{ type: "image", payload: { url: "https://cdn.example/x.jpg" } }],
              },
            },
          ],
        },
      ],
    });
    expect(e).toMatchObject({ platform: "IG", accountId: "222", customerId: "777", text: "" });
    expect(e!.attachments).toEqual([{ type: "image", url: "https://cdn.example/x.jpg" }]);
  });

  it("treats echoes (replies sent by the business) as outgoing to the customer", () => {
    const [e] = parseWebhook(
      fb([
        {
          sender: { id: "111" },
          recipient: { id: "999" },
          timestamp: 1,
          message: { mid: "m3", text: "أهلاً", is_echo: true },
        },
      ]),
    );
    expect(e).toMatchObject({ direction: "OUT", customerId: "999" });
  });

  it("skips reads, deliveries, deleted and empty messages, and unknown objects", () => {
    expect(
      parseWebhook(
        fb([
          { sender: { id: "999" }, recipient: { id: "111" }, read: { watermark: 1 } },
          {
            sender: { id: "999" },
            recipient: { id: "111" },
            message: { mid: "m4", is_deleted: true },
          },
          { sender: { id: "999" }, recipient: { id: "111" }, message: { mid: "m5" } },
        ]),
      ),
    ).toEqual([]);
    expect(parseWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
});

describe("Meta inbox rules", () => {
  it("keeps one conversation per customer per account", () => {
    expect(threadId("IG", "222", "777")).toBe("IG:222:777");
  });

  it("knows Meta's 24-hour reply window", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(windowOpen("2026-11-05T00:00:00Z", now)).toBe(true);
    expect(windowOpen("2026-11-04T11:00:00Z", now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
  });

  it("previews text or the attachment type", () => {
    expect(preview("  مرحبا   بكم ", [])).toBe("مرحبا بكم");
    expect(preview("", [{ type: "audio", url: "" }])).toBe("[رسالة صوتية]");
  });

  it("writes the chat into the complaint, customer and team in order", () => {
    const t = transcript(
      [
        { direction: "IN", text: "الطلب بارد", attachments: [], at: "1" },
        { direction: "OUT", text: "نعتذر منك", attachments: [], at: "2" },
        { direction: "IN", text: "", attachments: [{ type: "image", url: "x" }], at: "3" },
      ],
      "سارة",
    );
    expect(t).toBe("سارة: الطلب بارد\nالفريق: نعتذر منك\nسارة: [صورة]");
  });
});
