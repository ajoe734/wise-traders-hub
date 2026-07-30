#!/usr/bin/env node
/**
 * 由 Deno 唯一資料源 supabase/functions/_shared/journalExportCore.ts
 * 產生前台鏡像 src/lib/journalExportCore.ts。
 *
 * 差異只允許出現在「import 區塊」與「Taipei 時間格式化來源」兩處，
 * 其餘邏輯必須逐字相同。src/test/unit/journal-export-core-parity.test.ts
 * 會重跑本轉換並比對檔案內容，任何手改鏡像都會紅燈。
 *
 * 用法：node scripts/gen-journal-export-core-mirror.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DENO_PATH = 'supabase/functions/_shared/journalExportCore.ts';
export const MIRROR_PATH = 'src/lib/journalExportCore.ts';

export function toMirror(source) {
  let out = source;

  out = out.replace(
    ' * 週記匯出核心（Deno 側唯一資料源）。',
    ' * 週記匯出核心（前台鏡像 — 由 scripts/gen-journal-export-core-mirror.mjs 產生，請勿手改）。',
  );
  out = out.replace(
    ' * 兩份由 src/test/unit/journal-export-core-parity.test.ts 做輸出 parity 守衛。',
    ' * 唯一資料源：supabase/functions/_shared/journalExportCore.ts；\n * parity 由 src/test/unit/journal-export-core-parity.test.ts 守衛。',
  );
  out = out.replace(
    " * Markdown 生成、單位解析、風險偵測（UNIT_MIX / DIRECTION_OVERSELL …）\n * 三件事只准住在這裡。前台鏡像：src/lib/journalExportCore.ts。",
    " * Markdown 生成、單位解析、風險偵測（UNIT_MIX / DIRECTION_OVERSELL …）\n * 三件事只准住在這裡。",
  );

  // import 區塊
  out = out.replace(
    "import { lotsToShares } from './lotSize.ts';\nimport { getActionLabel } from './signalActionLabels.ts';",
    "import { lotsToShares } from '@/lib/lotSize';\nimport { getActionMeta } from '@/lib/signalAction';\nimport { formatTaipeiYMDHM } from '@/checkup/utils/formatTaipeiDate';\n\nconst getActionLabel = (action: string): string => getActionMeta(action).label;",
  );

  // Taipei 時間格式化：前台一律走 formatTaipeiDate（全站唯一來源）
  const denoFmt = `// Taipei 日期時間（YYYY/MM/DD HH:mm）。Intl 保證與前台 formatTaipeiYMDHM 一致。
const TAIPEI_YMDHM = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function fmtTaipei(iso?: string | null): string {
  if (iso == null || iso === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return TAIPEI_YMDHM.format(d).replace(/-/g, '/').replace(', ', ' ');
}`;
  const webFmt = `// Taipei 日期時間格式化唯一來源：@/checkup/utils/formatTaipeiDate
export function fmtTaipei(iso?: string | null): string {
  return formatTaipeiYMDHM(iso);
}`;
  if (!out.includes(denoFmt)) {
    throw new Error('gen-journal-export-core-mirror: fmtTaipei block not found — 轉換規則需同步更新');
  }
  out = out.replace(denoFmt, webFmt);

  return out;
}

export function readDeno() {
  return readFileSync(resolve(root, DENO_PATH), 'utf-8');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const expected = toMirror(readDeno());
  const target = resolve(root, MIRROR_PATH);
  if (process.argv.includes('--check')) {
    const actual = readFileSync(target, 'utf-8');
    if (actual !== expected) {
      console.error(`[mirror] ${MIRROR_PATH} 與 ${DENO_PATH} 不同步，請執行 node scripts/gen-journal-export-core-mirror.mjs`);
      process.exit(1);
    }
    console.log('[mirror] in sync');
  } else {
    writeFileSync(target, expected, 'utf-8');
    console.log(`[mirror] wrote ${MIRROR_PATH}`);
  }
}
