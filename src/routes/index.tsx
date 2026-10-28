import { createFileRoute } from "@tanstack/react-router";
import CRM from "@/aliz/crm";

export const Route = createFileRoute("/")({
  // The staff workspace is client-rendered: the Supabase session lives in the browser.
  ssr: false,
  head: () => ({
    meta: [
      { title: "أليز غلوب | إدارة تجربة العملاء" },
      { name: "description", content: "مساحة عمل موحّدة لتجربة العملاء وعمليات الفروع" },
    ],
  }),
  component: CRM,
});
