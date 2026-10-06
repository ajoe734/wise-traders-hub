/**
 * official-registry-sync：每日同步官方公司基本資料名錄到 official_share_registry。
 * - 僅接受排程金鑰（X-Cron-Key）。
 * - 來源：TWSE t187ap03_L／TPEx mopsfin_t187ap03_O（TPEx 擋預設 UA，需帶瀏覽器 UA）。
 * - 官方站台 inline 抓取需 30 秒以上，估值函式不得現抓；此表是唯一權威來源。
 * - 每次執行寫 system_jobs_log；任一來源失敗即 status='degraded'，不靜默。
 */
// AUTH: cron
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts';
import { fetchWithRetry } from '../_shared/retryFetch.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { officialFromTpex, officialFromTwse } from '../_shared/fundamentalsBasis.ts';

const TWSE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 90_000;

async function fetchList(url: string, src: 'TWSE' | 'TPEx'): Promise<Array<Record<string, string>>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal }, {
      source: `official_${src}`, policy: { maxAttempts: 3 },
    });
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error(`${src} 公司基本資料格式錯誤`);
    return json as Array<Record<string, string>>;
  } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const started = Date.now();
  try {
    requireCronKey(req);
    const supa = serviceClient();
    const results = await Promise.allSettled([fetchList(TWSE_URL, 'TWSE'), fetchList(TPEX_URL, 'TPEx')]);
    const rows: Array<Record<string, unknown>> = [];
    const failures: string[] = [];
    const counts: Record<string, number> = {};
    results.forEach((r, i) => {
      const src = i === 0 ? 'TWSE' : 'TPEx';
      if (r.status === 'rejected') { failures.push(`${src}: ${(r.reason as Error)?.message}`); counts[src] = 0; return; }
      const parse = src === 'TWSE' ? officialFromTwse : officialFromTpex;
      const codeKey = src === 'TWSE' ? '公司代號' : 'SecuritiesCompanyCode';
      let n = 0;
      for (const raw of r.value) {
        const symbol = raw[codeKey];
        const o = parse(raw);
        // 面額或已發行股數無法解析（外國公司、特別股單獨列等）→ 略過，不寫入名錄。
        if (!symbol || !o || !(o.par > 0) || !(o.issuedShares > 0)) continue;
        rows.push({
          symbol, par: o.par, par_text: o.parText, issued_shares: o.issuedShares,
          preferred_shares: o.preferredShares ?? 0, paid_in_capital: o.paidInCapital ?? null,
          source: src, report_date: o.reportDate ?? null, fetched_at: new Date().toISOString(),
        });
        n++;
      }
      counts[src] = n;
    });
    if (rows.length) {
      const { error } = await supa.from('official_share_registry').upsert(rows, { onConflict: 'symbol' });
      if (error) throw new Error(`upsert: ${error.message}`);
    }
    const status = failures.length ? 'degraded' : 'ok';
    await supa.from('system_jobs_log').insert({
      job_name: 'official-registry-sync', status,
      detail: { counts, failures, upserted: rows.length },
      duration_ms: Date.now() - started,
    });
    if (failures.length) {
      await supa.from('system_alerts').insert({
        kind: 'official_registry_sync_degraded', level: 'warn',
        title: '官方股數名錄同步部分失敗',
        message: failures.join('；'),
        detail: { counts, failures },
      });
    }
    return jsonResponse({ ok: !failures.length, counts, failures, upserted: rows.length }, {}, req);
  } catch (e) {
    if (e instanceof AuthError) return errorResponse(e.message, e.status, { code: e.code }, req);
    try {
      await serviceClient().from('system_jobs_log').insert({
        job_name: 'official-registry-sync', status: 'failed',
        detail: { error: e instanceof Error ? e.message : String(e) },
        duration_ms: Date.now() - started,
      });
    } catch { /* ignore */ }
    return errorResponse(e instanceof Error ? e.message : String(e), 502, { code: 'UPSTREAM_FAILED' }, req);
  }
});
