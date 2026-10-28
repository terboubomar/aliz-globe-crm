import { createFileRoute } from "@tanstack/react-router";
import PublicIntake from "@/aliz/public-intake";

export const Route = createFileRoute("/q/$code")({
  ssr: false,
  head: () => ({ meta: [{ title: "شاركنا ملاحظتك" }, { name: "robots", content: "noindex" }] }),
  component: function QrPage() {
    const { code } = Route.useParams();
    return <PublicIntake code={code} />;
  },
});
