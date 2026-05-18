// Detects mismatches between the bundled app version (__APP_VERSION__,
// injected by Vite at build time) and the latest deployed version
// (served at /version.json). When the running client is stale —
// typically because the user has cached an old chunk — we wipe local
// caches and force a hard reload so they pull fresh assets.

import { reloadForFreshBundle } from "./staleChunkRecovery";

declare const __APP_VERSION__: string;

const VERSION_URL = "/version.json";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 min while tab is open

const BUNDLED_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data?.version ?? null;
  } catch {
    return null;
  }
}

async function checkOnce() {
  const latest = await fetchLatestVersion();
  if (!latest) return;
  if (latest !== BUNDLED_VERSION) {
    // eslint-disable-next-line no-console
    console.warn(
      `[versionCheck] bundle ${BUNDLED_VERSION} is stale (latest ${latest}); reloading`,
    );
    reloadForFreshBundle();
  }
}

export function installVersionCheck() {
  if (typeof window === "undefined") return;
  if (BUNDLED_VERSION === "dev") return; // no-op in dev

  try {
    document.documentElement.dataset.appBooted = "1";
  } catch {
    // ignore
  }

  // 1. Initial check shortly after boot (don't block first paint)
  window.setTimeout(() => {
    void checkOnce();
  }, 1500);

  // 2. Periodic check while tab stays open
  window.setInterval(() => {
    if (document.visibilityState === "visible") void checkOnce();
  }, CHECK_INTERVAL_MS);

  // 3. Re-check when the tab regains focus (covers laptop-sleep case)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkOnce();
  });

  // 4. Vite preload error → almost always a stale chunk; clear & reload
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault?.();
    reloadForFreshBundle();
  });
}
