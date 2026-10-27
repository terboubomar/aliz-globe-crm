import { complaintStage, complaintStages, stateLabels } from "@/lib/domain";
import { brandLogos } from "@/lib/logos";

export function StageTrack({ t }: { t: { state: string; resolutionOwner?: string | null; branchId?: string | null } }) {
  const cur = complaintStages.findIndex((s) => s.id === complaintStage(t));
  return (
    <ol className="flex flex-wrap gap-2" aria-label="مراحل الشكوى">
      {complaintStages.map((s, i) => (
        <li key={s.id} className={i === cur ? "chip border-primary bg-primary text-primary-foreground" : i < cur ? "chip-ok" : "chip-muted"} aria-current={i === cur ? "step" : undefined}>
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}
export function StateChip({ state }: { state: string }) {
  const cls = state === "CLOSED" ? "chip-ok" : state === "NEW" ? "chip-warn" : "chip-muted";
  return <span className={cls}>{stateLabels[state] ?? state}</span>;
}
export function PriorityChip({ p }: { p: string }) {
  return <span className={p === "P1" ? "chip-crit" : p === "P2" ? "chip-warn" : "chip-muted"}>{p === "P1" ? "P1 عاجل" : p}</span>;
}
export function BrandLogo({ id, size = 28 }: { id: string; size?: number }) {
  const src = brandLogos[id];
  return src ? <img src={src} alt="" width={size} height={size} className="rounded-sm object-contain" style={{ width: size, height: size }} /> : null;
}
export function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleString("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium", timeStyle: "short" }) : "—";
}
export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <h1 className="page-title">{title}</h1>
      <div className="mr-auto flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
