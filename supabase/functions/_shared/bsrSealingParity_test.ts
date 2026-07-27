// Phase K — BSR sealing 反向驗證 TDD 測試。
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  auditStockDay,
  auditParityBatch,
  decideParityAlert,
  toleranceFor,
  type BrokerRow,
  type VolumeRow,
} from './bsrSealingParity.ts';

const b = (
  stock_id: string,
  trade_date: string,
  buy: number,
  sell: number,
): BrokerRow => ({ stock_id, trade_date, buy_shares: buy, sell_shares: sell, net_shares: buy - sell });

Deno.test('toleranceFor: 1% or 1000 whichever larger', () => {
  assertEquals(toleranceFor(50_000), 1000);        // 1% = 500 → floor to 1000
  assertEquals(toleranceFor(500_000), 5000);       // 1% = 5000
  assertEquals(toleranceFor(0), 1000);
});

Deno.test('auditStockDay: buy/sell match volume → ok', () => {
  const rows = [b('2330', '2026-07-22', 60_000, 40_000), b('2330', '2026-07-22', 40_000, 60_000)];
  const a = auditStockDay(rows, 100_000);
  assertEquals(a.ok, true);
  assertEquals(a.issues, []);
  assertEquals(a.broker_sum_buy, 100_000);
  assertEquals(a.broker_sum_net, 0);
});

Deno.test('auditStockDay: buy short by 5000 → buy_mismatch', () => {
  const rows = [b('2330', '2026-07-22', 50_000, 40_000), b('2330', '2026-07-22', 45_000, 60_000)];
  const a = auditStockDay(rows, 100_000);
  assertEquals(a.ok, false);
  assertEquals(a.issues.includes('buy_mismatch'), true);
  assertEquals(a.buy_delta, -5_000);
});

Deno.test('auditStockDay: 1000 股容忍 — 剛好 1000 不觸發', () => {
  const rows = [b('2330', '2026-07-22', 99_000, 100_000)];
  const a = auditStockDay(rows, 100_000);
  assertEquals(a.issues.includes('buy_mismatch'), false);
});

Deno.test('auditStockDay: 大量交易 1% 容忍', () => {
  const rows = [b('2330', '2026-07-22', 994_000, 1_000_000)];
  const a = auditStockDay(rows, 1_000_000);
  // delta = -6000, tolerance = 10_000 → ok
  assertEquals(a.issues.includes('buy_mismatch'), false);
});

Deno.test('auditStockDay: net_nonzero — 分點總買 ≠ 總賣', () => {
  const rows = [b('2330', '2026-07-22', 10_000, 5_000)];
  const a = auditStockDay(rows, 10_000);
  assertEquals(a.issues.includes('net_nonzero'), true);
});

Deno.test('auditStockDay: volume=null → missing_volume', () => {
  const rows = [b('2330', '2026-07-22', 100_000, 100_000)];
  const a = auditStockDay(rows, null);
  assertEquals(a.issues, ['missing_volume']);
  assertEquals(a.ok, false);
});

Deno.test('auditParityBatch: 分組 + 摘要', () => {
  const brokers: BrokerRow[] = [
    b('2330', '2026-07-22', 60_000, 40_000),
    b('2330', '2026-07-22', 40_000, 60_000),
    b('2454', '2026-07-22', 10_000, 5_000),  // sell mismatch (missing 5k)
    b('2454', '2026-07-22', 5_000, 5_000),
  ];
  const volumes: VolumeRow[] = [
    { symbol: '2330', trade_date: '2026-07-22', volume: 100_000 },
    { symbol: '2454', trade_date: '2026-07-22', volume: 15_000 },
  ];
  const s = auditParityBatch(brokers, volumes);
  assertEquals(s.sampleSize, 2);
  assertEquals(s.mismatched, 1);
  assertEquals(s.mismatchRate, 50);
});

Deno.test('auditParityBatch: missing_volume 不計入 mismatch 分母', () => {
  const brokers = [b('9999', '2026-07-22', 100_000, 100_000)];
  const s = auditParityBatch(brokers, []);
  assertEquals(s.missingVolume, 1);
  assertEquals(s.mismatched, 0);
  assertEquals(s.mismatchRate, 0);
});

Deno.test('decideParityAlert: 樣本不足 skip', () => {
  const s = auditParityBatch([], []);
  const d = decideParityAlert(s);
  assertEquals(d.triggered, false);
  assertEquals(d.reason, 'sample_too_small');
});

Deno.test('decideParityAlert: warning 邊界 5%', () => {
  const brokers: BrokerRow[] = [];
  const volumes: VolumeRow[] = [];
  // 20 檔 ok
  for (let i = 0; i < 19; i++) {
    brokers.push(b(`S${i}`, '2026-07-22', 10_000, 10_000));
    volumes.push({ symbol: `S${i}`, trade_date: '2026-07-22', volume: 10_000 });
  }
  // 1 檔 mismatch
  brokers.push(b('BAD', '2026-07-22', 5_000, 10_000));
  volumes.push({ symbol: 'BAD', trade_date: '2026-07-22', volume: 10_000 });
  const s = auditParityBatch(brokers, volumes);
  assertEquals(s.mismatched, 1);
  assertEquals(s.mismatchRate, 5);
  const d = decideParityAlert(s);
  assertEquals(d.triggered, true);
  assertEquals(d.level, 'warning');
});

Deno.test('decideParityAlert: critical 15%+', () => {
  const brokers: BrokerRow[] = [];
  const volumes: VolumeRow[] = [];
  for (let i = 0; i < 17; i++) {
    brokers.push(b(`S${i}`, '2026-07-22', 10_000, 10_000));
    volumes.push({ symbol: `S${i}`, trade_date: '2026-07-22', volume: 10_000 });
  }
  for (let i = 0; i < 3; i++) {
    brokers.push(b(`BAD${i}`, '2026-07-22', 5_000, 10_000));
    volumes.push({ symbol: `BAD${i}`, trade_date: '2026-07-22', volume: 10_000 });
  }
  const s = auditParityBatch(brokers, volumes);
  assertEquals(s.mismatchRate, 15);
  const d = decideParityAlert(s);
  assertEquals(d.level, 'critical');
});

Deno.test('worst deltas 依 |buy_delta|+|sell_delta| 排序', () => {
  const brokers: BrokerRow[] = [
    b('A', '2026-07-22', 90_000, 100_000),   // sell delta 0, buy -10k
    b('B', '2026-07-22', 100_000, 50_000),   // sell -50k
    b('C', '2026-07-22', 100_000, 100_000),  // ok
  ];
  const volumes: VolumeRow[] = [
    { symbol: 'A', trade_date: '2026-07-22', volume: 100_000 },
    { symbol: 'B', trade_date: '2026-07-22', volume: 100_000 },
    { symbol: 'C', trade_date: '2026-07-22', volume: 100_000 },
  ];
  const s = auditParityBatch(brokers, volumes);
  assertEquals(s.worstDeltas[0].stock_id, 'B');
});
