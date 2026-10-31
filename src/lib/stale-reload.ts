/**
 * Self-heal for stale preview tabs: when the dev server restarts, an open tab
 * still holds URLs of modules from the previous run, so lazy route imports
 * fail with "Failed to fetch dynamically imported module" and the screen goes
 * blank. Detect that exact failure and reload once (guarded against loops).
 */

const RELOADED_AT_KEY = "aliz-stale-reload-at";
const RELOAD_GUARD_MS = 30_000;

/** True for the stale-module fetch failure, not for ordinary network errors. */
export function isStaleModuleError(message: string): boolean {
  return /dynamically imported module|error loading script|vite:preload/i.test(message);
}

function reloadOnce() {
  const last = Number(sessionStorage.getItem(RELOADED_AT_KEY) || 0);
  if (Date.now() - last < RELOAD_GUARD_MS) return;
  sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  window.location.reload();
}

/** Install global listeners. Call once from a useEffect in the root route. */
export function installStaleModuleReload() {
  if (typeof window === "undefined") return;
  // Vite fires this when a code-split chunk fails to load.
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnce();
  });
  // TanStack Router surfaces lazy-route import failures as rejections/errors.
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string } | string | undefined;
    const message = typeof reason === "string" ? reason : (reason?.message ?? "");
    if (isStaleModuleError(message)) reloadOnce();
  });
  window.addEventListener("error", (event) => {
    if (isStaleModuleError(event.message ?? "")) reloadOnce();
  });
}
