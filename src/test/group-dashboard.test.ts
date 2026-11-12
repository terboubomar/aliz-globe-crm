import { describe, expect, it } from "vitest";
import { permissionsForRole } from "@/lib/domain";
import { canOpenView, hubSections } from "@/aliz/access";
import { complaintFigures, hubAttention, workFigures } from "@/lib/group-dashboard";
import { itNumber, type ItTicket } from "@/lib/it";
import { maintenanceNumber, type MaintenanceRequest } from "@/lib/maintenance";

const now = Date.parse("2026-11-12T09:00:00Z");
const at = (minutes: number) => new Date(now + minutes * 60000).toISOString();

const req = (over: Partial<MaintenanceRequest> = {}): MaintenanceRequest => ({
  id: "m1",
  number: 1,
  brandId: "waqf",
  branchId: "b1",
  category: "AC",
  categoryDetail: null,
  priority: "NORMAL",
  title: "مكيف",
  description: "",
  state: "NEW",
  requester: "bm",
  assignee: null,
  respondDueAt: null,
  fixDueAt: null,
  createdAt: at(-600),
  assignedAt: null,
  startedAt: null,
  doneAt: null,
  confirmedAt: null,
  version: 1,
  ...over,
});
const ticket = (over: Partial<ItTicket> = {}): ItTicket => ({
  ...req(),
  id: "i1",
  brandId: null,
  branchId: null,
  department: "FINANCE",
  title: "طابعة",
  ...over,
});
const complaint = (over = {}) => ({
  id: "c1",
  number: "ALZ-1",
  brandId: "waqf",
  branchId: "b1",
  priority: "P3",
  state: "ASSIGNED",
  communicationsOwner: "u1",
  timers: [{ dueAt: at(60), completedAt: null }],
  title: "جودة الطعام",
  ...over,
});

describe("group dashboard figures", () => {
  it("counts open, late, urgent, unassigned and awaiting confirmation", () => {
    const f = workFigures(
      [
        req(),
        req({ id: "m2", assignee: "t1", state: "ASSIGNED", respondDueAt: at(-30) }),
        req({ id: "m3", priority: "URGENT", assignee: "t1", state: "IN_PROGRESS" }),
        req({ id: "m4", state: "DONE", assignee: "t1" }),
        req({ id: "m5", state: "CONFIRMED" }),
      ],
      now,
    );
    expect(f).toEqual({ open: 3, late: 1, urgent: 1, unassigned: 1, awaitingConfirm: 1 });
  });
  it("counts complaints", () => {
    const f = complaintFigures(
      [
        complaint(),
        complaint({ id: "c2", priority: "P1", communicationsOwner: "UNASSIGNED" }),
        complaint({ id: "c3", timers: [{ dueAt: at(-5), completedAt: null }] }),
        complaint({ id: "c4", state: "CLOSED", priority: "P1" }),
      ],
      now,
    );
    expect(f).toEqual({ open: 3, late: 1, urgent: 1, unassigned: 1, awaitingConfirm: 0 });
  });
});

describe("needs attention across apps", () => {
  it("merges the three apps, most overdue first, and skips on-time normal work", () => {
    const items = hubAttention(
      {
        complaints: [
          complaint(),
          complaint({ id: "c2", number: "ALZ-2", timers: [{ dueAt: at(-20), completedAt: null }] }),
        ],
        maintenance: [req({ id: "m2", number: 7, fixDueAt: at(-120) }), req({ id: "m9" })],
        it: [ticket({ priority: "URGENT" }), ticket({ id: "i2", state: "DONE", fixDueAt: at(-9) })],
        maintenanceNumber,
        itNumber,
      },
      now,
    );
    expect(items.map((i) => [i.app, i.number])).toEqual([
      ["maintenance", "M-0007"],
      ["cs", "ALZ-2"],
      ["it", "IT-0001"],
    ]);
    expect(items[0]!.lateMinutes).toBe(120);
    expect(items[2]!.lateMinutes).toBeNull();
  });
});

describe("who gets the group dashboard", () => {
  const sees = (role: string) => canOpenView("hub", permissionsForRole(role), role);
  it("opens for the super admin and executives only", () => {
    expect(sees("SUPER_ADMIN")).toBe(true);
    expect(sees("CEO")).toBe(true);
    expect(sees("OWNER")).toBe(true);
    for (const role of [
      "AGENT",
      "SHIFT_LEAD",
      "IT_MANAGER",
      "MAINTENANCE_MANAGER",
      "BRANCH_MANAGER",
    ])
      expect(sees(role)).toBe(false);
  });
  it("shows each person only the sections they may read", () => {
    for (const role of ["SUPER_ADMIN", "CEO", "OWNER"])
      expect(hubSections(permissionsForRole(role))).toEqual(["cs", "maintenance", "it"]);
    // Others would only see IT tickets of their own, so IT is not summarised for them.
    expect(hubSections(permissionsForRole("OPERATIONS_MANAGER"))).toEqual(["cs", "maintenance"]);
  });
});
