import { useState } from "react";
import { asksDetail, firstReason, grouped } from "@/lib/catalog";
import { Field } from "./ui";

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

type Reason = { id: string; label: string; group?: string | undefined; urgent?: boolean };

/**
 * The complaint reason, and when it is "Other" a box right below it to say what
 * the problem is (sent as otherDetail).
 */
export function ReasonPicker({
  reasons,
  label,
  detailLabel,
  detailPlaceholder,
  full = false,
}: {
  reasons: Reason[];
  label: string;
  detailLabel: string;
  detailPlaceholder: string;
  full?: boolean;
}) {
  const [value, setValue] = useState(() => firstReason(reasons)?.id ?? "");
  const picked = reasons.find((r) => r.id === value);
  return (
    <>
      <Field label={label} full={full}>
        <select name="category" required value={value} onChange={(e) => setValue(e.target.value)}>
          <ReasonOptions reasons={reasons} />
        </select>
      </Field>
      {picked && asksDetail(picked) && (
        <Field label={detailLabel} full>
          <input
            name="otherDetail"
            required
            minLength={3}
            maxLength={120}
            autoFocus
            placeholder={detailPlaceholder}
          />
        </Field>
      )}
    </>
  );
}
