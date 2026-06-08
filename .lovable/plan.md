
# 全站深掃 — 剩餘工作完整清單與優化方案

## 一、剩餘工作清單（7 項，依風險 × 收益排序）

| # | 項目 | 風險面 | 規模 | 優先級 |
|---|---|---|---|---|
| R1 | traffic_ingest PII 清洗（IP 雜湊 + UA 截斷） | GDPR / 資料外洩 | S（1 migration + 1 trigger） | **P0** |
| R2 | 自動清理 cron（`cleanup-ops-logs`） | 成本 / DB 膨脹 | M（1 edge fn + 1 cron） | **P0** |
| R3 | E-VALID-001 剩餘 26 支 edge 正式 Zod schema | DX / Type safety | L（26 fn + unit tests） | **P1** |
| R4 | ShareButton 推廣到 line push / 系統公告 / 個人收藏 | SEO / 社交傳播率 | M（3 個寫入點） | **P1** |
| R5 | Edge cold-start 量測 + ops-health 儀表板 | 觀測 / 效能調校 | M（_shared boot timer + UI） | **P2** |
| R6 | 真正 SSR / prerender（in-app URL 可被 crawler 抓） | SEO 上限 | XL（架構級遷移） | **P3** |
| R7 | S11 i18n / a11y / 對比度 | 無障礙 / 法遵 | XL（全站掃） | **P3（用戶已 pause）** |

---

## 二、各項優化方案（深度方案）

### R1 — traffic_ingest PII 清洗（P0，建議先做）
**現況**：`traffic_ingest` 與 `perf_metrics` 直接存 client IP 全字串、UA 全字串、referrer 全 URL（含 query string，可能含 token）。GDPR 規範下 IP 屬於 PII。

**優化方案（單一 migration 即可落地）**：
- 新增 `public.anonymize_ip(text)` SQL function：
  - IPv4 → 保留前三段（`203.74.114.0`）
  - IPv6 → 保留前 /48
  - 失敗回 `null`
- `traffic_events` / `perf_metrics` BEFORE INSERT trigger：
  - `NEW.ip_address := anonymize_ip(NEW.ip_address)`
  - `NEW.user_agent := left(NEW.user_agent, 200)`
  - `NEW.referrer := regexp_replace(NEW.referrer, '\?.*$', '')`（剝 query string）
- 歷史資料用一次性 UPDATE 清洗（單獨 migration，跑完即丟）。
- 同步在 `ops-health` 儀表板秀「PII 清洗狀態：✓ 已啟用」狀態。

**為什麼這樣**：trigger 比 application-level 清洗強硬（攔截所有寫入路徑，含未來新 edge fn）；保留前三段 IP 仍可粗略地理分析。

---

### R2 — 自動清理 cron（P0，配合 R1 一起做）
**現況**：`ops-health` 只「建議」清理，無實際 cron。`function_run_logs` / `system_jobs_log` / `audit_logs` / `perf_metrics` / `traffic_events` 5 表會無限長大，DB 容量與查詢效能會逐步惡化。

**優化方案**：
- 新增 `supabase/functions/cleanup-ops-logs/index.ts`（cron secret 保護）：
  - 各表分別套 retention policy（可配置常數，預設）：
    - `function_run_logs`: 30 天
    - `system_jobs_log`: 90 天（排程歷史價值較高）
    - `audit_logs`: **保留 365 天**（法遵）
    - `perf_metrics`: 14 天（RUM 短期足夠）
    - `traffic_events`: 30 天
  - 每表分批 `DELETE ... WHERE created_at < now() - interval 'X days' LIMIT 5000` 迴圈，避免長 lock。
  - 寫一筆 `system_jobs_log` 記錄刪除量。
- pg_cron 排程：每日 04:00 (Asia/Taipei) 跑一次（避開交易時段）。
- `ops-health` 頁面加「最後清理時間 / 上次刪除筆數」KPI。

**為什麼這樣**：分批 + LIMIT 避免 OOM 與長 lock；audit_logs 法遵保留長一點；UI 透明化讓 admin 知道機制有跑。

---

### R3 — E-VALID-001 剩餘 26 支 Zod 正式 schema（P1）
**現況**：3 支高風險（data-upsert / signal-ai-assist / admin-manage-users）已套 Zod。其餘 26 支只有 inline 驗證，拒絕能力等價但 DX 差、易在 refactor 時漏。

**優化方案（避免 26 支爆改一次破很多）**：
- 分 5 個獨立 PR，每個 PR 5-6 支同類 fn + 對應 unit test：
  1. 金流寫入類 11 支：共用 `paymentOrderSchema` base + 各 provider extend
  2. 訂閱/管理類 5 支
  3. 觀測/排程類 5 支
  4. LINE / ACpay 類 5 支
- 每個 schema 寫對應 `*_test.ts` Deno test，至少 3 case（valid / missing required / type confusion）。
- 改寫策略：**先用 `.passthrough()` + `.optional()`**，保證舊 client payload 不會 400；觀察 1 週 log 無 reject → 再收緊。
- 共用 `_shared/validators/` 收斂：`paymentOrderSchema`、`adminActionSchema`、`tier enum`、`stockCode regex`。

