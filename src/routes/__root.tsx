import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import cairo400 from "@fontsource/cairo/400.css?url";
import cairo600 from "@fontsource/cairo/600.css?url";
import cairo700 from "@fontsource/cairo/700.css?url";
import cairo800 from "@fontsource/cairo/800.css?url";
import alizCss from "../aliz/style.css?url";
import alizExtraCss from "../aliz/lovable.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { installStaleModuleReload } from "../lib/stale-reload";
import { supabase } from "@/integrations/supabase/client";

function NotFoundComponent() {
  return (
    <main className="public-shell">
      <section className="public-card">
        <h1>الصفحة غير موجودة</h1>
        <p>تحقق من الرابط أو عد إلى مساحة العمل.</p>
        <Link to="/" className="primary">
          العودة
        </Link>
      </section>
    </main>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <main className="public-shell">
      <section className="public-card">
        <h1>تعذر تحميل الصفحة</h1>
        <button
          className="primary"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          إعادة المحاولة
        </button>
      </section>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "أليز غلوب | إدارة تجربة العملاء" },
      { name: "description", content: "مساحة عمل موحّدة لتجربة العملاء وعمليات الفروع" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
    links: [
      // Cairo is bundled locally, as in the original app: no third-party font request.
      { rel: "stylesheet", href: cairo400 },
      { rel: "stylesheet", href: cairo600 },
      { rel: "stylesheet", href: cairo700 },
      { rel: "stylesheet", href: cairo800 },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: alizCss },
      { rel: "stylesheet", href: alizExtraCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* Runs before the app bundle: if the entry module itself is stale after a
            dev-server restart, the in-app listener never installs, so reload once here. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var K="aliz-stale-reload-at";function r(){try{var l=+sessionStorage.getItem(K)||0;if(Date.now()-l<30000)return;sessionStorage.setItem(K,String(Date.now()));}catch(e){}location.reload();}function s(m){return /dynamically imported module|error loading script|vite:preload/i.test(m||"");}addEventListener("unhandledrejection",function(e){var x=e.reason;if(s(typeof x==="string"?x:x&&x.message))r();});addEventListener("error",function(e){if(s(e.message))r();});})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => installStaleModuleReload(), []);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (
        event !== "SIGNED_IN" &&
        event !== "SIGNED_OUT" &&
        event !== "USER_UPDATED" &&
        event !== "MFA_CHALLENGE_VERIFIED"
      )
        return;
      router.invalidate();
      if (event === "SIGNED_OUT") queryClient.clear();
      else queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
