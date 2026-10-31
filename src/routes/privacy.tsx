import { createFileRoute } from "@tanstack/react-router";
import PrivacyNotice from "@/aliz/privacy";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "إشعار الخصوصية | أليز غلوب" }] }),
  component: PrivacyNotice,
});