**為什麼這樣**：26 支一次改容易把舊 client 打 400，分批 + passthrough 過渡期最安全；test 強制每支驗證行為被鎖住。

---

### R4 — ShareButton 推廣（P1）
**現況**：`shareUrl.ts` + `share-og` 已就緒，但只有 3 個 in-app 頁面（SignalDetail/JournalDetail/ExpertDetail）用。其他 share 寫入點仍輸出原始 in-app URL，被 social crawler 抓到只會看到預設 OG。

**優化方案**：
- 全站搜尋並改寫 3 個寫入點：
  1. **line-push-signal** edge fn：push 文字中的訊號連結 → `buildShareUrl({ kind: 'signal', id })`
  2. **系統公告 announcements**：admin 後台插入連結時走 ShareButton 同 helper（後台 RTE 加 toolbar 按鈕）
  3. **個人收藏匯出** / **訂閱續訂提醒**：renew 信件中連結同步切換
- 新增 `scripts/check-share-urls.ts`：grep `legendflow.tw/(app|portfolio)/signal|journal|expert` 在 edge fn / email template 出現處，未透過 `buildShareUrl` 就報警；掛入 `bun run check:share-urls`。

**為什麼這樣**：share-og 投資已沉沒，分享觸點愈多 SEO 與點擊回流愈高；自動化檢查防止未來新寫入點漏網。

---

### R5 — Edge cold-start 量測（P2）
**現況**：ops-health 已有 `function_run_logs` 聚合（runs/errors/error_rate），但缺 cold-start 數據，無法判斷哪支 fn 該保 warmup。

**優化方案**：
- `_shared/edgeLogger.ts` 加 module-level `BOOT_AT = Date.now()` 與 `INVOCATION_COUNT = 0`：
  - 每次 handler 進入，若 `INVOCATION_COUNT === 0` → 標 `coldStart: true` 並記 `bootToFirstReqMs`
  - log entry 加欄位 `cold_start boolean`、`boot_to_first_req_ms int`
- migration：`function_run_logs` 加兩欄。
- `ops-health` 加「冷啟動 7 天統計」表：fn × cold_start_count / avg_boot_ms / cold_pct。
- 對 cold_pct > 30% 且 boot > 1000ms 的 fn 給「考慮加 warmup ping」提示。

**為什麼這樣**：用最低侵入度（module-level 變數）拿到 cold-start 訊號；資料先收，警報門檻先寬鬆，避免噪音。

---

### R6 — 真正 SSR / prerender（P3，先不做）
**為什麼建議延後**：
- 目前 share-og workaround 對社交分享已 95% 解決（只是要用 ShareButton）。
- 真 SSR 要動 Vite → SSR 框架（Vinxi / Astro / Next）或加 prerender 中介（Cloudflare Worker + puppeteer），涉及部署與 build pipeline 全面重寫，1-2 週工程量。
- 等 R4 推廣完成、追蹤 share-og 命中率，再決定是否值得投資。

**若真要做的最務實方案**：Cloudflare Worker 前置一層，UA 判斷 crawler → 打 puppeteer prerender service（Rendertron 或自架）→ cache 24h；in-app URL 不改、ShareButton 可保留。

---

### R7 — S11 i18n / a11y / 對比度（用戶已 pause）
保留清單供未來啟動：
- a11y：所有互動元素鍵盤可達、`aria-label` 覆蓋 icon button、Dialog focus trap 檢查
- 對比度：semantic token 對白底/暗底兩個 mode 各跑一次 WCAG AA（4.5:1）
- i18n：抽出寫死中文文案到 `src/locales/zh-TW.ts`，不切英文版（用戶過去明確說台灣市場優先）

---

## 三、建議執行順序

```text
Wave 1（本週，~2 小時）：R1 + R2
  ↓ 都是 backend，0 UI 風險，馬上降 PII 與成本風險

Wave 2（下週，~3 小時）：R4
  ↓ 解鎖 share-og 投資的真正回報

Wave 3（迭代，每週 1 PR）：R3 拆 5 個 PR 完成
  ↓ 不擾動使用者，提升內部 DX

Wave 4（可選）：R5 cold-start 量測
  ↓ 拿到資料再決定要不要 warmup

R6 / R7：等業務需求觸發再啟動
```

---

## 四、優化原則總結（給用戶決策參考）

1. **先動 backend 不動 UI**：R1/R2 對使用者零感知，純降風險與成本。
2. **拆小批避免回歸**：R3 一次 5-6 支 + test，passthrough 過渡，不在一個 PR 改完 26 支。
3. **投資沉沒成本回收**：R4 把 share-og 與 ShareButton 推到所有分享觸點。
4. **延後高成本低急迫項**：R6 SSR 與 R7 a11y 等業務真的需要再啟動。

是否要先執行 Wave 1（R1 PII 清洗 + R2 自動清理 cron）？
