// Shared helpers for edge-function contract tests.
//
// Loads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from the project
// .env (via Deno dotenv) so individual *_test.ts files stay short.

import "https://deno.land/std@0.224.0/dotenv/load.ts";

export const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
export const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env");
}

export function fnUrl(name: string, query?: Record<string, string>): string {
  const url = new URL(`${SUPABASE_URL}/functions/v1/${name}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

export function authHeaders(extra: HeadersInit = {}): HeadersInit {
  return {
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "apikey": SUPABASE_ANON_KEY,
    ...extra,
  };
}

/** Drain body to avoid Deno resource leaks. */
export async function drain(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ""; }
}

/** Assert basic CORS + x-correlation-id contract on a response. */
export function assertCorsAndCorrelation(res: Response, expectedCid?: string): string {
  const origin = res.headers.get("access-control-allow-origin");
  if (origin !== "*") {
    throw new Error(`expected Access-Control-Allow-Origin=*, got ${origin}`);
  }
  const cid = res.headers.get("x-correlation-id");
  if (!cid) throw new Error("missing x-correlation-id in response");
  if (expectedCid && cid !== expectedCid) {
    throw new Error(`x-correlation-id mismatch: expected ${expectedCid}, got ${cid}`);
  }
  return cid;
}

/** OPTIONS preflight: must return 200 + CORS headers + accept x-correlation-id. */
export async function runPreflightTest(fn: string) {
  const res = await fetch(fnUrl(fn), {
    method: "OPTIONS",
    headers: {
      "Origin": "https://example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type, x-correlation-id",
    },
  });
  await drain(res);
  if (res.status !== 200 && res.status !== 204) {
    throw new Error(`OPTIONS expected 200/204, got ${res.status}`);
  }
  const origin = res.headers.get("access-control-allow-origin");
  if (origin !== "*") throw new Error(`OPTIONS missing CORS origin: ${origin}`);
  const allowH = (res.headers.get("access-control-allow-headers") || "").toLowerCase();
  for (const h of ["authorization", "content-type", "x-correlation-id"]) {
    if (!allowH.includes(h)) throw new Error(`OPTIONS Allow-Headers missing "${h}": ${allowH}`);
  }
}
