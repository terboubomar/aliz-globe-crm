import { describe, expect, it } from "vitest";
import {
  assertRefundSeparation, assignableRoles, can, canWorkComplaint, complaintStage, complaintStages, inScope,
  permissionsForRole, refundNext, transition, briefHasPersonalData, normalizePhone, safeCell, type Actor,
} from "@/lib/domain";

const actor = (role: string, extra: Partial<Actor> = {}): Actor => ({ id: role.toLowerCase(), name: role, role, brandIds: ["waqf"], branchIds: [], ...extra });

describe("roles", () => {
  it("exposes exactly the seven assignable roles", () => {
    expect([...assignableRoles]).toEqual(["SUPER_ADMIN", "MARKETING_MANAGER", "SHIFT_LEAD", "AGENT", "OPERATIONS_MANAGER", "CEO", "OWNER"]);
  });
  it("unknown or legacy roles get no permissions", () => {
    expect(permissionsForRole("FINANCE_APPROVER")).toEqual([]);
    expect(permissionsForRole("PUBLIC")).toEqual([]);
  });
  it("only shift lead / marketing / super admin may assign", () => {
    for (const r of assignableRoles) expect(can(actor(r), "assign")).toBe(["SUPER_ADMIN", "MARKETING_MANAGER", "SHIFT_LEAD"].includes(r));
  });
  it("CEO and OWNER are read + report only", () => {
    expect(permissionsForRole("CEO").sort()).toEqual(["read", "report"]);
    expect(permissionsForRole("OWNER").sort()).toEqual(["read", "report"]);
  });
  it("agents can request refunds but never decide, execute or verify without a duty", () => {
    const a = actor("AGENT");
    expect(can(a, "refund.request")).toBe(true);
    expect(can(a, "refund.decide") || can(a, "refund.execute") || can(a, "refund.verify")).toBe(false);
    expect(can(actor("AGENT", { financeDuty: "APPROVER" }), "refund.decide")).toBe(true);
  });
  it("only SUPER_ADMIN manages users", () => {
    for (const r of assignableRoles) expect(can(actor(r), "users.manage")).toBe(r === "SUPER_ADMIN");
  });
});

describe("scope", () => {
  it("denies other brands and other branches", () => {
    expect(inScope(actor("AGENT"), { brandId: "kabab" })).toBe(false);
    expect(inScope(actor("AGENT", { branchIds: ["b1"] }), { brandId: "waqf", branchId: "b2" })).toBe(false);
    expect(inScope(actor("AGENT", { branchIds: ["b1"] }), { brandId: "waqf", branchId: "b1" })).toBe(true);
  });
  it("agents may work only complaints assigned to them", () => {
    const a = actor("AGENT");
    expect(canWorkComplaint(a, { brandId: "waqf", resolutionOwner: "other" })).toBe(false);
    expect(canWorkComplaint(a, { brandId: "waqf", resolutionOwner: a.id })).toBe(true);
  });
  it("operations managers work only escalations routed to them", () => {
    const o = actor("OPERATIONS_MANAGER");
    expect(canWorkComplaint(o, { brandId: "waqf", resolutionOwner: o.id, escalated: false })).toBe(false);
    expect(canWorkComplaint(o, { brandId: "waqf", resolutionOwner: o.id, escalated: true })).toBe(true);
  });
});

describe("five complaint stages", () => {
  it("labels are exact", () => {
    expect(complaintStages.map((s) => s.label)).toEqual(["استقبال الشكوى", "الإسناد", "جارٍ العمل", "التواصل مع العميل", "تم الحل"]);
  });
  it("maps states to stages", () => {
    expect(complaintStage({ state: "NEW" })).toBe("new");
    expect(complaintStage({ state: "ASSIGNED" })).toBe("routing");
    expect(complaintStage({ state: "IN_PROGRESS" })).toBe("processing");
    expect(complaintStage({ state: "RESOLVED" })).toBe("followup");
    expect(complaintStage({ state: "CLOSED" })).toBe("closed");
  });
  it("blocks skipping steps", () => {
    expect(() => transition("NEW", "close")).toThrow();
    expect(() => transition("NEW", "resolve")).toThrow();
    expect(transition("ASSIGNED", "start")).toBe("IN_PROGRESS");
  });
});

describe("refund separation", () => {
  const r = { requester: "u1", approver: "u2", processor: "u3" };
  it("requester cannot approve own request", () => {
    expect(() => assertRefundSeparation(actor("X", { id: "u1" }), r, "approve")).toThrow(/لا يمكن اعتماد طلبك/);
  });
  it("approver cannot execute", () => {
    expect(() => assertRefundSeparation(actor("X", { id: "u2" }), r, "execute")).toThrow();
  });
  it("requester, approver and processor cannot verify", () => {
    for (const id of ["u1", "u2", "u3"]) expect(() => assertRefundSeparation(actor("X", { id }), r, "verify")).toThrow();
    expect(() => assertRefundSeparation(actor("X", { id: "u4" }), r, "verify")).not.toThrow();
  });
  it("approved is not processed: approval leads to awaiting external execution", () => {
    expect(refundNext("UNDER_REVIEW", "approve")).toBe("AWAITING_EXTERNAL_EXECUTION");
    expect(() => refundNext("REQUESTED", "approve")).toThrow();
    expect(() => refundNext("AWAITING_EXTERNAL_EXECUTION", "verify")).toThrow();
  });
});

describe("privacy helpers", () => {
  it("rejects briefs containing phones, emails or the customer's name", () => {
    expect(briefHasPersonalData("اتصل على 0551234567 للمتابعة")).toBe(true);
    expect(briefHasPersonalData("راسل a@b.com")).toBe(true);
    expect(briefHasPersonalData("العميل محمد غاضب", "محمد")).toBe(true);
    expect(briefHasPersonalData("تأخر الطلب 40 دقيقة في الفرع")).toBe(false);
  });
  it("normalizes Saudi mobiles and neutralizes CSV formulas", () => {
    expect(normalizePhone("0551234567")).toBe("966551234567");
    expect(safeCell("=HYPERLINK()")).toBe(`"'=HYPERLINK()"`);
  });
});
