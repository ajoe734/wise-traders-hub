import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { enumerateTradingDates } from "./backfillDates.ts";

Deno.test("展開逐日並跳過週末", () => {
  // 2026-07-29(三)..2026-08-03(一)
  assertEquals(enumerateTradingDates("2026-07-29", "2026-08-03"), [
    "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-03",
  ]);
});

Deno.test("單日區間回傳單日", () => {
  assertEquals(enumerateTradingDates("2026-07-31", "2026-07-31"), ["2026-07-31"]);
});

Deno.test("純週末回傳空陣列", () => {
  assertEquals(enumerateTradingDates("2026-08-01", "2026-08-02"), []);
});

Deno.test("start > end 或非法日期回傳空陣列", () => {
  assertEquals(enumerateTradingDates("2026-08-05", "2026-08-01"), []);
  assertEquals(enumerateTradingDates("bad", "2026-08-01"), []);
});
