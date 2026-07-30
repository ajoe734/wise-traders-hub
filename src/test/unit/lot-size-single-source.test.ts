/**
 * 「1 張 = 1000 股」單一資料源守衛。
 *
 * 1. lotSize 契約行為。
 * 2. 前台 / Deno 兩份鏡像的常數 parity。
 * 3. 靜態掃描：業務程式碼不得再出現裸的張股 ×1000 / ÷1000。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  SHARES_PER_LOT,
  lotsToShares,
  sharesToLots,
  isWholeLot,
  formatSharesAsLots,
} from '@/lib/lotSize';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8');

describe('lotSize 契約', () => {
  it('1 張 = 1000 股', () => {
    expect(SHARES_PER_LOT).toBe(1000);
    expect(lotsToShares(2)).toBe(2000);
    expect(lotsToShares(null)).toBe(0);
    expect(lotsToShares('3')).toBe(3000);
  });

  it('sharesToLots 支援 exact / nearest / floor', () => {
    expect(sharesToLots(2500)).toBe(2.5);
    expect(sharesToLots(2500, 'nearest')).toBe(3);
    expect(sharesToLots(2500, 'floor')).toBe(2);
    expect(sharesToLots(-1400, 'nearest')).toBe(-1);
  });

  it('isWholeLot：零股 false、0 false、整張 true', () => {
    expect(isWholeLot(1000)).toBe(true);
    expect(isWholeLot(800)).toBe(false);
    expect(isWholeLot(0)).toBe(false);
  });

  it('formatSharesAsLots：null → —、不足一張 → <1 張、signed 補 +', () => {
    expect(formatSharesAsLots(null)).toBe('—');
    expect(formatSharesAsLots(0)).toBe('0');
    expect(formatSharesAsLots(400)).toBe('<1 張');
    expect(formatSharesAsLots(12000, { signed: true })).toBe('+12 張');
    expect(formatSharesAsLots(-12000, { signed: true })).toBe('-12 張');
  });
});

describe('前後端鏡像 parity', () => {
  it('Deno 側 _shared/lotSize.ts 的 SHARES_PER_LOT 與前台一致', () => {
    const src = read('supabase/functions/_shared/lotSize.ts');
    const m = src.match(/SHARES_PER_LOT\s*=\s*(\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBe(SHARES_PER_LOT);
  });
});

const GUARDED_FILES = [
  'src/lib/positionQuantity.ts',
  'src/pages/_adminSignals/derive.ts',
  'src/pages/JournalAuthoringHarnessEntry.tsx',
  'src/checkup/components/freecheckup/ChipsTrendChart.tsx',
  'src/checkup/components/freecheckup/ChipsSection.tsx',
  'supabase/functions/weekly-journal-export/index.ts',
  'supabase/functions/daily-snapshot/index.ts',
  'supabase/functions/_shared/bsrSealingParity.ts',
  'supabase/functions/reconcile-warrant-quantities/index.ts',
];

// A3 後：週記匯出的張股換算集中在匯出核心，改用 import 守衛
describe('靜態守衛：週記匯出核心只能透過 lotSize 換算', () => {
  it.each([
    'supabase/functions/_shared/journalExportCore.ts',
    'src/lib/journalExportCore.ts',
  ])('%s import lotSize 且無裸的 1000 換算', (file) => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf-8');
    expect(src).toMatch(/lotsToShares/);
    expect(src).toMatch(/lotSize/);
    const bare = src
      .split('\n')
      .filter((l) => /(\*|\/)\s*1000\b/.test(l) && !l.trim().startsWith('*'));
    expect(bare, `裸換算：${bare.join(' | ')}`).toEqual([]);
  });
});

describe('靜態守衛：不得再有裸的張股換算', () => {
  it.each(GUARDED_FILES)('%s 使用 lotSize 單一資料源', (file) => {
    const src = read(file);
    expect(src).toMatch(/SHARES_PER_LOT/);
    const bare = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .filter((line) => /[*/]\s*1000\b/.test(line))
      // 時間常數（60 * 1000 等）不是張股換算
      .filter((line) => !/(60|24|3600|3_600|1_000)\s*\*\s*1000|diff|Date|MS\b|ms\b/.test(line));
    expect(bare).toEqual([]);
  });
});
