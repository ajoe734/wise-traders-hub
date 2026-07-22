/**
 * 週記端到端效能回歸測試
 *
 * 量測三段核心程式碼路徑的執行時間，計算 avg / p50 / p95 / p99 / max，
 * 任一段的 avg 或 p95 超過預算就失敗。目的：**在 PR 引入 N² 迴圈、深拷貝、
 * 無 memo 的巨型 markdown 拼接時直接擋下，而非等使用者按了才發現卡頓。**
 *
 * 為什麼不用 Playwright：真實 E2E 受網路 / vite-dev-server / renderer 抖動影響大，
 * 抓不到 pure JS 邏輯的退化；本檔專注在「純函式輸入輸出時間」，環境敏感度最低。
 *
 * 量測範圍（一份輸入代表一位分析師的一週撰寫）：
 *   Stage A 撰寫驗證：10 檔混合動作 → buildStepStates + computeCashSim + validateSignalBatch
 *                     + buildPublishRows（＝送出前所有前端必經計算）
 *   Stage B 發布錯誤分類：五類 error 各跑一次 classifyPublishError（server 端 per-signal 隔離用）
 *   Stage C 匯出：3 位分析師 × 10 筆 → buildJournalExport（ZIP，含 markdown 生成）
 *                 + detectExportRisks（風險偵測）
 *
 * 迭代次數：50 次（前 5 次 warm-up 不計入），單檔跑約 3–8s。
 */
import { describe, it, expect } from 'vitest';
import {
  computeCashSim,
  validateSignalBatch,
  buildPublishRows,
} from '@/pages/_signalEditor/derive';
import type { TradeDraft, CapitalStatus } from '@/pages/_signalEditor/types';
import {
  buildJournalExport,
  detectExportRisks,
  type JournalRowExport,
  type WeekRangeLabels,
} from '@/lib/journalsExport';
import { classifyPublishError } from '../../../supabase/functions/publish-weekly-journals/classifyPublishError';

// ─────────────────────────────────────────────
// 效能預算（jsdom, 8-core sandbox 基準）
// 註：CI 慢速機請以 baseline 相對值升級此檔（見尾端 TODO）；目前值來自本地量測 × 3
// ─────────────────────────────────────────────
const BUDGET = {
  authoring: { avgMs: 15, p95Ms: 40 },
  publish:   { avgMs: 2,  p95Ms: 5  },
  export:    { avgMs: 250, p95Ms: 600 },
} as const;

const ITERATIONS = 50;
const WARMUP = 5;

// ─────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────
const expert = {
  id: 'e1',
  name: 'Perf 老師',
  slug: 'perf',
  role: 'mentor',
  asset_class: 'tw_stock',
  currency: 'TWD',
  starting_capital: 5_000_000,
};

const capital: CapitalStatus = {
  starting_capital: 5_000_000,
  realized_pnl_amount: 0,
  open_cost_value: 0,
  open_market_value: 0,
  unrealized_pnl_amount: 0,
  available_cash: 5_000_000,
  open_positions: [
    {
      symbol: '2330', instrument: '2330 台積電',
      quantity_shares: 3_000, entry_price: 900,
      current_price: 950, market_value: 2_850_000,
      unrealized_pnl: 150_000, unrealized_pct: 0.055,
      asset_class: 'tw_stock', currency: 'TWD',
    },
    {
      symbol: '2317', instrument: '2317 鴻海',
      quantity_shares: 5_000, entry_price: 180,
      current_price: 195, market_value: 975_000,
      unrealized_pnl: 75_000, unrealized_pct: 0.083,
      asset_class: 'tw_stock', currency: 'TWD',
    },
  ],
  recent_trades: [],
  currency: 'TWD',
  asset_class: 'tw_stock',
};

const openPositions = capital.open_positions.map(p => ({
  symbol: p.symbol, quantity: p.quantity_shares,
}));

