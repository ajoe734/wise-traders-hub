// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { validateInput, validationJsonResponse } from '../_shared/inputValidator.ts';
import { requireCaller, AuthError } from '../_shared/authGuard.ts';
// 手動續訂短連結：以 HMAC token 驗證 → 302 重導到正確 checkout 頁。
// 用於 LINE / Email 提醒，避免直接洩漏 plan_id 與 user_id 組合。
//
// Token 結構: base64url(JSON({sub_id, user_id, exp})).base64url(hmac_sha256)
// 預設 14 天有效；過期或簽章不符回 410。

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64urlEncode(new Uint8Array(sig));
}

async function signToken(payload: object, secret: string): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

async function verifyToken(token: string, secret: string): Promise<any | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  // constant-time compare
  if (sig.length !== expected.length) return null;
  let ok = 0;
  for (let i = 0; i < sig.length; i++) ok |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (ok !== 0) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (json.exp && Date.now() > json.exp) return null;
    return json;
  } catch {
    return null;
  }
}

Deno.serve(withLogging('subscribe-renew-link', async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // reuse as HMAC secret
  const siteUrl = (Deno.env.get("SITE_URL") || "https://legendflow.tw").replace(/\/$/, "");

  const url = new URL(req.url);

  // POST /sign  → return signed token (admin/edge use only; checks JWT)
  if (req.method === "POST") {
    // AUTH: user — POST /sign requires authenticated caller (M-3c contract)
    try { await requireCaller(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }
    try {
      const body = await req.json();
      const issues = validateInput({
        fields: {
          sub_id: { required: true, type: 'string', label: 'sub_id' },
          user_id: { required: true, type: 'string', label: 'user_id' },
          ttl_days: { required: false, type: 'number', label: 'ttl_days' },
        },
        source: body,
      });
      if (issues.length) return validationJsonResponse(issues);
      const { sub_id, user_id, ttl_days = 14 } = body;
      const exp = Date.now() + Math.max(1, Math.min(90, Number(ttl_days))) * 24 * 60 * 60 * 1000;
      const token = await signToken({ sub_id, user_id, exp }, secret);
      return new Response(JSON.stringify({
        token,
        url: `${siteUrl}/api/renew?t=${token}`,
        functionUrl: `${url.origin}${url.pathname}?t=${token}`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // GET ?t=token → 302 to checkout
  const token = url.searchParams.get("t");
  if (!token) {
    return new Response("Missing token", { status: 400, headers: corsHeaders });
  }

  const payload = await verifyToken(token, secret);
  if (!payload) {
    return new Response("Token invalid or expired", { status: 410, headers: corsHeaders });
  }

  // Resolve sub → plan + expert slug (or checkup)
  const admin = serviceClient();

  const { data: memberSub } = await admin
    .from("member_subscriptions")
    .select("id, user_id, plan_id, billing_cycle, expert_plans!inner(id, expert_id, experts!inner(slug))")
    .eq("id", payload.sub_id)
    .eq("user_id", payload.user_id)
    .maybeSingle();

  if (memberSub) {
    const slug = (memberSub.expert_plans as any)?.experts?.slug;
    const planId = memberSub.plan_id;
    const cycle = (memberSub as any).billing_cycle === "yearly" ? "yearly" : "monthly";
    if (slug && planId) {
      const target = renewalUrl(slug, planId, {
        baseUrl: siteUrl,
        query: { cycle, utm_source: "renewal_link" },
      });
      return new Response(null, { status: 302, headers: { ...corsHeaders, Location: target } });
    }
  }

  const { data: checkupSub } = await admin
    .from("checkup_subscriptions")
    .select("id, user_id, plan_id, billing_cycle")
    .eq("id", payload.sub_id)
    .eq("user_id", payload.user_id)
    .maybeSingle();

  if (checkupSub) {
    const cycle = (checkupSub as any).billing_cycle === "yearly" ? "yearly" : "monthly";
    const target = checkupRenewalUrl(checkupSub.plan_id, {
      baseUrl: siteUrl,
      query: { cycle, utm_source: "renewal_link" },
    });
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: target } });
  }

  return new Response("Subscription not found", { status: 404, headers: corsHeaders });
}));
