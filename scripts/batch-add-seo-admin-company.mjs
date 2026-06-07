#!/usr/bin/env node
/**
 * 一次性批次：為 /admin 與 /company 全部受保護頁面加 <SEO noindex />。
 * 跑一次後可刪。
 */
import { readFileSync, writeFileSync } from "node:fs";

// [file, layoutOpenLine(原檔，未加 import 前), layoutTag, titleExpr, descExpr, pathExpr]
const TARGETS = [
  // admin (10) — :expertSlug 動態
  ["src/pages/admin/Dashboard.tsx", 108, "AdminLayout", "`${expertSlug || ''} 管理首頁 | legendflow`", "'專家後台首頁：訊號、訂閱、績效總覽。'", "`/admin/${expertSlug || ''}`"],
  ["src/pages/admin/Signals.tsx", 182, "AdminLayout", "`${expertSlug || ''} 訊號管理 | legendflow`", "'發布與管理策略訊號。'", "`/admin/${expertSlug || ''}/signals`"],
  ["src/pages/admin/SignalEditor.tsx", 237, "AdminLayout", "`${expertSlug || ''} 訊號編輯 | legendflow`", "'撰寫或編輯策略訊號。'", "`/admin/${expertSlug || ''}/signals/edit`"],
  ["src/pages/admin/Subscribers.tsx", 68, "AdminLayout", "`${expertSlug || ''} 訂閱者 | legendflow`", "'查看已訂閱會員與到期狀態。'", "`/admin/${expertSlug || ''}/subscribers`"],
  ["src/pages/admin/Profile.tsx", 108, "AdminLayout", "`${expertSlug || ''} 專家檔案 | legendflow`", "'維護專家個人檔案與簡介。'", "`/admin/${expertSlug || ''}/profile`"],
  ["src/pages/admin/Performance.tsx", 20, "AdminLayout", "`${expertSlug || ''} 績效 | legendflow`", "'歷史績效與績效報表。'", "`/admin/${expertSlug || ''}/performance`"],
  ["src/pages/admin/ReasonTemplates.tsx", 141, "AdminLayout", "`${expertSlug || ''} 理由範本 | legendflow`", "'管理訊號發布的常用理由範本。'", "`/admin/${expertSlug || ''}/reason-templates`"],
  ["src/pages/admin/SignalTemplates.tsx", 157, "AdminLayout", "`${expertSlug || ''} 訊號範本 | legendflow`", "'管理訊號模板（標的、進出場條件）。'", "`/admin/${expertSlug || ''}/signal-templates`"],
  ["src/pages/admin/Announcements.tsx", 42, "AdminLayout", "`${expertSlug || ''} 公告 | legendflow`", "'發布專家公告給訂閱者。'", "`/admin/${expertSlug || ''}/announcements`"],
  ["src/pages/admin/Plans.tsx", 73, "AdminLayout", "`${expertSlug || ''} 訂閱方案 | legendflow`", "'管理訂閱方案與價格。'", "`/admin/${expertSlug || ''}/plans`"],
  // company (23) — 靜態
  ["src/pages/company/Dashboard.tsx", 74, "CompanyLayout", "'公司後台首頁 | legendflow'", "'平台營運總覽。'", "'/company'"],
  ["src/pages/company/Users.tsx", 182, "CompanyLayout", "'使用者管理 | legendflow'", "'所有平台使用者與角色管理。'", "'/company/users'"],
  ["src/pages/company/Analysts.tsx", 103, "CompanyLayout", "'分析師管理 | legendflow'", "'分析師檔案、上下架、權限管理。'", "'/company/analysts'"],
  ["src/pages/company/Subscribers.tsx", 145, "CompanyLayout", "'訂閱者管理 | legendflow'", "'平台訂閱者總覽。'", "'/company/subscribers'"],
  ["src/pages/company/Revenue.tsx", 35, "CompanyLayout", "'營收儀表 | legendflow'", "'平台營收與 MRR 統計。'", "'/company/revenue'"],
  ["src/pages/company/Payments.tsx", 281, "CompanyLayout", "'金流管理 | legendflow'", "'所有金流訂單與退款處理。'", "'/company/payments'"],
  ["src/pages/company/Announcements.tsx", 109, "CompanyLayout", "'系統公告 | legendflow'", "'平台系統公告管理。'", "'/company/announcements'"],
  ["src/pages/company/AuditLogs.tsx", 190, "CompanyLayout", "'稽核日誌 | legendflow'", "'平台操作稽核紀錄。'", "'/company/audit-logs'"],
  ["src/pages/company/SystemJobs.tsx", 82, "CompanyLayout", "'系統排程 | legendflow'", "'排程任務狀態。'", "'/company/system-jobs'"],
  ["src/pages/company/FunctionLogs.tsx", 84, "CompanyLayout", "'Function 日誌 | legendflow'", "'Edge function 執行紀錄與錯誤追蹤。'", "'/company/function-logs'"],
  ["src/pages/company/KnowledgeBase.tsx", 58, "CompanyLayout", "'知識庫 | legendflow'", "'平台知識庫管理。'", "'/company/knowledge-base'"],
  ["src/pages/company/knowledge-base/KnowledgeAudit.tsx", 149, "CompanyLayout", "'知識庫稽核 | legendflow'", "'知識庫條目稽核。'", "'/company/knowledge-audit'"],
  ["src/pages/company/knowledge-base/KnowledgeScheduler.tsx", 207, "CompanyLayout", "'知識庫排程 | legendflow'", "'知識庫排程任務。'", "'/company/knowledge-scheduler'"],
  ["src/pages/company/BacktestMonitor.tsx", 37, "CompanyLayout", "'回測監控 | legendflow'", "'策略回測任務監控。'", "'/company/backtest-monitor'"],
  ["src/pages/company/Plans.tsx", 113, "CompanyLayout", "'方案審核 | legendflow'", "'分析師訂閱方案審核與分潤設定。'", "'/company/plans'"],
  ["src/pages/company/Remittance.tsx", 143, "CompanyLayout", "'匯款管理 | legendflow'", "'匯款訂單審核與對帳。'", "'/company/remittance'"],
  ["src/pages/company/PaymentSettings.tsx", 87, "CompanyLayout", "'金流設定 | legendflow'", "'金流通道與分潤設定。'", "'/company/payment-settings'"],
  ["src/pages/company/ReferralChannels.tsx", 11, "CompanyLayout", "'推薦通道 | legendflow'", "'推薦來源通道管理。'", "'/company/referral-channels'"],
  ["src/pages/company/CheckupUsage.tsx", 91, "CompanyLayout", "'診斷用量 | legendflow'", "'AI 持倉診斷用量統計。'", "'/company/checkup-usage'"],
  ["src/pages/company/MissingPrices.tsx", 124, "CompanyLayout", "'缺價追蹤 | legendflow'", "'股價缺漏監控與補抓。'", "'/company/missing-prices'"],
  ["src/pages/company/MetaOverrides.tsx", 105, "CompanyLayout", "'股票 Meta 覆寫 | legendflow'", "'股票名稱與產業覆寫設定。'", "'/company/meta-overrides'"],
  ["src/pages/company/PerfMetrics.tsx", 83, "CompanyLayout", "'前端效能 | legendflow'", "'前端 FCP/LCP RUM 儀表板。'", "'/company/perf-metrics'"],
  ["src/pages/company/Traffic.tsx", 246, "CompanyLayout", "'流量分析 | legendflow'", "'平台流量與行為分析。'", "'/company/traffic'"],
];

