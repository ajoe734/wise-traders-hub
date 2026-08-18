/**
 * Single source for the backend base URL used by hand-rolled fetch() calls.
 *
 * The project id must never be baked into the bundle as a literal: clone /
 * rehearsal builds inject a different `VITE_SUPABASE_URL`, and a hardcoded
 * fallback silently points those builds at production.
 */
const RAW = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");

export const SUPABASE_BASE_URL =
  RAW || (typeof window !== "undefined" ? window.location.origin : "");

export const functionUrl = (name: string) => `${SUPABASE_BASE_URL}/functions/v1/${name}`;
