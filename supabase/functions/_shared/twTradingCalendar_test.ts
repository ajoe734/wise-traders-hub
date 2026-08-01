import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isTwTradingDay,
  prevTwTradingDay,
  nextTwTradingDay,
  lastNTwTradingDays,
  enumerateTwTradingDates,
  twTradingDayDiff,
  taipeiTodayIso,
} from "./twTradingCalendar.ts";

Deno.test("週末與國定假日皆非交易日", () => {
  assertEquals(isTwTradingDay("2026-07-31"), true);  // Fri
  assertEquals(isTwTradingDay("2026-08-01"), false); // Sat
  assertEquals(isTwTradingDay("2026-08-02"), false); // Sun
  assertEquals(isTwTradingDay("2026-05-01"), false); // 勞動節
  assertEquals(isTwTradingDay("2026-02-17"), false); // 春節
  assertEquals(isTwTradingDay("bad-date"), false);
});

Deno.test("執行期注入的臨時休市（颱風假）也算非交易日", () => {
  assertEquals(isTwTradingDay("2026-07-30"), true);
  assertEquals(isTwTradingDay("2026-07-30", ["2026-07-30"]), false);
});

Deno.test("prev/next 交易日會跳過整段連假", () => {
  // 2026-02-16(一)~02-20(五) 春節休市，前一交易日為 02-13(五)
  assertEquals(prevTwTradingDay("2026-02-18"), "2026-02-13");
  assertEquals(nextTwTradingDay("2026-02-18"), "2026-02-23");
  assertEquals(prevTwTradingDay("2026-08-02"), "2026-07-31"); // Sun → Fri
  assertEquals(prevTwTradingDay("2026-07-31"), "2026-07-31"); // 本身即交易日
});

Deno.test("lastN 以交易日回推：連假不會讓 5 日視窗縮水", () => {
  // 以 2026-02-27(五, 和平紀念日補假) 為終點：先 roll 到 02-26(四)
  const w5 = lastNTwTradingDays("2026-02-27", 5);
  assertEquals(w5.length, 5);
  assertEquals(w5, ["2026-02-13", "2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26"]);
});

Deno.test("lastN 10 日視窗一定回傳 10 個交易日", () => {
  const w10 = lastNTwTradingDays("2026-05-01", 10);
  assertEquals(w10.length, 10);
  assertEquals(w10.every((d) => isTwTradingDay(d)), true);
  assertEquals(w10.includes("2026-05-01"), false); // 勞動節不入列
});

Deno.test("lastN 1 日視窗 = 最近交易日", () => {
  assertEquals(lastNTwTradingDays("2026-08-02", 1), ["2026-07-31"]);
  assertEquals(lastNTwTradingDays("2026-08-02", 0), []);
});

Deno.test("enumerate 跳過週末與假日", () => {
  assertEquals(
    enumerateTwTradingDates("2026-04-30", "2026-05-05"),
    ["2026-04-30", "2026-05-04", "2026-05-05"],
  );
  assertEquals(enumerateTwTradingDates("2026-08-01", "2026-08-02"), []);
  assertEquals(enumerateTwTradingDates("2026-08-05", "2026-08-01"), []);
});

Deno.test("交易日差不含起點、含終點", () => {
  assertEquals(twTradingDayDiff("2026-04-30", "2026-05-04"), 1);
  assertEquals(twTradingDayDiff("2026-05-04", "2026-04-30"), 1);
  assertEquals(twTradingDayDiff("2026-04-30", "2026-04-30"), 0);
});

Deno.test("台北曆日以 UTC+8 計算", () => {
  assertEquals(taipeiTodayIso(Date.parse("2026-07-31T16:30:00Z")), "2026-08-01");
  assertEquals(taipeiTodayIso(Date.parse("2026-07-31T15:30:00Z")), "2026-07-31");
});