let okCount = 0, skipCount = 0;
for (const [file, origLine, tag, titleExpr, descExpr, pathExpr] of TARGETS) {
  const src = readFileSync(file, "utf8");
  if (/from ['"]@\/components\/SEO/.test(src)) {
    console.warn(`SKIP (已有 SEO): ${file}`);
    skipCount++;
    continue;
  }
  const lines = src.split("\n");
  // 1) 在第 1 行 prepend SEO import
  lines.unshift(`import { SEO } from '@/components/SEO';`);
  // 原 layout 開頭那行現在 = origLine（因為 unshift 把它推到 origLine+1，但陣列是 0-index，原 origLine 對應 lines[origLine-1] 變成 lines[origLine]）
  const targetIdx = origLine; // 加 import 後 +1
  const expected = lines[targetIdx];
  if (!expected || !expected.includes(`<${tag}`)) {
    console.error(`FAIL ${file}: line ${targetIdx + 1} 不含 <${tag} → "${expected?.trim()}"`);
    continue;
  }
  // 在 layout 開頭那行後插入 SEO
  const indent = (expected.match(/^\s*/)?.[0] ?? "") + "  ";
  lines.splice(targetIdx + 1, 0, `${indent}<SEO title={${titleExpr}} description={${descExpr}} path={${pathExpr}} noindex />`);
  writeFileSync(file, lines.join("\n"));
  okCount++;
}
console.log(`Done: ${okCount} files updated, ${skipCount} skipped.`);
