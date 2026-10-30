import { grouped } from "@/lib/catalog";

/** Complaint reasons for a <select>, under their group headings. */
export function ReasonOptions({
  reasons,
}: {
  reasons: { id: string; label: string; group?: string | undefined; urgent?: boolean }[];
}) {
  return (
    <>
      {grouped(reasons).map((g) => {
        const options = g.items.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
            {c.urgent ? " (عاجلة P1)" : ""}
          </option>
        ));
        return g.group ? (
          <optgroup key={g.group} label={g.group}>
            {options}
          </optgroup>
        ) : (
          options
        );
      })}
    </>
  );
}
