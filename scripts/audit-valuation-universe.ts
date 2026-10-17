/**
 * 估值站牌全市場稽核（唯讀）：逐檔用抽屜同一套純函式算站牌與 PE／PB／PS 分頁，
 * 檢查有沒有只對特定個股成立的寫死邏輯。可中斷續跑；FinMind 額度用盡即停。
 *
 * 用法：lovable auth-session --json --self 後
 *   bun run scripts/audit-valuation-universe.ts <symbols.txt> <out.jsonl> [limit]
 * symbols.txt 每行「代碼|名稱|細分產業」。
 */
import fs from 'node:fs';
import os from 'node:os';
import { buildValuationView } from '@/checkup/lib/valuationRulers';
import { scenarioFromFundamentals } from '@/checkup/hooks/useValuationSnapshot';
import { buildDrawerStations, selectedRulerBand } from '@/checkup/components/freecheckup/HoldingsDetailPanel';

const [, , listPath, outPath, limitArg] = process.argv;
const URL_ = process.env.VITE_SUPABASE_URL || 'https://yqacmrgdjlenbijclngi.supabase.co';
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const sess = JSON.parse(fs.readFileSync(`${os.homedir()}/.cache/lovable-auth/session.json`, 'utf8'));
const token: string = sess.session?.access_token ?? sess.access_token;
const H = { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const done = new Set<string>(fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).code) : []);
const list = fs.readFileSync(listPath, 'utf8').trim().split('\n').map((l) => l.split('|')).filter(([c]) => !done.has(c));
const limit = Number(limitArg) || list.length;

async function one(code: string, name: string, industry: string) {
  const r1 = await fetch(`${URL_}/rest/v1/rpc/valuation_snapshot`, { method: 'POST', headers: H, body: JSON.stringify({ _symbol: code }) });
  const raw = await r1.json();
  const p = Array.isArray(raw) ? raw[0] : raw;
  const r2 = await fetch(`${URL_}/functions/v1/valuation-fundamentals`, { method: 'POST', headers: H, body: JSON.stringify({ symbol: code, peers: false }) });
  const fund: any = await r2.json().catch(() => null);
  if (fund && fund.ok === false && /402|429|額度/.test(String(fund.reason || ''))) return { quota: true } as const;
  const view = p && !p.code ? buildValuationView({
    symbol: p.symbol || code, asOf: p.asOf ?? null, source: p.source ?? null, pe: p.pe ?? null, pb: p.pb ?? null,
    dividendYield: p.dividendYield ?? null, industry: p.industry ?? null,
    history: { pe: p?.history?.pe || [], pb: p?.history?.pb || [], dividendYield: p?.history?.dividendYield || [] },
    peerScope: p.peerScope ?? null, peerIndustry: p.peerIndustry ?? null, peers: p.peers || [], trend: Array.isArray(p?.trend) ? p.trend : [],
  } as any) : null;
  const band = scenarioFromFundamentals(fund, null);
  const price = Number(fund?.close) > 0 ? Number(fund.close) : null;
  const st: any = buildDrawerStations(view, band, code, price);
  const tabs: any = {};
  for (const k of ['pe', 'pb', 'ps']) {
    const t: any = selectedRulerBand(band, k, view);
    tabs[k] = t?.low > 0 ? [Math.round(t.low * 100) / 100, Math.round(t.high * 100) / 100] : (t?.reason ?? null);
    if (k === st.main.key && st.stations.status === 'ready' && t?.low > 0) {
      const a = st.stations.stations[0].price; const b = st.stations.stations[2].price;
      if (Math.abs(a - t.low) > 1e-6 || Math.abs(b - t.high) > 1e-6) tabs.mismatch = true;
    }
  }
  return {
    code, name, industry, snapIndustry: p?.industry ?? null, price, fundOk: fund?.ok ?? null, fundReason: fund?.reason ?? null,
    main: st.main.key, mainReason: st.main.reason, estimated: st.estimated,
    stations: st.stations.status === 'ready' ? st.stations.stations.map((s: any) => Math.round(s.price * 100) / 100) : null,
    stationsReason: st.stations.status === 'ready' ? null : st.stations.reason,
    level: st.pricedIn.level, ratio: st.pricedIn.ratioToBelt ?? null, pricedReason: st.pricedIn.reason ?? null, tabs,
  };
}

let n = 0;
for (const [code, name, industry] of list.slice(0, limit)) {
  let rec: any;
  try { rec = await one(code, name, industry); } catch (e) { rec = { code, name, industry, error: String(e).slice(0, 300) }; }
  if (rec.quota) { console.log(`QUOTA_STOP at ${code} after ${n}`); process.exit(2); }
  fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
  n++; if (n % 25 === 0) console.log(`${n} done (last ${code})`);
}
console.log(`finished ${n}`);
