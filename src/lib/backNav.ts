import { useCallback } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

/**
 * Route state shape for "where did the user come from".
 * Pass via `navigate(to, { state: { from: locationToFrom(location) } })`
 * or `<Link to={...} state={{ from: locationToFrom(location) }} />`.
 */
export type FromState = { pathname: string; search?: string };

export function locationToFrom(loc: Pick<Location, 'pathname' | 'search'>): FromState {
  return { pathname: loc.pathname, search: loc.search || '' };
}

function readFrom(state: unknown): FromState | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as { from?: unknown };
  const f = s.from;
  if (!f || typeof f !== 'object') return null;
  const p = (f as { pathname?: unknown }).pathname;
  if (typeof p !== 'string' || !p.startsWith('/')) return null;
  const search = (f as { search?: unknown }).search;
  return { pathname: p, search: typeof search === 'string' ? search : '' };
}

/**
 * Returns a stable `goBack()` that prefers an explicit
 * `location.state.from` set by the caller, otherwise navigates to `fallback`.
 *
 * We deliberately do NOT default to `navigate(-1)` — browser history is
 * unreliable when users arrive via redirects, toasts, login round-trips,
 * or guards, and it has been sending users back to the holdings dashboard.
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    const from = readFrom(location.state);
    if (from) {
      navigate(`${from.pathname}${from.search ?? ''}`);
      return;
    }
    navigate(fallback);
  }, [navigate, location.state, fallback]);
}
