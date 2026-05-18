const RELOAD_GUARD_KEY = "lf-version-reload-at";
const RELOAD_COOLDOWN_MS = 60 * 1000;
const STORAGE_KEYS_TO_CLEAR = ["lf-app-cache-v1"];

const STALE_CHUNK_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|Load failed|error loading dynamically imported module|vite:preloadError|chunk/i;

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : String(message ?? "");
  }
  return String(error ?? "");
}

function canReload(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    return true;
  } catch {
    return true;
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

  if ("caches" in window) {
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .catch(() => {});
  }
}

export function isStaleChunkError(error: unknown): boolean {
  return STALE_CHUNK_RE.test(getErrorMessage(error));
}

export function reloadForFreshBundle(targetHref?: string): boolean {
  if (typeof window === "undefined") return false;
  if (!canReload()) return false;

  purgeClientCaches();

  const url = new URL(targetHref || window.location.href, window.location.href);
  url.searchParams.set("__v", String(Date.now()));
  window.location.replace(url.toString());
  return true;
}