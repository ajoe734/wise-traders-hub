/**
 * refresh-industry-chain —— 每月同步櫃買「產業價值鏈資訊平台」成員（已取得櫃買中心授權）。
 * 寫入 public.industry_chain_membership；分類採用由 _shared/chainClassification.ts 決定，
 * 只對未人工確認、且平台子項與主業一致者寫入依據（evidence）。
 * AUTH: cron-key
 */
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { fetchWithRetry } from '../_shared/retryFetch.ts';
import { listChainCodes, parseChainPage, type ParsedChainRow } from '../_shared/tpexChainParser.ts';
import { resolveChainClassification, type ChainSourceMap } from '../_shared/chainClassification.ts';
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
  try {
    const db = serviceClient();
    const codes = listChainCodes(await getText(BASE + 'index.php'));
    const rows: ParsedChainRow[] = [];
    for (const code of codes) rows.push(...parseChainPage(await getText(`${BASE}introduce.php?ic=${code}`), code));
    if (rows.length < 3000) return json({ error: 'parsed too few rows, aborting', rows: rows.length }, 502);

    const fetchedAt = new Date().toISOString();
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('industry_chain_membership').upsert(
        rows.slice(i, i + 500).map((r) => ({
          symbol: r.symbol, name: r.name, chain: r.chain, chain_code: r.chainCode, sub_code: r.subCode,
          sub_item: r.subItem, tier: r.tier, source_url: `${BASE}introduce.php?ic=${r.chainCode}`, fetched_at: fetchedAt,
        })),
        { onConflict: 'symbol,sub_code' },
      );
      if (error) throw new Error(error.message);
    }

    const bySym = new Map<string, ParsedChainRow[]>();
    for (const r of rows) bySym.set(r.symbol, [...(bySym.get(r.symbol) ?? []), r]);
    const map = (taxonomy as unknown as { chainSourceMap: ChainSourceMap }).chainSourceMap;
    const counts: Record<string, number> = {};
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('stock_industry_map')
        .select('symbol, industries, revenue_mix, reviewed, confidence, evidence').order('symbol').range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        if (isAdoptedClassification(row)) continue;
        const r = resolveChainClassification({
          members: (bySym.get(row.symbol) ?? []).map((m) => ({ chain: m.chain, tier: m.tier, subCode: m.subCode, subItem: m.subItem })),
          current: row.industries, revenueMix: row.revenue_mix, map, isValidIndustry,
        });
        counts[r.status] = (counts[r.status] ?? 0) + 1;
        if (r.status !== 'adopted') continue;
        const industries = [r.industry!, ...(row.industries ?? []).filter((x: string) => x !== r.industry)];
        const { error: e2 } = await db.from('stock_industry_map').update({
          industries, confidence: 0.95, evidence: r.evidence, chain_tier: r.tier, source: 'tpex_chain', updated_at: fetchedAt,
        }).eq('symbol', row.symbol).neq('reviewed', true);
        if (e2) throw new Error(e2.message);
      }
      if (!data || data.length < 1000) break;
    }
    return json({ ok: true, chains: codes.length, rows: rows.length, pending: counts });
  } catch (e) {
    console.error('refresh-industry-chain failed', e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
