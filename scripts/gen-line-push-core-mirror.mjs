#!/usr/bin/env node
/**
 * 由 Deno 唯一資料源 supabase/functions/_shared/linePushCore.ts
 * 產生前台鏡像 src/lib/linePushCore.ts。
 *
 * 差異只允許出現在檔頭註解。
 * src/test/unit/line-push-core-parity.test.ts 會重跑本轉換比對內容。
 *
 * 用法：node scripts/gen-line-push-core-mirror.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DENO_PATH = 'supabase/functions/_shared/linePushCore.ts';
export const MIRROR_PATH = 'src/lib/linePushCore.ts';

export function toMirror(source) {
  let out = source;

  const header = ' * LINE 推播文案核心（Deno 側唯一資料源）。';
  if (!out.includes(header)) {
    throw new Error('gen-line-push-core-mirror: header not found — 轉換規則需同步更新');
  }
  out = out.replace(
    header,
    ' * LINE 推播文案核心（前台鏡像 — 由 scripts/gen-line-push-core-mirror.mjs 產生，請勿手改）。',
  );

  const footer = ` * 前台鏡像：src/lib/linePushCore.ts
 * （由 scripts/gen-line-push-core-mirror.mjs 產生，禁止手改）`;
  if (!out.includes(footer)) {
    throw new Error('gen-line-push-core-mirror: footer block not found');
  }
  out = out.replace(
    footer,
    ` * 唯一資料源：supabase/functions/_shared/linePushCore.ts
 * （修改請改那一份，再重跑 scripts/gen-line-push-core-mirror.mjs）`,
  );

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
      console.error(`[mirror] ${MIRROR_PATH} 與 ${DENO_PATH} 不同步，請執行 node scripts/gen-line-push-core-mirror.mjs`);
      process.exit(1);
    }
    console.log('[mirror] in sync');
  } else {
    writeFileSync(target, expected, 'utf-8');
    console.log(`[mirror] wrote ${MIRROR_PATH}`);
  }
}
