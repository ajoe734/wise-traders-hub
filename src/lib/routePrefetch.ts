/**
 * Route chunk prefetcher.
 *
 * Triggers dynamic `import()` of lazy-loaded route modules during browser
 * idle time so a subsequent navigation hits an already-warm chunk cache
 * (zero TTFB on Suspense fallback).
 *
 * Usage:
 *   prefetchRoute("login", () => import("@/pages/auth/Login"));
 *
 * Each key only fires once per session. Failures un-cache so a later hover
 * (or actual navigation) can retry.
 */

type Loader = () => Promise<unknown>;

const inflight = new Set<string>();

function schedule(cb: () => void) {
  if (typeof window === "undefined") return;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(cb, { timeout: 2500 });
  } else {
    setTimeout(cb, 250);
  }
}

export function prefetchRoute(key: string, loader: Loader) {
  if (typeof window === "undefined") return;
  if (inflight.has(key)) return;
  inflight.add(key);
  schedule(() => {
    loader().catch(() => {
      inflight.delete(key);
    });
  });
}

/**
 * Prefetch a curated list of high-traffic public routes shortly after the
 * shell is interactive. Anything below the fold or behind auth stays lazy.
 */
export function prefetchHighTrafficRoutes() {
  prefetchRoute("login", () => import("@/pages/auth/Login"));
  prefetchRoute("register", () => import("@/pages/auth/Register"));
  prefetchRoute("pricing", () => import("@/pages/Pricing"));
  prefetchRoute("experts", () => import("@/pages/Experts"));
  prefetchRoute("legal", () => import("@/pages/Legal"));
}
