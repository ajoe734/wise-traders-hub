// Single source of truth for creating Supabase clients inside edge functions.
//
//   serviceClient()      → bypasses RLS, uses SUPABASE_SERVICE_ROLE_KEY
//   userClient(req)      → respects RLS as the caller, forwards their JWT
//
// Why this exists:
//   - Eliminates 50+ inline `createClient(SUPABASE_URL, KEY)` calls that drift
//     in their pin (some at @2.45.0, some at @2.49.1) and option set.
//   - Centralizes the choice of import specifier (`npm:` over `https://esm.sh`)
//     so a single upgrade rolls forward.
//   - Forces explicit choice of "service role" vs "as-user" — both are common
//     edge patterns and confusing them is a real privilege bug.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';

export function serviceClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('serviceClient: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function userClient(req: Request): SupabaseClient {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('userClient: SUPABASE_URL or SUPABASE_ANON_KEY not set');
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  });
}

/** Extract the auth user id from a request, or null if unauthenticated. */
export async function getCallerUserId(req: Request): Promise<string | null> {
  try {
    const { data, error } = await userClient(req).auth.getUser();
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export type { SupabaseClient };
