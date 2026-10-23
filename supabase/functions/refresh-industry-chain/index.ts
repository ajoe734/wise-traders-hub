/**
 * refresh-industry-chain —— 每月同步櫃買「產業價值鏈資訊平台」成員（已取得櫃買中心授權）。
 * 寫入 public.industry_chain_membership；分類採用由 _shared/chainClassification.ts 決定，
 * 只對未人工確認、且平台子項與主業一致者寫入依據（evidence）。
 * AUTH: cron-key
 */
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { z } from 'npm:zod@4';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { fetchWithRetry } from '../_shared/retryFetch.ts';
import { listChainCodes, parseChainPage, type ParsedChainRow } from '../_shared/tpexChainParser.ts';
import { type ChainSourceMap } from '../_shared/chainClassification.ts';
import { buildChainReview, type ChainReviewRow } from '../_shared/chainRefreshCore.ts';
import { mapProductShares, type ProductShare, type ProductSourceMap } from '../_shared/annualReportMix.ts';
import { isValidIndustry, isAdoptedClassification } from '../_shared/industryTaxonomy.ts';
import taxonomy from '../_shared/industryTaxonomy.json' with { type: 'json' };

const BASE = 'https://ic.tpex.org.tw/';
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function getText(url: string) {
  const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'legendflow-chain-sync' } }, { source: 'tpex_ic' });
  if (!res.ok) throw new Error(`[${res.status}] ${url}`);
  return await res.text();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    requireCronKey(req);
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.message }, err.status);
    throw err;
  }
  const started = Date.now();
  const db = serviceClient();
  try {
    const body = await req.text();
    let raw: unknown;
    try { raw = body.trim() ? JSON.parse(body) : {}; } catch { return json({ error: 'invalid JSON' }, 400); }
    const parsed = z.object({ dryRun: z.boolean().optional() }).strict().safeParse(raw);
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const dryRun = parsed.data.dryRun === true;
    const codes = listChainCodes(await getText(BASE + 'index.php'));
    const rows: ParsedChainRow[] = [];
    for (const code of codes) rows.push(...parseChainPage(await getText(`${BASE}introduce.php?ic=${code}`), code));
    if (rows.length < 3000) return json({ error: 'parsed too few rows, aborting', rows: rows.length }, 502);

    const fetchedAt = new Date().toISOString();
    for (let i = 0; !dryRun && i < rows.length; i += 500) {
      const { error } = await db.from('industry_chain_membership').upsert(
        rows.slice(i, i + 500).map((r) => ({
          symbol: r.symbol, name: r.name, chain: r.chain, chain_code: r.chainCode, sub_code: r.subCode,
          sub_item: r.subItem, tier: r.tier, source_url: `${BASE}introduce.php?ic=${r.chainCode}`, fetched_at: fetchedAt,
        })),
        { onConflict: 'symbol,sub_code' },
      );
      if (error) throw new Error(error.message);
    }

    const map = (taxonomy as unknown as { chainSourceMap: ChainSourceMap }).chainSourceMap;
    const stocks: ChainReviewRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('stock_industry_map')
        .select('symbol, industries, revenue_mix, reviewed, confidence, evidence, updated_at').order('symbol').range(from, from + 999);
      if (error) throw new Error(error.message);
      stocks.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    // 年報營業比重：只採解析核對通過者，每次依最新產品對照表重算，不沿用 AI 推估
    const productMap = (taxonomy as unknown as { productSourceMap?: ProductSourceMap }).productSourceMap ?? {};
    const { data: annual, error: eA } = await db.from('stock_annual_revenue_mix').select('symbol, products').eq('status', 'ok');
    if (eA) throw new Error(eA.message);
    const annualBy = new Map((annual ?? []).map((a: any) => [a.symbol, a.products as ProductShare[]]));
    for (const row of stocks) {
      const products = annualBy.get(row.symbol);
      if (!products) { row.revenue_mix_source = null; continue; }
      row.revenue_mix = mapProductShares(products, productMap, isValidIndustry).mix;
      row.revenue_mix_source = 'annual_report';
    }
    const report = buildChainReview({ rows: stocks, members: rows, map, isValidIndustry, isAdoptedClassification });
    const bySymbol = new Map(stocks.map(row => [row.symbol, row]));
    const applied: string[] = [];
    const concurrent: string[] = [];
    for (const r of report.results) {
        if (dryRun || r.status !== 'adopted' || !r.industry) continue;
        const row = bySymbol.get(r.symbol);
        if (!row) continue;
        const industries = [r.industry, ...(row.industries ?? []).filter((x: string) => x !== r.industry)].slice(0, 3);
        let update = db.from('stock_industry_map').update({
          industries, confidence: 0.95, evidence: r.evidence, chain_tier: r.tier, source: 'tpex_chain', updated_at: fetchedAt,
        }).eq('symbol', row.symbol).or('reviewed.eq.false,reviewed.is.null');
        update = row.updated_at ? update.eq('updated_at', row.updated_at) : update.is('updated_at', null);
        const { data: written, error: e2 } = await update.select('symbol');
        if (e2) throw new Error(e2.message);
        if (written?.length) applied.push(row.symbol); else concurrent.push(row.symbol);
    }
    const detail = { dryRun, chains: codes.length, rows: rows.length, reviewed: report.results.length, pending: report.counts, applied, concurrent, unmapped: report.unmapped, results: report.results };
    if (!dryRun) {
      const { error } = await db.from('system_jobs_log').insert({ job_name: 'refresh_industry_chain', status: 'success', duration_ms: Date.now() - started, detail });
      if (error) throw new Error(error.message);
    }
    return json({ ok: true, ...detail });
  } catch (e) {
    console.error('refresh-industry-chain failed', e);
    await db.from('system_jobs_log').insert({ job_name: 'refresh_industry_chain', status: 'error', duration_ms: Date.now() - started, detail: { error: String((e as Error)?.message ?? e) } });
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
