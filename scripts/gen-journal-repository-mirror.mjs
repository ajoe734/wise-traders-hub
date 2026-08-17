#!/usr/bin/env node
/**
 * 由 Deno 唯一資料源 supabase/functions/_shared/journalRepository.ts
 * 產生前台鏡像 src/lib/journalRepository.ts。
 *
 * 差異只允許出現在「檔頭註解」與「週界 import 來源」兩處。
 * src/test/unit/journal-repository-parity.test.ts 會重跑本轉換比對內容。
 *
 * 用法：node scripts/gen-journal-repository-mirror.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DENO_PATH = 'supabase/functions/_shared/journalRepository.ts';
export const MIRROR_PATH = 'src/lib/journalRepository.ts';

export function toMirror(source) {
  let out = source;

  const header = ' * 週記讀取倉庫（Deno 側唯一資料源）。';
  if (!out.includes(header)) {
    throw new Error('gen-journal-repository-mirror: header not found — 轉換規則需同步更新');
  }
  out = out.replace(
    header,
    ' * 週記讀取倉庫（前台鏡像 — 由 scripts/gen-journal-repository-mirror.mjs 產生，請勿手改）。',
  );
  out = out.replace(
    ' * 只准住在這裡。前台鏡像：src/lib/journalRepository.ts。',
    ' * 只准住在這裡。唯一資料源：supabase/functions/_shared/journalRepository.ts。',
  );

  const denoImport = "import { taipeiMondayOf, taipeiWeekRangeUtc } from './weekBoundary.ts';";
  if (!out.includes(denoImport)) {
    throw new Error('gen-journal-repository-mirror: import block not found');
  }
  out = out.replace(
    denoImport,
    "import { taipeiMondayOf, taipeiWeekRangeUtc } from '@/lib/taipeiWeek';",
  );

  const denoContractImport = "from './publicEconomicContract.ts';";
  if (!out.includes(denoContractImport)) {
    throw new Error('gen-journal-repository-mirror: public contract import not found');
  }
  out = out.replace(denoContractImport, "from '@/contracts/publicEconomicContract';");

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
      console.error(`[mirror] ${MIRROR_PATH} 與 ${DENO_PATH} 不同步，請執行 node scripts/gen-journal-repository-mirror.mjs`);
      process.exit(1);
    }
    console.log('[mirror] in sync');
  } else {
    writeFileSync(target, expected, 'utf-8');
    console.log(`[mirror] wrote ${MIRROR_PATH}`);
  }
}
