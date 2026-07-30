/**
 * 週記匯出核心「單一資料源」守衛（A3）。
 *
 * 唯一資料源：supabase/functions/_shared/journalExportCore.ts
 * 前台鏡像：src/lib/journalExportCore.ts（由 scripts/gen-journal-export-core-mirror.mjs 產生）
 *
 * 1. 鏡像同步：重跑產生器，內容必須逐字相同。
 * 2. 行為 parity：同一批 fixture 丟進兩份實作，Markdown 與風險報告必須完全相同。
 * 3. 靜態掃描：Markdown / 單位 / 風險規則不得在其他檔案再寫一次。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

import * as web from '@/lib/journalExportCore';
import * as deno from '../../../supabase/functions/_shared/journalExportCore';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8');

type Row = web.JournalRowExport;

const range = { startLabel: '2026-06-08', endLabel: '2026-06-14' };

const row = (over: Partial<Row>): Row => ({
  id: 'r1',
  status: 'published',
  instrument: '2330 台積電',
  action: 'buy',
  price_hint: 1000,
  quantity: 2,
  quantity_unit: '張',
  reason_summary: '<p>突破頸線</p>',
  reason_detail: '量能放大&amp;法人回補',
  risk_notes: '跌破 980 停損',
  learning_points: '紀律',
  published_at: '2026-06-09T01:30:00Z',
  created_at: '2026-06-09T01:00:00Z',
  expert_id: 'e1',
  experts: { name: '老周', slug: 'laozhou', role: 'mentor', asset_class: 'tw_stock', currency: 'TWD' },
  ...over,
});

const FIXTURES: Record<string, Row[]> = {
  '台股張／教學筆記混合': [
    row({}),
    row({ id: 'r2', action: 'trim', quantity: 1, published_at: '2026-06-10T05:00:00Z' }),
    row({ id: 'r3', action: 'teaching', quantity: null, quantity_unit: null, instrument: null, reason_summary: null }),
    row({ id: 'r4', action: 'hold', quantity: null }),
  ],
  '單位混用（張＋股）': [
    row({ id: 'm1', action: 'buy', quantity: 1, quantity_unit: '張' }),
    row({ id: 'm2', action: 'sell', quantity: 500, quantity_unit: '股' }),
  ],
  '美股／未知動作／缺單位': [
    row({
      id: 'u1', action: 'weird_action', quantity: 30, quantity_unit: null, instrument: 'RKLB',
      experts: { name: 'Ray', slug: 'ray', role: 'mentor', asset_class: 'us_stock', currency: 'USD' },
    }),
    row({
      id: 'u2', action: 'exit', quantity: 10, quantity_unit: '股', instrument: 'RKLB',
      experts: { name: 'Ray', slug: 'ray', role: 'mentor', asset_class: 'us_stock', currency: 'USD' },
    }),
  ],
  '數量無效／未發布': [
    row({ id: 'q1', action: 'buy', quantity: 0, status: 'pending' }),
    row({ id: 'q2', action: 'sell', quantity: -3, status: 'pending' }),
  ],
  '選擇權口數': [
    row({
      id: 'o1', action: 'add', quantity: 4, quantity_unit: '口', instrument: 'RKLB 12/19 40C',
      experts: { name: 'Ray', slug: 'ray', role: 'mentor', asset_class: 'us_option', currency: 'USD' },
    }),
  ],
};

describe('journalExportCore — 鏡像同步', () => {
  it('前台鏡像與 Deno 唯一資料源逐字同步（重跑產生器比對）', () => {
    execFileSync('node', [resolve(root, 'scripts/gen-journal-export-core-mirror.mjs'), '--check'], {
      cwd: root,
      stdio: 'pipe',
    });
  });
});

describe('journalExportCore — 行為 parity（前台 vs Deno）', () => {
  for (const [name, rows] of Object.entries(FIXTURES)) {
    it(`${name}：buildMentorMarkdown 逐字相同`, () => {
      expect(web.buildMentorMarkdown(rows, range)).toBe(deno.buildMentorMarkdown(rows, range));
    });

    it(`${name}：detectExportRisks 報告相同（含期初庫存情境）`, () => {
      const opening = new Map<string, number>([['e1::2330 台積電', 3000]]);
      for (const ctx of [{}, { publishedOnly: true }, { openingBalances: opening, publishedOnly: true }]) {
        expect(JSON.stringify(web.detectExportRisks(rows, ctx)))
          .toBe(JSON.stringify(deno.detectExportRisks(rows, ctx)));
      }
    });

    it(`${name}：resolveExportUnit 相同`, () => {
      for (const r of rows) expect(web.resolveExportUnit(r)).toBe(deno.resolveExportUnit(r));
    });
  }

  it('fmtTaipei 對同一 ISO 產出相同台北時間字串（含跨日邊界）', () => {
    const samples = [
      '2026-06-08T15:59:59Z', '2026-06-08T16:00:00Z', '2025-12-31T16:30:00Z',
      '2026-01-01T00:00:00Z', null, '', 'not-a-date',
    ];
    for (const s of samples) expect(web.fmtTaipei(s)).toBe(deno.fmtTaipei(s));
    expect(web.fmtTaipei('2026-06-08T16:00:00Z')).toBe('2026/06/09 00:00');
  });

  it('safeSlug / uniqueMentorFilename 相同（含撞名去重）', () => {
    expect(web.safeSlug('a/b c', 'x')).toBe(deno.safeSlug('a/b c', 'x'));
    const a = new Set<string>();
    const b = new Set<string>();
    for (const id of ['e1', 'e2', 'e3']) {
      expect(web.uniqueMentorFilename(a, 'dup', id)).toBe(deno.uniqueMentorFilename(b, 'dup', id));
    }
  });
});

describe('journalExportCore — 靜態守衛（規則不得再寫第二次）', () => {
  const CORE_FILES = [
    'supabase/functions/_shared/journalExportCore.ts',
    'src/lib/journalExportCore.ts',
  ];

  const rgFiles = (pattern: string, paths: string[]): string[] => {
    try {
      const out = execFileSync('rg', ['-l', pattern, ...paths], { cwd: root, encoding: 'utf-8' });
      return out.split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  };

  it('stripHtml 的實作只存在於 core（其餘檔案只能 import）', () => {
    const hits = rgFiles('function stripHtml', ['src', 'supabase/functions'])
      .filter((f) => !CORE_FILES.includes(f) && !f.startsWith('src/test/'));
    expect(hits, `stripHtml 重複實作：${hits.join(', ')}`).toEqual([]);
  });

  it('單位預設表 UNIT_DEFAULT / UNIT_ALLOWED 只存在於 core', () => {
    for (const sym of ['UNIT_DEFAULT', 'UNIT_ALLOWED']) {
      const hits = rgFiles(`const ${sym}`, ['src', 'supabase/functions'])
        .filter((f) => !CORE_FILES.includes(f) && !f.startsWith('src/test/'));
      expect(hits, `${sym} 重複宣告：${hits.join(', ')}`).toEqual([]);
    }
  });

  it('風險規則常數（BUY_ACTIONS / SELL_ACTIONS）只存在於 core', () => {
    const hits = rgFiles('const (BUY|SELL)_ACTIONS', ['src', 'supabase/functions'])
      .filter((f) => !CORE_FILES.includes(f) && !f.startsWith('src/test/'));
    expect(hits, `交易動作集合重複宣告：${hits.join(', ')}`).toEqual([]);
  });

  it('weekly-journal-export 不得自刻週界 / 單位 / Markdown', () => {
    const src = read('supabase/functions/weekly-journal-export/index.ts');
    expect(src).not.toMatch(/TZ_OFFSET_MS/);
    expect(src).not.toMatch(/function taipeiMondayOf/);
    expect(src).not.toMatch(/function buildMentorMarkdown/);
    expect(src).not.toMatch(/function resolveDisplayUnit/);
    expect(src).toMatch(/_shared\/journalExportCore\.ts/);
    expect(src).toMatch(/_shared\/weekBoundary\.ts/);
  });

  it('前台 journalsExport 只剩瀏覽器層（JSZip / Blob），規則全部轉出', () => {
    const src = read('src/lib/journalsExport.ts');
    expect(src).not.toMatch(/function stripHtml/);
    expect(src).not.toMatch(/function detectExportRisks/);
    expect(src).toMatch(/@\/lib\/journalExportCore/);
    expect(src.split('\n').length).toBeLessThan(140);
  });
});
