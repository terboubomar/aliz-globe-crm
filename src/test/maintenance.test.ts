import { describe, expect, it } from "vitest";
import { permissionsForRole } from "@/lib/domain";
import { appsFor } from "@/aliz/access";
import {
  maintenanceActions,
  maintenanceDeadlines,
  maintenanceLate,
  maintenanceTransition,
  toMaintenanceSettings,
  DEFAULT_MAINTENANCE_SLA,
  type MaintenanceRequest,
} from "@/lib/maintenance";

const req = (over: Partial<MaintenanceRequest> = {}): MaintenanceRequest => ({
  id: "r1",
  number: 1,
  brandId: "waqf",
  branchId: "b1",
  category: "AC",
  priority: "NORMAL",
  title: "مكيف",
  description: "",
  state: "NEW",
  requester: "bm",
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

describe("apps by role", () => {
  it("opens the right apps for each role", () => {
    const apps = (role: string) => appsFor(permissionsForRole(role), role);
    expect(apps("AGENT")).toEqual(["cs"]);
    expect(apps("IT_MANAGER")).toEqual(["cs"]);
    expect(apps("TECHNICIAN")).toEqual(["maintenance"]);
    expect(apps("MAINTENANCE_MANAGER")).toEqual(["maintenance"]);
    expect(apps("BRANCH_MANAGER")).toEqual(["cs", "maintenance"]);
    expect(apps("SUPER_ADMIN")).toEqual(["cs", "maintenance"]);
  });
  it("keeps complaints and customer details away from the maintenance team", () => {
    for (const role of ["TECHNICIAN", "MAINTENANCE_MANAGER"]) {
      expect(permissionsForRole(role)).not.toContain("read");
      expect(permissionsForRole(role)).not.toContain("pii");
    }
    expect(permissionsForRole("BRANCH_MANAGER")).not.toContain("pii");
  });
});

describe("maintenance steps", () => {
  it("lets the manager assign and the branch cancel a new request", () => {
    expect(maintenanceActions(req(), who("mm", "MAINTENANCE_MANAGER"))).toContain("assign");
    expect(maintenanceActions(req(), who("bm", "BRANCH_MANAGER"))).toEqual(["cancel", "comment"]);
    expect(maintenanceActions(req(), who("other", "BRANCH_MANAGER"))).toEqual(["comment"]);
  });
  it("lets only the assigned technician start and finish", () => {
    const assigned = req({ state: "ASSIGNED", assignee: "t1" });
    expect(maintenanceActions(assigned, who("t1", "TECHNICIAN"))).toContain("start");
    expect(maintenanceActions(assigned, who("t2", "TECHNICIAN"))).toEqual([]);
    const working = req({ state: "IN_PROGRESS", assignee: "t1" });
    expect(maintenanceActions(working, who("t1", "TECHNICIAN"))).toContain("done");
    expect(maintenanceActions(working, who("bm", "BRANCH_MANAGER"))).not.toContain("done");
  });
  it("lets the branch confirm or reopen a finished job", () => {
    const done = req({ state: "DONE", assignee: "t1" });
    expect(maintenanceActions(done, who("bm", "BRANCH_MANAGER"))).toEqual(
      expect.arrayContaining(["confirm", "reopen"]),
    );
    expect(maintenanceActions(done, who("t1", "TECHNICIAN"))).not.toContain("confirm");
    expect(maintenanceTransition("reopen", new Date())).toEqual({
      state: "IN_PROGRESS",
      done_at: null,
    });
  });
  it("allows nothing on a closed request", () => {
    expect(
      maintenanceActions(req({ state: "CONFIRMED" }), who("mm", "MAINTENANCE_MANAGER")),
    ).toEqual([]);
  });
});

describe("deadlines", () => {
  it("sets start and fix deadlines from the priority", () => {
    const from = new Date("2026-11-10T08:00:00Z");
    const d = maintenanceDeadlines("URGENT", from, DEFAULT_MAINTENANCE_SLA);
    expect(d.respondDueAt).toBe("2026-11-10T10:00:00.000Z");
    expect(d.fixDueAt).toBe("2026-11-10T16:00:00.000Z");
  });
  it("flags late requests until they are done", () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    expect(maintenanceLate(req({ respondDueAt: past }))).toBe("respond");
    expect(maintenanceLate(req({ state: "IN_PROGRESS", startedAt: past, fixDueAt: past }))).toBe(
      "fix",
    );
    expect(maintenanceLate(req({ state: "DONE", fixDueAt: past }))).toBeNull();
  });
  it("falls back to defaults for bad saved settings", () => {
    const s = toMaintenanceSettings({
      categories: [{ id: "bad id", label: "x" }],
      sla: { URGENT: { respond: -1, fix: 5 } },
    });
    expect(s.categories.length).toBeGreaterThan(3);
    expect(s.sla.URGENT).toEqual({ respond: 2, fix: 5 });
  });
});
