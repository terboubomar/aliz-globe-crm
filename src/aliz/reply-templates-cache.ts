import { useEffect, useState } from "react";
import type { ReplyTemplate } from "@/lib/reply-templates";
import { api } from "./types";

/* Reply templates are read by every complaint form; one shared copy per page. */
let cache: Promise<ReplyTemplate[]> | null = null;
export function loadReplyTemplates(fresh = false) {
  if (!cache || fresh)
    cache = api<{ templates: ReplyTemplate[] }>("templates/replies")
      .then((r) => r.templates)
      .catch(() => {
        cache = null;
        return [];
      });
  return cache;
}
export function useReplyTemplates() {
  const [list, setList] = useState<ReplyTemplate[]>([]);
  useEffect(() => {
    let live = true;
    void loadReplyTemplates().then((t) => live && setList(t));
    return () => {
      live = false;
    };
  }, []);
  return list;
}
export function setReplyTemplatesCache(list: ReplyTemplate[]) {
  cache = Promise.resolve(list);
}
