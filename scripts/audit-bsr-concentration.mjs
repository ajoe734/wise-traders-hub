#!/usr/bin/env node
/**
 * BSR 集中度全域覆蓋審計
 *
 * 掃出「活躍 TW 4 碼持倉」，對每檔驗證：
 *   - 有 rollup？bsr_available？concentration_ratio？
 *   - raw 有幾日 complete（≥5 broker rows）？
 *   - queue 狀態？
 *
 * 落 CSV 到 /tmp/bsr-audit-<ts>.csv。回傳 exit=1 若覆蓋率 < 95%。
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error('need SUPABASE_URL and a key env');
  process.exit(2);
}
const supa = createClient(url, key, { auth: { persistSession: false } });

const { data: trs } = await supa
  .from('trade_records')
  .select('instrument, market, status')
  .ilike('market', 'TW');
const stockSet = new Set();
for (const r of trs || []) {
  const m = String(r.instrument || '').match(/^([1-9][0-9]{3})(?:\s|$)/);
  if (m) stockSet.add(m[1]);
}
const stocks = Array.from(stockSet).sort();

const rows = [];
let covered = 0;
for (const sid of stocks) {
  const { data: r } = await supa
    .from('tw_chips_rollup')
    .select('as_of_date, concentration_ratio, bsr_available')
    .eq('stock_id', sid)
    .order('as_of_date', { ascending: false })
    .limit(1);
  const { count: rawDays } = await supa
    .from('tw_bsr_daily')
    .select('trade_date', { count: 'exact', head: true })
    .eq('stock_id', sid);
  const { data: q } = await supa
    .from('tw_bsr_sync_queue')
    .select('status')
    .eq('stock_id', sid)
    .order('updated_at', { ascending: false })
    .limit(1);
  const row = r?.[0];
  const ok = row && row.bsr_available && row.concentration_ratio != null;
  if (ok) covered++;
  rows.push({
    stock_id: sid,
    has_rollup: !!row,
    rollup_as_of: row?.as_of_date || '',
    concentration_ratio: row?.concentration_ratio ?? '',
    bsr_available: row?.bsr_available ?? '',
    raw_rows: rawDays ?? 0,
    queue_status: q?.[0]?.status || '',
    ok,
  });
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const out = `/tmp/bsr-audit-${ts}.csv`;
const header = Object.keys(rows[0] || { stock_id: 1 }).join(',');
fs.writeFileSync(out, [header, ...rows.map(r => Object.values(r).join(','))].join('\n'));

const total = stocks.length;
const coverage = total ? (covered / total) : 1;
console.log(`stocks=${total} covered=${covered} coverage=${(coverage * 100).toFixed(1)}% csv=${out}`);
if (coverage < 0.95 && total > 0) {
  console.error('FAIL: coverage < 95%');
  process.exit(1);
}