function makeTrades(): TradeDraft[] {
  // 10 筆混合動作，模擬一週實際撰寫負載
  const mk = (o: Partial<TradeDraft>): TradeDraft => ({
    uid: Math.random().toString(36).slice(2, 10),
    executedAt: '2026-07-15T10:00',
    stockCode: '2330', stockName: '台積電',
    action: 'buy', priceHint: '950', quantity: '1',
    quantityUnit: '張',
    reasonSummary: '<p>買進理由</p>',
    reasonDetail: '<p>技術面站上季線，量能配合。</p>',
    riskNotes: '<p>跌破 900 出場。</p>',
    ...o,
  });
  return [
    mk({ stockCode: '2330', action: 'trim', quantity: '1', priceHint: '960' }),
    mk({ stockCode: '2317', action: 'sell', quantity: '2', priceHint: '200' }),
    mk({ stockCode: '2454', stockName: '聯發科', action: 'buy', quantity: '1', priceHint: '1200' }),
    mk({ stockCode: '2603', stockName: '長榮', action: 'buy', quantity: '5', priceHint: '180' }),
    mk({ stockCode: '2412', stockName: '中華電', action: 'buy', quantity: '3', priceHint: '125' }),
    mk({ stockCode: '2330', action: 'add', quantity: '1', priceHint: '955' }),
    mk({ stockCode: '2317', action: 'hold', quantity: '', priceHint: '' }),
    mk({ stockCode: '3008', stockName: '大立光', action: 'buy', quantity: '1', priceHint: '2400' }),
    mk({ stockCode: '2308', stockName: '台達電', action: 'buy', quantity: '2', priceHint: '380' }),
    mk({ stockCode: '', action: 'teaching', priceHint: '', quantity: '',
        reasonSummary: '<p>本週市場結構</p>' }),
  ];
}

function makeExportRows(): JournalRowExport[] {
  const rows: JournalRowExport[] = [];
  const mentors = [
    { id: 'm1', slug: 'mentor-a', asset_class: 'tw_stock', currency: 'TWD' },
    { id: 'm2', slug: 'mentor-b', asset_class: 'us_stock', currency: 'USD' },
    { id: 'm3', slug: 'mentor-c', asset_class: 'crypto',   currency: 'USD' },
  ];
  for (const m of mentors) {
    for (let i = 0; i < 10; i++) {
      rows.push({
        id: `${m.id}-s${i}`,
        status: 'published',
        instrument: m.asset_class === 'tw_stock' ? '2330 台積電'
                  : m.asset_class === 'us_stock' ? 'AAPL' : 'BTC',
        action: i % 4 === 0 ? 'sell' : i % 3 === 0 ? 'add' : 'buy',
        price_hint: 100 + i * 5,
        quantity: 10 + i,
        quantity_unit: null,
        reason_summary: `<p>第 ${i + 1} 筆理由，含<strong>粗體</strong>與 <em>斜體</em>。</p>`,
        reason_detail: `<p>詳述段落。段落 A 談趨勢，段落 B 談技術，段落 C 談風險。</p>`.repeat(3),
        risk_notes: `<p>風險：跌破 X 停損。</p>`,
        learning_points: i === 0 ? `<p>週度教學重點。</p>` : null,
        published_at: `2026-07-1${(i % 5) + 1}T02:00:00Z`,
        created_at: `2026-07-1${(i % 5) + 1}T01:00:00Z`,
        expert_id: m.id,
        experts: {
          name: `Mentor ${m.slug}`, slug: m.slug, role: 'mentor',
          asset_class: m.asset_class, currency: m.currency,
        },
      });
    }
  }
  return rows;
}

const range: WeekRangeLabels = { startLabel: '2026-07-13', endLabel: '2026-07-19' };

// ─────────────────────────────────────────────
// 量測工具
// ─────────────────────────────────────────────
interface Stats {
  n: number; avg: number; p50: number; p95: number; p99: number; max: number; min: number;
}
function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    avg: sum / sorted.length,
    p50: pick(0.5), p95: pick(0.95), p99: pick(0.99),
    max: sorted[sorted.length - 1], min: sorted[0],
  };
}
function fmt(s: Stats): string {
  return `n=${s.n} avg=${s.avg.toFixed(2)}ms p50=${s.p50.toFixed(2)} p95=${s.p95.toFixed(2)} p99=${s.p99.toFixed(2)} max=${s.max.toFixed(2)}`;
}

