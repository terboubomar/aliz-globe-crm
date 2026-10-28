import { useEffect, useRef } from "react";
import { X, LoaderCircle, Inbox } from "lucide-react";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="إغلاق">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={32} />
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}
export function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button className="primary" type="submit" disabled={busy}>
      {busy ? <LoaderCircle className="spin" size={18} /> : null}
      {busy ? "جارٍ الحفظ…" : children}
    </button>
  );
}
export function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={"field" + (full ? " full" : "")}>
      <span>{label}</span>
      {children}
    </label>
  );
}
