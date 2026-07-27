import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  auditRow,
  auditBatch,
  decideAlert,
  TOLERANCE_SHARES,
  MIN_SAMPLE,
  type InstRow,
} from "./institutionalConsistency.ts";

function mk(over: Partial<InstRow> = {}): InstRow {
  return {
    stock_id: "2330",
    trade_date: "2026-07-24",
    foreign_net: 100_000,
    trust_net: 20_000,
    dealer_net: 5_000,
    total_net: 125_000,
    source: "t86",
    ...over,
  };
}

Deno.test("auditRow: 匹配的列 ok=true", () => {
  const r = auditRow(mk());
  assert(r.ok);
  assertEquals(r.issues.length, 0);
  assertEquals(r.delta, 0);
});

Deno.test("auditRow: total 誤差在 tolerance 內視為 match", () => {
  const r = auditRow(mk({ total_net: 125_000 + TOLERANCE_SHARES }));
  assert(r.ok);
});

Deno.test("auditRow: total 誤差超過 tolerance → total_mismatch", () => {
  const r = auditRow(mk({ total_net: 125_100 }));
  assert(!r.ok);
  assertEquals(r.issues, ["total_mismatch"]);
  assertEquals(r.delta, 100);
});

Deno.test("auditRow: 三分項皆 0 但 total 非 0 → all_parts_zero_total_nonzero", () => {
  const r = auditRow(mk({ foreign_net: 0, trust_net: 0, dealer_net: 0, total_net: 500 }));
  assert(!r.ok);
  // total_mismatch 優先，只保留一個原因避免重複
  assertEquals(r.issues, ["total_mismatch"]);
});

Deno.test("auditRow: 三分項皆 0 且 total 也 0 → ok", () => {
  const r = auditRow(mk({ foreign_net: 0, trust_net: 0, dealer_net: 0, total_net: 0 }));
  assert(r.ok);
});

Deno.test("auditBatch: 全部正常 mismatchRate=0", () => {
  const rows = Array.from({ length: 30 }, () => mk());
  const s = auditBatch(rows);
  assertEquals(s.mismatched, 0);
  assertEquals(s.mismatchRate, 0);
});

Deno.test("auditBatch: worstDeltas 依 |delta| 排序取前 5", () => {
  const rows = [
    mk({ stock_id: "A", total_net: 125_000 + 10 }),
    mk({ stock_id: "B", total_net: 125_000 + 500 }),
    mk({ stock_id: "C", total_net: 125_000 - 900 }),
    mk({ stock_id: "D", total_net: 125_000 + 50 }),
    mk({ stock_id: "E", total_net: 125_000 - 20 }),
    mk({ stock_id: "F", total_net: 125_000 + 1000 }),
  ];
  const s = auditBatch(rows);
  assertEquals(s.mismatched, 6);
  assertEquals(s.worstDeltas.length, 5);
  assertEquals(s.worstDeltas[0].stock_id, "F");
  assertEquals(s.worstDeltas[1].stock_id, "C");
});

Deno.test("auditBatch: bySource 分群統計", () => {
  const rows = [
    ...Array.from({ length: 5 }, () => mk({ source: "t86" })),
    ...Array.from({ length: 3 }, () => mk({ source: "twse_bfi82u", total_net: 999 })),
  ];
  const s = auditBatch(rows);
  assertEquals(s.bySource.t86, { total: 5, mismatched: 0 });
  assertEquals(s.bySource.twse_bfi82u, { total: 3, mismatched: 3 });
});

Deno.test("decideAlert: 樣本不足 → skip", () => {
  const s = auditBatch(Array.from({ length: MIN_SAMPLE - 1 }, () => mk()));
  const d = decideAlert(s);
  assertEquals(d.triggered, false);
  assertEquals(d.reason, "sample_too_small");
});

Deno.test("decideAlert: 5%~15% → warning", () => {
  const rows = [
    ...Array.from({ length: 19 }, () => mk()),
    mk({ stock_id: "BAD", total_net: 999 }),
  ]; // 5% mismatch, 樣本 20
  const s = auditBatch(rows);
  const d = decideAlert(s);
  assertEquals(d.triggered, true);
  assertEquals(d.level, "warning");
});

Deno.test("decideAlert: >=15% → critical", () => {
  const rows = [
    ...Array.from({ length: 17 }, () => mk()),
    ...Array.from({ length: 3 }, (_, i) => mk({ stock_id: `X${i}`, total_net: 999 })),
  ]; // 15% mismatch
  const s = auditBatch(rows);
  const d = decideAlert(s);
  assertEquals(d.triggered, true);
  assertEquals(d.level, "critical");
});

Deno.test("decideAlert: 全部正常 → ok", () => {
  const s = auditBatch(Array.from({ length: 30 }, () => mk()));
  const d = decideAlert(s);
  assertEquals(d.triggered, false);
  assertEquals(d.reason, "ok");
});
