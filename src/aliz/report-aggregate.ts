// Report aggregation copied unchanged from the original API (apps/api/src/reports.ts),
// so the reports page shows the same figures from the same scoped rows.
export type Row = {
  brandId: string;
  branchId: string | null;
  state: string;
  source: string;
  category: string;
  escalated: boolean;
  priority?: string;
  resolutionOwner?: string | null;
  receivedAt: Date;
  closedAt: Date | null;
  brand: { name: string; logo: string; color: string };
  branch: { name: string } | null;
};
export function summarize(rows: Row[]) {
  const closed = rows.filter((r) => r.state === "CLOSED"),
    durations = closed
      .filter((r) => r.closedAt && +r.closedAt >= +r.receivedAt)
      .map((r) => (+r.closedAt! - +r.receivedAt) / 3600000);
  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return {
    total: rows.length,
    open: rows.length - closed.length,
    closed: closed.length,
    escalated: rows.filter((r) => r.escalated && r.state !== "CLOSED").length,
    unassigned: rows.filter((r) => r.state === "NEW" || r.state === "TRIAGED").length,
    closureRate: rows.length ? Math.round((closed.length / rows.length) * 100) : 0,
    resolvedWithTime: durations.length,
    medianResolutionHours: durations.length
      ? durations.length % 2
        ? durations[middle]!
        : (durations[middle - 1]! + durations[middle]!) / 2
      : null,
    avgResolutionHours: durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null,
  };
}
export function aggregateReport(rows: Row[], from: string, to: string, now = new Date()) {
  const counts = (key: "state" | "source" | "category" | "priority") =>
    Object.entries(
      rows.reduce<Record<string, number>>((all, r) => {
        const stateGroups: Record<string, string> = {
          TRIAGED: "NEW",
          ACKNOWLEDGED: "IN_PROGRESS",
          INVESTIGATING: "IN_PROGRESS",
          ACTION_PENDING: "IN_PROGRESS",
        };
        const label = key === "state" ? (stateGroups[r.state] ?? r.state) : (r[key] ?? "UNKNOWN");
        all[label] = (all[label] ?? 0) + 1;
        return all;
      }, {}),
    )
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  const groups = (kind: "brand" | "branch") => {
    const grouped = new Map<string, Row[]>();
    for (const r of rows) {
      const id = kind === "brand" ? r.brandId : (r.branchId ?? "UNKNOWN:" + r.brandId);
      const list = grouped.get(id);
      if (list) list.push(r);
      else grouped.set(id, [r]);
    }
    return [...grouped]
      .map(([id, items]) => ({
        id,
        name:
          kind === "brand" ? items[0]!.brand.name : (items[0]!.branch?.name ?? "الفرع غير محدد"),
        brandName: items[0]!.brand.name,
        logo: items[0]!.brand.logo,
        color: items[0]!.brand.color,
        ...summarize(items),
      }))
      .sort((a, b) => b.total - a.total);
  };
  const days = new Map<string, { day: string; received: number; closed: number }>();
  for (let d = Date.parse(from + "T12:00:00Z"); d <= Date.parse(to + "T12:00:00Z"); d += 86400000) {
    const day = new Date(d).toISOString().slice(0, 10);
    days.set(day, { day, received: 0, closed: 0 });
  }
  const day = (d: Date) => new Date(+d + 10800000).toISOString().slice(0, 10);
  for (const r of rows) {
    const received = days.get(day(r.receivedAt));
    if (received) received.received++;
    if (r.state === "CLOSED" && r.closedAt) {
      const closed = days.get(day(r.closedAt));
      if (closed) closed.closed++;
    }
  }
  const aging = [
    { key: "under24", label: "أقل من 24 ساعة", count: 0 },
    { key: "24to48", label: "24–48 ساعة", count: 0 },
    { key: "48to72", label: "48–72 ساعة", count: 0 },
    { key: "over72", label: "72 ساعة فأكثر", count: 0 },
  ];
  const team = new Map<string, Row[]>();
  for (const row of rows) {
    const owner = row.resolutionOwner ?? "UNASSIGNED";
    const group = team.get(owner);
    if (group) group.push(row);
    else team.set(owner, [row]);
    if (row.state !== "CLOSED") {
      const hours = Math.max(0, (+now - +row.receivedAt) / 3600000);
      aging[hours < 24 ? 0 : hours < 48 ? 1 : hours < 72 ? 2 : 3]!.count++;
    }
  }
  return {
    aging,
    team: [...team]
      .map(([id, items]) => ({ id, ...summarize(items) }))
      .sort((a, b) => b.open - a.open),
    priorities: counts("priority"),
    summary: summarize(rows),
    states: counts("state"),
    sources: counts("source"),
    categories: counts("category"),
    brands: groups("brand"),
    branches: groups("branch"),
    trend: [...days.values()],
  };
}
export function previousReportPeriod<T extends { from: string; to: string }>(input: T) {
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000 + 1;
  return {
    ...input,
    from: new Date(Date.parse(input.from) - days * 86400000).toISOString().slice(0, 10),
    to: new Date(Date.parse(input.from) - 86400000).toISOString().slice(0, 10),
  };
}

type Aggregate = ReturnType<typeof aggregateReport>;
export type ReportResult = Omit<Aggregate, "team"> & {
  team: (Aggregate["team"][number] & { name: string })[];
  previous: {
    from: string;
    to: string;
    summary: ReturnType<typeof summarize>;
    trend: Aggregate["trend"];
  };
  filters: Record<string, string>;
  generatedAt: string;
};
