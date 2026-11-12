/**
 * Self-heal for stale preview tabs: when the dev server restarts, an open tab
 * still holds URLs of modules from the previous run, so the entry module or a
 * lazy route import fails with "Failed to fetch dynamically imported module"
 * and the screen goes blank. Detect that and reload — with a bounded number of
 * attempts so a genuinely broken page can never loop forever.
 *
 * The same logic runs twice on purpose:
 *  - inline in the root shell's <head> (src/routes/__root.tsx), because when the
 *    entry module itself is stale no in-app code ever runs;
 *  - here, once the app has mounted, for route chunks that fail later.
 */

const ATTEMPTS_KEY = "aliz-stale-reload-attempts";
const ATTEMPT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 3;

/** How long to wait for the app to report that it booted before reloading. */
export const BOOT_TIMEOUT_MS = 12_000;

/** True for the stale-module fetch failure, not for ordinary network errors. */
export function isStaleModuleError(message: string): boolean {
  return /dynamically imported module|error loading script|vite:preload/i.test(message || "");
}

/**
 * True when the thing that failed to load is one of this app's own scripts.
 * A script load failure fires a plain, non-bubbling `error` event on the
 * element (no `message`), so it has to be caught in the capture phase and
 * recognised by its target. Third-party scripts are ignored on purpose.
 */
export function isLocalScriptLoadError(src: string | null | undefined, base: string): boolean {
  if (!src) return false;
  try {
    return new URL(src, base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * Pure reload budget: at most MAX_ATTEMPTS reloads inside ATTEMPT_WINDOW_MS, so
 * a page whose modules are stale twice in a row still gets a second and third
 * chance instead of staying blank.
 */
export function shouldReloadAfterStaleModule(attempts: number[], now: number): boolean {
  return attempts.filter((at) => now - at < ATTEMPT_WINDOW_MS).length < MAX_ATTEMPTS;
}

function readAttempts(): number[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((at) => typeof at === "number") : [];
  } catch {
    return [];
  }
}

function reloadWithinBudget(now = Date.now()): boolean {
  if (!shouldReloadAfterStaleModule(readAttempts(), now)) return false;
  try {
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify([...readAttempts(), now]));
  } catch {
    // Storage can be unavailable (private mode); reloading is still the right call.
  }
  window.location.reload();
  return true;
}

/** Install global listeners. Call once from a useEffect in the root route. */
export function installStaleModuleReload() {
  if (typeof window === "undefined") return;
  // Tells the <head> watchdog this page is alive, so it stops reloading.
  (window as { __alizBooted?: boolean }).__alizBooted = true;

  // Vite fires this when a code-split chunk fails to load.
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadWithinBudget();
  });

  // TanStack Router surfaces lazy-route import failures as rejections/errors.
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: string } | string | undefined;
    const message = typeof reason === "string" ? reason : (reason?.message ?? "");
    if (isStaleModuleError(message)) reloadWithinBudget();
  });

  // Capture phase: a script that fails to fetch reports on the element itself.
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target as { tagName?: string; src?: string } | null;
      const isScript =
        !!target && target.tagName === "SCRIPT" && isLocalScriptLoadError(target.src, window.location.href);
      if (isScript || isStaleModuleError(event.message ?? "")) reloadWithinBudget();
    },
    true,
  );
}
