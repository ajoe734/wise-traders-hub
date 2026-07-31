// TDD seam：per-stock 三大法人回補的純邏輯
//   1. 公開模式判定（哪些 mode 不需要 cron key / admin）
//   2. stock_id 白名單與 days clamp
//   3. 同檔冷卻限流
//   4. FinMind 多列 → 每日淨額聚合
//   5. sealed 快照排除（避免整批 upsert 撞 immutability trigger）
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isPublicSyncMode,
  isValidStockId,
  clampBackfillDays,
  takeCooldownSlot,
  aggregateInstitutionalRows,
  partitionWritableRows,
  BACKFILL_COOLDOWN_MS,
} from "./institutionalBackfill.ts";

Deno.test("isPublicSyncMode：只有公開資料模式免守門", () => {
  assertEquals(isPublicSyncMode("backfill_stock"), true);
  assertEquals(isPublicSyncMode("cold_start_status"), true);
  assertEquals(isPublicSyncMode("cold_start"), false);
  assertEquals(isPublicSyncMode("keep_warm"), false);
  assertEquals(isPublicSyncMode("fastlane"), false);
  assertEquals(isPublicSyncMode(undefined), false);
  assertEquals(isPublicSyncMode(""), false);
});

Deno.test("isValidStockId：四碼且首位 1-9", () => {
  assertEquals(isValidStockId("2330"), true);
  assertEquals(isValidStockId(" 2454 "), true);
  assertEquals(isValidStockId("0050"), false);
  assertEquals(isValidStockId("233"), false);
  assertEquals(isValidStockId("23300"), false);
  assertEquals(isValidStockId("2330A"), false);
  assertEquals(isValidStockId(null), false);
});

Deno.test("clampBackfillDays：預設 60、夾在 1..120", () => {
  assertEquals(clampBackfillDays(undefined), 60);
  assertEquals(clampBackfillDays(0), 60);
  assertEquals(clampBackfillDays("abc"), 60);
  assertEquals(clampBackfillDays(5), 5);
  assertEquals(clampBackfillDays(999), 120);
  assertEquals(clampBackfillDays(-3), 1);
});

Deno.test("takeCooldownSlot：同檔 60 秒內第二次被擋，逾時後放行，不同檔互不影響", () => {
  const map = new Map<string, number>();
  const t0 = 1_000_000;
  assertEquals(takeCooldownSlot(map, "2330", t0), true);
  assertEquals(takeCooldownSlot(map, "2330", t0 + 1_000), false);
  assertEquals(takeCooldownSlot(map, "2454", t0 + 1_000), true);
  assertEquals(takeCooldownSlot(map, "2330", t0 + BACKFILL_COOLDOWN_MS), true);
});

Deno.test("aggregateInstitutionalRows：依日期聚合三大法人淨額", () => {
  const rows = [
    { date: "2026-07-30", name: "Foreign_Investor", buy: 1000, sell: 400 },
    { date: "2026-07-30", name: "Foreign_Dealer_Self", buy: 100, sell: 0 },
    { date: "2026-07-30", name: "Investment_Trust", buy: 500, sell: 700 },
    { date: "2026-07-30", name: "Dealer_self", buy: 300, sell: 100 },
    { date: "2026-07-31", name: "Investment_Trust", buy: 200, sell: 0 },
    { date: "", name: "Investment_Trust", buy: 999, sell: 0 },
  ];
  const out = aggregateInstitutionalRows(rows, "2330");
  assertEquals(out.length, 2);
  const d0 = out.find((r) => r.trade_date === "2026-07-30")!;
  assertEquals(d0.stock_id, "2330");
  assertEquals(d0.foreign_net, 700);
  assertEquals(d0.trust_net, -200);
  assertEquals(d0.dealer_net, 200);
  assertEquals(d0.total_net, 700);
  const d1 = out.find((r) => r.trade_date === "2026-07-31")!;
  assertEquals(d1.trust_net, 200);
  assertEquals(d1.total_net, 200);
});

Deno.test("aggregateInstitutionalRows：空輸入回空陣列", () => {
  assertEquals(aggregateInstitutionalRows([], "2330").length, 0);
});

Deno.test("partitionWritableRows：只排除『已封存且已存在』的日期", () => {
  const chunk = [
    { stock_id: "2330", trade_date: "2026-07-28" },
    { stock_id: "2330", trade_date: "2026-07-29" },
    { stock_id: "2330", trade_date: "2026-07-30" },
  ] as any[];
  const sealed = new Set(["2026-07-28", "2026-07-29"]);
  const existing = new Set(["2026-07-28"]);
  const { writable, skipped } = partitionWritableRows(chunk, sealed, existing);
  assertEquals(skipped, 1);
  assertEquals(writable.map((r) => r.trade_date), ["2026-07-29", "2026-07-30"]);
});

Deno.test("partitionWritableRows：沒有 sealed 時全部可寫", () => {
  const chunk = [{ trade_date: "2026-07-30" }] as any[];
  const { writable, skipped } = partitionWritableRows(chunk, new Set(), new Set(["2026-07-30"]));
  assertEquals(skipped, 0);
  assertEquals(writable.length, 1);
});
