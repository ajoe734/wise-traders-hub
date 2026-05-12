// Detects mismatches between the bundled app version (__APP_VERSION__,
// injected by Vite at build time) and the latest deployed version
// (served at /version.json). When the running client is stale —
// typically because the user has cached an old chunk — we wipe local
// caches and force a hard reload so they pull fresh assets.

declare const __APP_VERSION__: string;

const VERSION_URL = "/version.json";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 min while tab is open
const RELOAD_GUARD_KEY = "lf-version-reload-at";
const RELOAD_COOLDOWN_MS = 60 * 1000; // avoid reload loops
const STORAGE_KEYS_TO_CLEAR = ["lf-app-cache-v1"];

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

function purgeClientCaches() {
  let lastReloadAt: string | null = null;
  try {
    lastReloadAt = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
    for (const key of STORAGE_KEYS_TO_CLEAR) {
      window.localStorage.removeItem(key);
    }
    window.sessionStorage.clear();
    if (lastReloadAt) {
      window.sessionStorage.setItem(RELOAD_GUARD_KEY, lastReloadAt);
    }
  } catch {
    // ignore storage access failures
  }
  // Best-effort wipe of CacheStorage (service worker / HTTP caches we own)
  if ("caches" in window) {
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {});
  }
}

function forceReload() {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return; // already reloaded recently
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  purgeClientCaches();
  // Cache-busting query so the document itself isn't served stale
  const url = new URL(window.location.href);
  url.searchParams.set("__v", String(Date.now()));
  window.location.replace(url.toString());
}

async function checkOnce() {
  const latest = await fetchLatestVersion();
  if (!latest) return;
  if (latest !== BUNDLED_VERSION) {
    // eslint-disable-next-line no-console
    console.warn(
      `[versionCheck] bundle ${BUNDLED_VERSION} is stale (latest ${latest}); reloading`,
    );
    forceReload();
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
  window.addEventListener("vite:preloadError", () => {
    forceReload();
  });
}
