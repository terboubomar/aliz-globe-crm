import { useEffect, useState, type ReactNode } from "react";
import { evidenceUrl } from "./adapter";

/**
 * A stored photo as a link + thumbnail, like the original markup. Photos are
 * private: the server returns a short-lived signed link, and only for files
 * the malware scan marked clean.
 */
export function EvidenceLink({
  id,
  alt,
  children,
}: {
  id: string;
  alt: string;
  children: ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null),
    [state, setState] = useState<"loading" | "ready" | "pending">("loading");
  useEffect(() => {
    let alive = true;
    evidenceUrl(id)
      .then((u) => {
        if (!alive) return;
        setUrl(u);
        setState(u ? "ready" : "pending");
      })
      .catch(() => alive && setState("pending"));
    return () => {
      alive = false;
    };
  }, [id]);
  if (state !== "ready" || !url)
    return (
      <a aria-disabled="true">
        <span className="evidence-pending">
          {state === "loading" ? "جارٍ التحميل…" : "بانتظار فحص الأمان"}
        </span>
        {children}
      </a>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={alt} />
      {children}
    </a>
  );
}
