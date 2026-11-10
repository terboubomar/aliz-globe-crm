import { ArrowLeft, Headset, LogOut, Wrench } from "lucide-react";
import { greeting } from "@/lib/dashboard";
import { appLabels, type AppId } from "./access";

/** After signing in, people with more than one app pick where to start. */
const details: Record<AppId, string> = {
  cs: "شكاوى العملاء والاسترجاع والمتابعة",
  maintenance: "طلبات صيانة الفروع ومتابعة الإصلاح",
};

export function AppLauncher({
  name,
  apps,
  onPick,
  onSignOut,
}: {
  name: string;
  apps: AppId[];
  onPick: (app: AppId) => void;
  onSignOut: () => void;
}) {
  return (
    <main className="app-launcher">
      <header>
        <img src="/logos/aliz.webp" alt="Aliz Globe Company" />
        <button type="button" className="text-btn" onClick={onSignOut}>
          <LogOut size={16} /> تسجيل الخروج
        </button>
      </header>
      <section>
        <h1>
          {greeting()}، {name.split(" ")[0]}
        </h1>
        <p>اختر التطبيق</p>
        <div className="app-launcher-cards">
          {apps.map((id) => {
            const Icon = id === "maintenance" ? Wrench : Headset;
            return (
              <button
                key={id}
                type="button"
                className={"app-card " + id}
                onClick={() => onPick(id)}
              >
                <span className="app-card-icon" aria-hidden="true">
                  <Icon size={30} strokeWidth={1.8} />
                </span>
                <span className="app-card-text">
                  <b>{appLabels[id]}</b>
                  <small>{details[id]}</small>
                </span>
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
