// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// tw-ocr-replay/index.ts
// On-demand HTTP 端點：從伺服端 fixtures 目錄跑 replay，回傳結構化 report。
// 僅 company_admin 可存取；生產不會主動呼叫，供後台/CI dispatch 手動觸發。
import { corsHeaders } from "../_shared/cors.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { runReplay, loadFixturesFromDir, type ReplayReport } from "./replay.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FIXTURE_DIR = new URL("./fixtures", import.meta.url).pathname;

Deno.serve(async (req) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
  let callerId: string;
  try {
    callerId = await requireCompanyAdmin(req);
  } catch (e) {
    return authErrorResponse(e, req);
  }

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
