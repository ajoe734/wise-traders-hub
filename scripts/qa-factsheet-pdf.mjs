/**
 * QA 腳本：用資料庫真實資料在 Node 端產生 factsheet PDF，供視覺檢查。
 *   node scripts/qa-factsheet-pdf.mjs <slug> <out.pdf>
 * 只讀資料庫，不寫入；字型直接讀 public/fonts。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.fetch = async (url) => {
  const p = `public${String(url)}`;
  const buf = readFileSync(p);
  return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

const slug = process.argv[2] ?? 'sharkgu';
const out = process.argv[3] ?? '/tmp/factsheet.pdf';

const q = (sql) => JSON.parse(execFileSync('psql', ['-At', '-c', `select coalesce(json_agg(t),'[]') from (${sql}) t`], { encoding: 'utf8' }));

const [expert] = q(`select id, slug, name, role::text, starting_capital, currency, asset_class, strategy_summary, description, style_tags, markets from experts where slug='${slug}'`);
if (!expert) throw new Error('no expert');
const trades = q(`select id, instrument, entry_price::float, exit_price::float, current_price::float, quantity::float, entry_date, exit_date, pnl_percent::float, status from trade_records where expert_id='${expert.id}' order by exit_date`);

const { buildFactsheet } = await import('../src/lib/performance/factsheet.ts');
const { exportFactsheetPdf } = await import('../src/lib/performance/factsheetPdf.ts');

const fs = buildFactsheet({ expert, trades, range: process.argv[4] ?? 'inception', asOf: new Date() });
console.log('metrics', JSON.stringify(fs.metrics, null, 1));
const blob = await exportFactsheetPdf({ fs, returnBlob: true });
writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
console.log('wrote', out, (await blob.arrayBuffer()).byteLength, 'bytes');
