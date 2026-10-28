import { createFileRoute } from "@tanstack/react-router";
import Tracking from "@/aliz/tracking";

export const Route = createFileRoute("/track/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "متابعة البلاغ" }, { name: "robots", content: "noindex" }] }),
  component: function TrackPage() {
    const { token } = Route.useParams();
    return <Tracking token={token} />;
  },
});
