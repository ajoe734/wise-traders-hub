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
 *
 * Only runs in production builds. In dev / Lovable preview, Vite serves each
 * lazy chunk through a full transform round-trip, so idle-time prefetching
 * actively competes with the modules the current page needs to render and
 * adds 1+ second to FCP. Production bundles are already pre-chunked, so
 * idle prefetch is safe (and useful) there.
 */
export function prefetchHighTrafficRoutes() {
  if (typeof import.meta !== "undefined" && !import.meta.env?.PROD) return;
  prefetchRoute("login", () => import("@/pages/auth/Login"));
  prefetchRoute("register", () => import("@/pages/auth/Register"));
  prefetchRoute("pricing", () => import("@/pages/Pricing"));
  prefetchRoute("experts", () => import("@/pages/Experts"));
  prefetchRoute("expert-profile", () => import("@/pages/ExpertProfile"));
  prefetchRoute("app-home", () => import("@/pages/app/AppHome"));
}

/**
 * Intent-based prefetch — wire to `onMouseDown` / `onTouchStart` /
 * `onFocus` of links and CTAs that frequently launch a navigation.
 *
 * PROD-only: in dev / Lovable preview, Vite would re-transform the lazy
 * chunk on every hover and steal bandwidth from whatever the user is
 * currently looking at. Production bundles are pre-built, so intent-time
 * prefetch is essentially free.
 */
export function prefetchOnIntent(key: string, loader: Loader) {
  return () => {
    if (typeof import.meta !== "undefined" && !import.meta.env?.PROD) return;
    prefetchRoute(key, loader);
  };
}

/**
 * Centralized loader registry for high-traffic routes so call sites
 * stay declarative: `<Link {...intentHandlers("expert-profile")} />`.
 */
const INTENT_LOADERS: Record<string, Loader> = {
  login: () => import("@/pages/auth/Login"),
  register: () => import("@/pages/auth/Register"),
  pricing: () => import("@/pages/Pricing"),
  experts: () => import("@/pages/Experts"),
  "expert-profile": () => import("@/pages/ExpertProfile"),
  "plan-detail": () => import("@/pages/PlanDetail"),
  "app-home": () => import("@/pages/app/AppHome"),
  "app-explore": () => import("@/pages/app/Explore"),
  "app-expert-detail": () => import("@/pages/app/ExpertDetail"),
  "app-signals": () => import("@/pages/app/Signals"),
  "app-journals": () => import("@/pages/app/Journals"),
  "app-account": () => import("@/pages/app/Account"),
};

/**
 * Returns event handlers to spread onto a `<Link>` / `<Button>` for
 * intent-time chunk prefetching. No-op (returns `undefined` handlers)
 * for unknown keys or in dev mode.
 */
export function intentHandlers(key: keyof typeof INTENT_LOADERS) {
  const loader = INTENT_LOADERS[key];
  if (!loader) return {};
  const fire = prefetchOnIntent(key, loader);
  return {
    onMouseDown: fire,
    onTouchStart: fire,
    onFocus: fire,
  };
}
