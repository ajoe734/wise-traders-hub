// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// tw-ocr-replay/index.ts
// On-demand HTTP 端點：從伺服端 fixtures 目錄跑 replay，回傳結構化 report。
// 僅 company_admin 可存取；生產不會主動呼叫，供後台/CI dispatch 手動觸發。
import { corsHeaders } from "../_shared/cors.ts";
import { runReplay, loadFixturesFromDir, type ReplayReport } from "./replay.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FIXTURE_DIR = new URL("./fixtures", import.meta.url).pathname;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "AUTH_REQUIRED" }, 401);

  let callerId = "";
  try {
    const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!ur.ok) return json({ error: "AUTH_FAILED" }, 401);
    callerId = (await ur.json())?.id || "";
  } catch { return json({ error: "AUTH_FAILED" }, 401); }
  if (!callerId) return json({ error: "AUTH_FAILED" }, 401);

  const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_role`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ _user_id: callerId, _role: "company_admin" }),
  });
  if (!roleRes.ok) return json({ error: "ROLE_CHECK_FAILED" }, 500);
  if ((await roleRes.json()) !== true) return json({ error: "FORBIDDEN" }, 403);

  let samples;
  try {
    samples = await loadFixturesFromDir(FIXTURE_DIR);
  } catch (e) {
    return json({ error: "FIXTURES_UNAVAILABLE", detail: (e as Error).message }, 500);
  }
  if (samples.length === 0) {
    return json({ error: "NO_FIXTURES", detail: `${FIXTURE_DIR}/labels.json 為空` }, 400);
  }

  let report: ReplayReport;
  try {
    report = await runReplay({ samples, perSampleDelayMs: 300 });
  } catch (e) {
    return json({ error: "REPLAY_FAILED", detail: (e as Error).message }, 500);
  }
  return json(report);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
