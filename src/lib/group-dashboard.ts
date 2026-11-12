/*
 * Figures for the group dashboard: one screen over the three apps (Customer
 * Service, Maintenance, IT). Each app gets the same four numbers, and the
 * items that are late or urgent in any app are merged into one list.
 */
import { nextDeadline } from "./dashboard";
import { itLate, type ItTicket } from "./it";
import { maintenanceLate, type MaintenanceRequest } from "./maintenance";

export type HubApp = "cs" | "maintenance" | "it";

export type HubFigures = {
  open: number;
  late: number;
  urgent: number;
  unassigned: number;
  /** Fixed and waiting for the requester to confirm (Maintenance and IT only). */
  awaitingConfirm: number;
};

export type HubItem = {
  app: HubApp;
  id: string;
  number: string;
  title: string;
  brandId: string | null;
  branchId: string | null;
  urgent: boolean;
  /** Minutes past the deadline; null when urgent but still on time. */
  lateMinutes: number | null;
};

type Complaint = {
  id: string;
  number: string;
  brandId: string;
  branchId: string | null;
  priority: string;
  state: string;
  communicationsOwner: string;
  timers: { dueAt: string; completedAt: string | null }[];
};

type Work = MaintenanceRequest | ItTicket;
const closedWork = ["CONFIRMED", "CANCELLED"];
const lateOf = (r: Work, now: number) =>
  "department" in r ? itLate(r, now) : maintenanceLate(r as MaintenanceRequest, now);

/** Maintenance requests or IT tickets: the four numbers for one app. */
export function workFigures(rows: Work[], now = Date.now()): HubFigures {
  const open = rows.filter((r) => ![...closedWork, "DONE"].includes(r.state));
  return {
    open: open.length,
    late: open.filter((r) => lateOf(r, now)).length,
    urgent: open.filter((r) => r.priority === "URGENT").length,
    unassigned: open.filter((r) => !r.assignee).length,
    awaitingConfirm: rows.filter((r) => r.state === "DONE").length,
  };
}

/** Complaints, counted over the loaded cases (the server sends exact totals separately). */
export function complaintFigures(rows: Complaint[], now = Date.now()): HubFigures {
  const open = rows.filter((t) => t.state !== "CLOSED");
  return {
    open: open.length,
    late: open.filter((t) => nextDeadline(t.timers, now)?.late).length,
    urgent: open.filter((t) => t.priority === "P1").length,
    unassigned: open.filter((t) => t.communicationsOwner === "UNASSIGNED").length,
    awaitingConfirm: 0,
  };
}

/** Open items from every app that are late or urgent: most overdue first. */
export function hubAttention(
  input: {
    complaints: (Complaint & { title: string })[];
    maintenance: (MaintenanceRequest & { number: number })[];
    it: ItTicket[];
    maintenanceNumber: (n: number) => string;
    itNumber: (n: number) => string;
  },
  now = Date.now(),
): HubItem[] {
  const items: HubItem[] = [];
  for (const t of input.complaints) {
    if (t.state === "CLOSED") continue;
    const d = nextDeadline(t.timers, now);
    const urgent = t.priority === "P1";
    if (!urgent && !d?.late) continue;
    items.push({
      app: "cs",
      id: t.id,
      number: t.number,
      title: t.title,
      brandId: t.brandId,
      branchId: t.branchId,
      urgent,
      lateMinutes: d?.late ? -d.minutes : null,
    });
  }
  const work = (app: "maintenance" | "it", rows: Work[], number: (n: number) => string) => {
    for (const r of rows) {
      if ([...closedWork, "DONE"].includes(r.state)) continue;
      const late = lateOf(r, now);
      const urgent = r.priority === "URGENT";
      if (!urgent && !late) continue;
      const due = late === "respond" ? r.respondDueAt : late === "fix" ? r.fixDueAt : null;
      items.push({
        app,
        id: r.id,
        number: number(r.number),
        title: r.title,
        brandId: r.brandId,
        branchId: r.branchId,
        urgent,
        lateMinutes: due ? (now - +new Date(due)) / 60000 : null,
      });
    }
  };
  work("maintenance", input.maintenance, input.maintenanceNumber);
  work("it", input.it, input.itNumber);
  return items.sort(
    (a, b) => (b.lateMinutes ?? -1) - (a.lateMinutes ?? -1) || Number(b.urgent) - Number(a.urgent),
  );
}
