import { describe, expect, it } from "vitest";
import { permissionsForRole } from "@/lib/domain";
import { appOf, canOpenView } from "@/aliz/access";
import {
  itActions,
  itCategoryText,
  itDeadlines,
  itNumber,
  itSummary,
  toItSettings,
  DEFAULT_IT_CATEGORIES,
  type ItTicket,
} from "@/lib/it";

const ticket = (over: Partial<ItTicket> = {}): ItTicket => ({
  id: "t1",
  number: 7,
  brandId: null,
  branchId: null,
  department: "CUSTOMER_SERVICE",
  category: "PRINTER",
  categoryDetail: null,
  priority: "NORMAL",
  title: "الطابعة لا تطبع",
  description: "",
  state: "NEW",
  requester: "agent",
  assignee: null,
  respondDueAt: null,
  fixDueAt: null,
  createdAt: new Date().toISOString(),
  assignedAt: null,
  startedAt: null,
  doneAt: null,
  confirmedAt: null,
  version: 1,
  ...over,
});
const who = (id: string, role: string) => ({ id, permissions: permissionsForRole(role) });

describe("IT app", () => {
  it("lets every staff role open tickets; only IT works them", () => {
    for (const role of ["AGENT", "BRANCH_MANAGER", "TECHNICIAN", "CEO", "MAINTENANCE_MANAGER"]) {
      const p = permissionsForRole(role);
      expect(p).toContain("it.request");
      expect(p).not.toContain("it.work");
      expect(canOpenView("it", p, role)).toBe(true);
    }
    expect(permissionsForRole("IT_SPECIALIST").sort()).toEqual([
      "it.request",
      "it.view",
      "it.work",
    ]);
    expect(permissionsForRole("IT_SPECIALIST")).not.toContain("read");
    expect(permissionsForRole("IT_MANAGER")).toEqual(
      expect.arrayContaining(["it.assign", "it.configure", "it.report", "refund.execute"]),
    );
    expect(appOf("it-refunds")).toBe("it");
    expect(appOf("tickets")).toBe("cs");
  });

  it("follows assign → start → solved → confirmed by the requester", () => {
    const t = ticket();
    expect(itActions(t, who("mgr", "IT_MANAGER"))).toContain("assign");
    expect(itActions(t, who("agent", "AGENT"))).toEqual(["cancel", "comment"]);
    expect(itActions(t, who("other", "AGENT"))).toEqual([]);
    const assigned = ticket({ state: "ASSIGNED", assignee: "spec" });
    expect(itActions(assigned, who("spec", "IT_SPECIALIST"))).toEqual(["start", "comment"]);
    expect(itActions(assigned, who("spec2", "IT_SPECIALIST"))).toEqual([]);
    const done = ticket({ state: "DONE", assignee: "spec" });
    expect(itActions(done, who("agent", "AGENT"))).toEqual(["confirm", "reopen", "comment"]);
    // A specialist can't confirm their own fix.
    expect(itActions(done, who("spec", "IT_SPECIALIST"))).not.toContain("confirm");
  });

  it("has IT defaults and keeps saved departments and types", () => {
    const s = toItSettings(null);
    expect(s.categories.map((c) => c.id)).toEqual(DEFAULT_IT_CATEGORIES.map((c) => c.id));
    expect(s.departments.some((d) => d.id === "BRANCHES")).toBe(true);
    const saved = toItSettings({ departments: [{ id: "D_X", label: " المستودع ", active: true }] });
    expect(saved.departments).toEqual([{ id: "D_X", label: "المستودع", active: true }]);
    const due = itDeadlines("URGENT", new Date("2026-11-11T10:00:00Z"), s.sla);
    expect(due.respondDueAt).toBe("2026-11-11T11:00:00.000Z");
    expect(itNumber(42)).toBe("IT-0042");
    expect(
      itCategoryText(ticket({ category: "OTHER", categoryDetail: "البصمة" }), s.categories),
    ).toBe("أخرى: البصمة");
  });

  it("reports by department and by branch, with tickets that have no branch", () => {
    const sum = itSummary([
      ticket({ department: "BRANCHES", branchId: "b1", brandId: "waqf" }),
      ticket({ department: "FINANCE" }),
      ticket({ department: "FINANCE", state: "CONFIRMED", doneAt: new Date().toISOString() }),
    ]);
    expect(sum.byDepartment.map((g) => [g.key, g.total])).toEqual([
      ["FINANCE", 2],
      ["BRANCHES", 1],
    ]);
    expect(sum.byBranch.find((g) => g.key === "NONE")?.total).toBe(2);
  });
});
