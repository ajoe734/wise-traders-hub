#!/usr/bin/env node
/**
 * scripts/refresh-demo-data.mjs
 *
 * 目的：協助維護者快速產生最新版的 demoData「日期相關」字串。
 *
 * ⚠️ 本腳本只產生「建議片段」，不會自動覆寫 demoData.js。
 *    請手動把建議內容貼到 src/checkup/data/demoData.js 中對應位置，
 *    並把檔案開頭的 DEMO_DATA_VERSION 更新為當月（YYYY-MM）。
 *
 * 執行：bun scripts/refresh-demo-data.mjs
 *      或：node scripts/refresh-demo-data.mjs
 *
 * 詳細 SOP：docs/demo-data-maintenance.md
 */

const today = new Date();
const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const todaySlash = today.toLocaleDateString('zh-TW').replace(/-/g, '/');
const fmt = (d) => d.toLocaleDateString('zh-TW').replace(/-/g, '/');
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

const banner = (s) => `\n=== ${s} ===\n`;

console.log(banner('1. 更新 DEMO_DATA_VERSION'));
console.log(`export const DEMO_DATA_VERSION = '${ym}'`);

console.log(banner('2. DEMO_ANALYSIS.aiInsight 提醒'));
console.log(`日期參考：${todaySlash}`);
console.log('建議手動更新內容：');
console.log('  - ## 今日總結 一句話帶到當月主要族群（AI/散熱/CPO 等）');
console.log('  - ## 事件連動分析 改寫 1-2 個近期真實事件');
console.log('  - ## 個股操作建議 至少 3-4 檔，標的需存在於 DEMO_HOLDINGS');
console.log('  - ## 風險警示 對應當月實際盤勢（行情類別）');

console.log(banner('3. DEMO_CALENDAR / DEMO_EVENTS 日期建議'));
const dates = [
  ['threeDaysLater', addDays(3)],
  ['fiveDaysLater', addDays(5)],
  ['sevenDaysLater', addDays(7)],
  ['tenDaysLater', addDays(10)],
  ['fourteenDaysLater', addDays(14)],
];
dates.forEach(([k, d]) => console.log(`  ${k.padEnd(20)} = '${fmt(d)}'`));
console.log('（demoData.js 已用相對日期計算，無需手動改日期常數）');

console.log(banner('4. DEMO_BRAIN_UPDATED.lessons 建議'));
console.log(`新增當天教訓：{ date: '${todaySlash}', text: '<近期實際盤後觀察>' }`);
console.log('保留：最多 3-5 條，按時間倒序，刪除超過 3 個月的舊教訓');

console.log(banner('5. 驗收清單（人工檢查）'));
const checklist = [
  '[ ] DEMO_DATA_VERSION 已改為當月 YYYY-MM',
  '[ ] aiInsight 提到的股票代號全部存在於 INIT_HOLDINGS',
  '[ ] DEMO_CALENDAR 至少 3 筆 upcoming 事件',
  '[ ] DEMO_EVENTS 至少 1 個 past 命中事件（驗證命中率展示）',
  '[ ] DEMO_BRAIN_UPDATED.lastUpdate = 今天日期 YYYY/MM/DD',
  '[ ] 訪客模式打開 /free-checkup 看不到 401 / AI callEdge',
  '[ ] 點「收盤分析」走 4 段模擬步驟，最後顯示 DEMO_ANALYSIS',
];
checklist.forEach((c) => console.log(c));

console.log(banner('完成'));
console.log('詳細步驟：cat docs/demo-data-maintenance.md');