async function measure(name: string, fn: () => void | Promise<void>): Promise<Stats> {
  // Warm-up：flush esbuild transform / V8 optimization
  for (let i = 0; i < WARMUP; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  const s = stats(samples);
   
  console.log(`[perf] ${name.padEnd(20)} ${fmt(s)}`);
  return s;
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────
describe('週記端到端效能回歸', () => {
  it(`Stage A 撰寫驗證：avg < ${BUDGET.authoring.avgMs}ms / p95 < ${BUDGET.authoring.p95Ms}ms`, async () => {
    const trades = makeTrades();
    const s = await measure('authoring', () => {
      // computeCashSim 內部會呼叫 buildStepStates，等於同時 exercise 兩者
      computeCashSim(trades, capital);
      validateSignalBatch({ expert, trades, openPositions, capital });
      buildPublishRows({
        expertId: 'e1', batchId: 'batch-perf', status: 'published',
        assetClass: 'tw_stock', trades,
        isMentor: true,
        teachingTopic: '本週市場結構',
        overallSummary: '<p>整體維持偏多。</p>',
        learningPoints: '<p>操作紀律優先於預測。</p>',
      });
    });
    expect(s.avg, `authoring avg 超標 ${fmt(s)}`).toBeLessThan(BUDGET.authoring.avgMs);
    expect(s.p95, `authoring p95 超標 ${fmt(s)}`).toBeLessThan(BUDGET.authoring.p95Ms);
  }, 30_000);

  it(`Stage B 發布錯誤分類：avg < ${BUDGET.publish.avgMs}ms / p95 < ${BUDGET.publish.p95Ms}ms`, async () => {
    const errors = [
      { message: 'UNIT_MIX detected', code: 'P0001' },
      { message: 'oversell exceeds_open_quantity', code: 'P0001' },
      { message: 'CAPITAL_EXCEEDED', code: 'P0001' },
      { message: 'missing price_hint', code: '23502' },
      { message: 'duplicate key value violates', code: '23505' },
    ];
    const s = await measure('publish-classify', () => {
      for (const e of errors) classifyPublishError(e, '2330 台積電');
    });
    expect(s.avg, `classify avg 超標 ${fmt(s)}`).toBeLessThan(BUDGET.publish.avgMs);
    expect(s.p95, `classify p95 超標 ${fmt(s)}`).toBeLessThan(BUDGET.publish.p95Ms);
  }, 30_000);

  it(`Stage C 匯出：avg < ${BUDGET.export.avgMs}ms / p95 < ${BUDGET.export.p95Ms}ms`, async () => {
    const rows = makeExportRows();
    const s = await measure('export-zip', async () => {
      detectExportRisks(rows, { publishedOnly: true });
      const res = await buildJournalExport(rows, range, true);
      if (!res || res.kind !== 'zip') throw new Error('expected zip');
    });
    expect(s.avg, `export avg 超標 ${fmt(s)}`).toBeLessThan(BUDGET.export.avgMs);
    expect(s.p95, `export p95 超標 ${fmt(s)}`).toBeLessThan(BUDGET.export.p95Ms);
  }, 60_000);

  it('端到端總合：avg < 300ms / p95 < 700ms（Stage A + B + C 串跑）', async () => {
    const trades = makeTrades();
    const rows = makeExportRows();
    const err = { message: 'UNIT_MIX detected', code: 'P0001' };
    const s = await measure('e2e-sum', async () => {
      computeCashSim(trades, capital);
      validateSignalBatch({ expert, trades, openPositions, capital });
      buildPublishRows({
        expertId: 'e1', batchId: 'batch-perf', status: 'published',
        assetClass: 'tw_stock', trades,
        isMentor: true, teachingTopic: 'x', overallSummary: '<p>x</p>', learningPoints: '<p>x</p>',
      });
      classifyPublishError(err, '2330 台積電');
      detectExportRisks(rows, { publishedOnly: true });
      await buildJournalExport(rows, range, true);
    });
    expect(s.avg, `e2e avg 超標 ${fmt(s)}`).toBeLessThan(300);
    expect(s.p95, `e2e p95 超標 ${fmt(s)}`).toBeLessThan(700);
  }, 60_000);
});
