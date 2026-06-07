# 還沒嚴格審查的方向（P0–P5 之外）

P0–P5 已修完 9 + 11 + 9 + 13 + 5 + 147 條。原報告自己就已標註 **A 組（RWD）** 與 **C 組（Gate 三軌）** 還在背景跑沒進主流程。再往外推，下列 12 條完全沒被這輪深掃碰過。

---

## 原報告自己掛賬未完成（2 組）

### S1. A 組 — RWD 裝置別漏洞（輪 1–15）
- 範圍：360 / 380 / 390 / 430 / 768 / 1024 斷點 × `FreeCheckup` 以外的全站頁。
- 既有憲法只鎖了 FreeCheckup 的 `.wb-hero-grid` / `.wb-card`，其他頁（`/app/*`、`/company/*`、`/account/*`）沒走相同 QA。
- 重點懷疑：`pages/app/Signals.tsx`、`pages/company/*` 表格橫向、`AppCheckout.tsx` 卡片 grid、`PaymentMethodPicker` Sheet 高度、`Subscribers.tsx` filter bar、`Dashboard.tsx` KPI grid。

### S2. C 組 — Gate 三軌前端用法（輪 36–45）
- 狀態：guest / `line_free` / `line_paid` / subscribed / `none` 五軌。
- B-29/B-31 只修了 context 跟 quota card，**沒回頭掃所有「if (tier === 'free')」「if (!session)」「if (isLine)」分支**是否還有殘留誤判。
- 重點懷疑：`useCheckoutData.ts`、`useAccountData.ts`、`HoldingsQuotaMeter`、`DailyTab` 之外的 5 個 tab、`PendingRemittanceGuard`、`SubscriptionCard` 文案。

---

## 完全沒掃過的面向（10 條）

### S3. 並發 / Race condition
- 雙裝置同時送 `create-*-order` → DB 兩筆 active subscription（B-35 只修 CTA 流程，沒鎖 server）。
- 「立即續訂」按鈕無 client-side debounce / server-side idempotency key。
- `check_checkup_quota` 與 `consume_checkup_quota` 兩 RPC 之間無 transaction 鎖。
- cron 重疊（`expire-subscriptions` / `daily-snapshot` / `knowledge-*-scheduler` 互相時段重疊時是否會 double-write）。

### S4. Realtime channel 洩漏
- `useSignalRealtimeInvalidation` / Holdings realtime / Subscription realtime：unmount / route 切換時 `unsubscribe` 是否齊全。
- `useEffect` cleanup 漏寫 → reconnect 風暴、token 耗盡。
- supabase channel 命名是否唯一（同名 channel 多 tab 互踩）。

### S5. Auth 邊界
- Session 過期 / refresh token rotation 失敗的 UX（目前是否會卡白頁）。
- `line-login-callback` 同一 nonce 重放（已加 nonce 表，但 5 min TTL 內是否真的單次消耗）。
- Password reset 連結重用、過期後行為。
- 跨裝置同時登入 LINE → virtual email 衝突路徑。
- 已綁 LINE 帳號刪除 → 殘留 `expert_line_channels` / 訂閱關聯。

### S6. 資料一致性 / Orphan
- `profiles` vs `auth.users` 漂移（刪了 auth.user 但 profiles 沒清）。
- `member_subscriptions` 對 `subscription_plans` 的 FK 是否 cascade 正確（plan 改價舊訂閱怎麼算 MRR）。
- `checkup_subscriptions` 與 `member_subscriptions` 對同一 user 互斥規則沒寫進 DB constraint（只靠 app 層）。
- `expert_line_channels` 同 expert 多 channel 殘留。
- `holdings` / `trade_records` partial-sale 後是否有 0 量殘留。

### S7. Storage / 檔案
- bucket policy 全清單（哪些 public、哪些 signed URL、TTL）。
- 上傳 size / MIME 限制（`checkup-parse` base64 沒設上限就丟給 Anthropic，可能爆 token）。
- 過期截圖清理 cron（目前沒有）。
- 公開 bucket 是否被當免費 CDN（perf 衝擊）。

### S8. DB 效能 / 索引
- 從未跑過 `supabase--linter` + `db_health` 對照長 query。
- `signals_today` / `subscribers_with_*` view 是否 sequential scan。
- `holdings` × `current_prices` 計算缺複合 index。
- `traffic_ingest` 寫入量 vs `perf_metrics_rate_limit` 觸發頻率。
- WAL / 連線飽和。

### S9. 錯誤監控覆蓋
- `<ErrorBoundary>` 在哪些路由有 / 哪些沒（lazy chunk 載失敗 fallback）。
- `window.onunhandledrejection` 是否寫進 `traffic_ingest` 或 perf_metrics。
- Edge function `uncaught`（withLogging 已記）vs 前端 uncaught 之間是否有 correlation_id 串聯。

### S10. SEO / Meta / 社交
- `index.html` 是否帶 `legendflow` 品牌（憲法說「目前未套用」）。
- 每路由 `<title>` / OG image / canonical / sitemap / robots。
- JSON-LD（Organization / Service）。
- 行動裝置 viewport / theme-color。

### S11. i18n / a11y / 鍵盤
- 全站 zh-TW 一致性（B-30 的 `@line.local` 文案、英文殘留）。
- `aria-label` / `role` / focus trap / esc-to-close（Dialog / Sheet）。
- 對比度（Kore-eda alpha 太淡可能 < WCAG AA）。
- 鍵盤 Tab order 在 `Checkout` / `FreeCheckup` Hero 是否合理。

### S12. 依賴 / 套件安全
- 從未跑過 `dependency_scan`，CVE 未知。
- deprecated peer dep、React 18 → 19 升級風險評估。
- `bun.lockb` 與 `package.json` 漂移。

### S13. 觀測與成本
- AI 呼叫成本（Lovable AI Gateway 每月用量、per-user cap）。
- Anthropic / Resend / LINE push 月度配額警報。
- `traffic_ingest` PII（IP/UA）保留期、GDPR 邊界。
- Edge function cold-start 分佈、超時失敗率（withLogging 已寫 ms，但沒儀表板）。

---

## 推薦下一輪打擊順序

1. **S3 並發** + **S6 資料一致性** — 直接會吃錢 / 製造支援工單。
2. **S2 Gate 三軌全掃** — B-29/31 既有修補的回歸面，現在不掃下次又出 HoldingsQuotaMeter 同款 bug。
3. **S5 Auth 邊界** — line-login 才剛動完 nonce，留尾巴沒清。
4. **S8 DB 效能** + **S12 依賴掃描** — 純讀，半小時內可出報告。
5. **S1 RWD** + **S11 a11y** — 視覺/品質類，可拉長戰線分批。
6. **S4 / S7 / S9 / S10 / S13** — 後置。

---

## 給用戶的決策點

要哪一輪先開？（不選的話我預設按推薦順序 S3 → S6 → S2 一路掃下去，每組產一份條列報告 + 修復批次。）
