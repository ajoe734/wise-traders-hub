# /expert/:slug 週記真實範例（Sample Week）— 唯讀稽核 + 執行計畫

本輪未改任何 code / DB / RLS / RPC / 資料，未 deploy、未 Publish。以下皆為實測結果。

---

## A. 現況資料流（exact）

| 位置 | 事實 |
|---|---|
| `src/pages/ExpertProfile.tsx:302` | 渲染 `<SampleStructureCard expertSlug utmCampaign />`，父層 section 見 `:289-309` |
| `src/pages/_expert/SampleStructureCard.tsx:43-54` | 只跑 `SAMPLE_STRUCTURE_FIELDS.map`，內容是 `div.ev-masked`（純遮罩骨架），**零資料查詢** |
| `src/pages/ExpertProfile.tsx:58` → `src/hooks/useExpert.ts:244-254` | `supabase.rpc('get_expert_detail_bundle', { _slug })` |
| RPC `get_expert_detail_bundle(_slug text)` | SECURITY DEFINER、anon EXECUTE = true。回傳 JSON：`expert`(experts 欄位)、`plans`、`subscriber_count`、`my_subscribed_plan_ids`。**不含任何週記原文欄位** |
| 後台寫作 | 路由 `/admin/:expertSlug/signals`(`src/App.tsx:405-407`) → `src/pages/admin/SignalEditor.tsx:262` 呼叫 `save_signal_batch(_expert_id,_batch_id,_signals,_legs,_is_editing)`（SECURITY DEFINER，anon EXECUTE=false） |
| 儲存表 | `public.expert_signals` |
| 老師原文欄位 | `reason_summary`、`reason_detail`、`risk_notes`、`learning_points`、`overall_summary`、`teaching_topic` |
| 週次 | 無 week 欄位；週界線由 `published_at` 以 `@/lib/taipeiWeek` 推導（同一批次 `batch_id`） |
| 發布狀態 | `status`（實測值 `published` / `pending`）＋ `taken_down_reason/by`、`published_at`、`line_pushed_at` |
| market / asset_class | `expert_signals.market`（trigger `set_expert_signal_market`）＋ `experts.asset_class` / `currency` |
| 讀取單一資料源 | `src/lib/journalRepository.ts`（`JOURNAL_LIST_SELECT:25` / `JOURNAL_DETAIL_SELECT:29` / `forSubscriber:72` / `forOwnerPreview:98`），Deno 鏡像 `_shared/journalRepository.ts` |

---

## B. Production 只讀稽核（sanitized，未貼原文）

`expert_signals × experts(role='mentor')` 全表統計：

| slug | published | pending | 最舊→最新（Taipei） | batches |
|---|---|---|---|---|
| sharkgu | 88 | 0 | 2026-05-04 → 08-21 | 62 |
| master-brcto | 37 | 0 | 2026-06-17 → 08-21 | 24 |
| master-zhou | 36 | 2 | 2026-06-18 → 08-15 | 29 |
| master-lever | 3 | 0 | 2026-08-01 → 08-01 | 1 |
| master-brian | 0 | 0 | — | 0 |
| benny（第 6 位 mentor，不在你名單內） | 14 | 1 | 2026-07-21 → 08-15 | 7 |

分類：**已發布歷史內容** = 上表 published；**訂閱者專屬** = 同一批 published 列（目前只有訂閱者/擁有者/admin 讀得到）；**草稿/未發布** = `status='pending'`（benny 1、master-zhou 2）；**不存在** = `master-brian`（誠實 empty，不代填）。

週次 manifest（節錄；已算出全部週次的 record count / 段落數 / 字數 / md5-12）：

| slug | Taipei week | n | summary/detail/risk/learn/overall | chars | hash |
|---|---|---|---|---|---|
| sharkgu | 2026-08-17 | 3 | 2/2/1/1/3 | 652 | 62bf2f1e50b5 |
| sharkgu | 2026-08-10 | 6 | 5/3/1/1/4 | 1119 | 06d8260976d8 |
| master-zhou | 2026-08-10 | 6 | 6/3/0/0/4 | 922 | 71690e6dd804 |
| master-brcto | 2026-08-10 | 3 | 3/3/0/0/1 | 583 | 3d12a6fc42e3 |
| master-lever | 2026-07-27 | 3 | 3/3/3/3/1 | 1039 | e1430ce5a4fb |
| master-brian | — | 0 | — | 0 | — |

欄位完整度重點：`risk_notes` / `learning_points` 大面積為空（brcto 37 篇 risk=0、zhou 36 篇 risk=1），所以「四段固定版型」不可行，必須**缺段落就不渲染**。

---

## C. 安全稽核

- **logged-out 現況：拿不到任何原文。** `expert_signals` RLS 已啟用，policy 僅四類（本人 expert、company_admin、訂閱者 `status='published' AND has_active_subscription_after(...)`），`anon` 無 policy 亦無 table grant；`information_schema.table_privileges` 對 `expert_signals` 回傳空集合。目前 `/expert/:slug` 的 network 只有 `get_expert_detail_bundle`、`calculate_expert_performance`、`public_expert_state_active`（見本回合 network 快照），皆無原文欄位。
- **可重用的 public projection：沒有。** 現有 public view 只有 `experts_public`、`public_expert_state_active`、`expert_line_channels_public`；無任何週記投影。故**不得**讓 anon 直接讀 `expert_signals` / `trade_records`，也不得把 admin bundle 開給 anon。
- **PII 掃描**（正則：email/URL/line.me/09xxxxxxxx/+886）：master-zhou 2026-07-13 與 2026-07-06 兩週 **命中**；其餘週次 0。另 `strategy_name` 已知曾存 email（`publicSystemName` 已擋）。原文另含標的代號、`price_hint`、`quantity/quantity_unit`、`net_premium/max_loss/max_profit` 等部位資訊 → 屬敏感欄位。
- **三方案比較（不預設 SECURITY DEFINER）**

| 方案 | least-privilege | 缺點 | rollback |
|---|---|---|---|
| A. `security_invoker=on` view on `expert_signals` | anon 無 base grant → view 讀不到，等於要放寬 base RLS，**擴大攻擊面** | 一放寬就全表級風險 | 需改 RLS，回退風險高 |
| **B. curated snapshot table + RLS（建議）** | 只把「管理者核准的單一週次、已遮罩」內容複製進 `expert_public_samples`，anon 只 SELECT 該表 approved 列；base 表零改動 | 需 admin 流程與 hash 漂移偵測 | `drop policy` + `revoke` + `drop table`，base 表零影響 |
| C. 最小 SECURITY DEFINER RPC 讀 base 表 | 單一入口，但每次即時讀原表、遮罩邏輯在函數內、任何 bug 直接漏原文 | 稽核成本高、無法固定 snapshot | `revoke execute from anon` |

→ **採 B**。核心理由：對外只存在「已核准、已遮罩、已固化」的副本，anon 永遠碰不到 `expert_signals`。

---

## D. 產品契約

- 每位老師**最多 1 筆** admin 明確核准的歷史週次 snapshot。
- 卡片標示：老師名、歷史週次（`YYYY/MM/DD` 週起）、「已公開歷史範例」、「非即時建議、教學研究用途」。
- 只渲染老師原文中**實際存在**的段落（當週復盤 `overall_summary`／判斷依據 `reason_summary`+`reason_detail`／學習重點 `learning_points`／風險情境 `risk_notes`），**不 AI 改寫、不拼湊、缺段不渲染**。
- 長內容截斷 + 「查看範例」展開，不使用假 skeleton。
- 三種 fail-closed：未核准/無資料 → 「目前尚無公開範例」；載入錯誤 → 「資料暫時無法取得」；絕不以他人內容補位。
- **遮罩方案（法務由你裁決，我只提選項，不做法律結論）**
  - M0 原樣保留標的/價格/數量（歷史、已過公開時點）
  - M1 保留標的、隱藏價格與數量（顯示「已隱藏」）
  - M2 標的代號化（例：`台股 A 檔`）、價格數量全隱藏
  預設先實作 **M1**，欄位級開關存在 snapshot 上，可逐位老師調整。

---

## E. 執行計畫（待你逐條核准後才切 Build）

### E1. Schema（一支 migration）
`public.expert_public_samples`：`id`、`expert_id`、`week_start_taipei date`、`sections jsonb`（已遮罩、只含存在段落）、`source_signal_ids uuid[]`、`source_content_hash text`、`mask_level text`、`status text('draft'|'approved'|'revoked')`、`approved_by uuid`、`approved_at`、`revoked_at`、`created_at/updated_at`；unique `(expert_id) where status='approved'`。
GRANT：`SELECT ON ... TO anon, authenticated`；`ALL TO service_role`；`INSERT/UPDATE` 僅 company_admin policy。RLS：anon/authenticated 只看 `status='approved'`。

### E2. 讀取
`get_expert_public_sample(_slug text)` 不新增；直接由既有 `get_expert_detail_bundle` **不動**，前端另發一次 `from('expert_public_samples')` 查詢（RLS 保護，零 SECURITY DEFINER）。公開回應最小欄位：`week_start_taipei`、`sections`、`mask_level`、`updated_at`。

### E3. Admin 流程
`/admin/:expertSlug/signals` 新增「設為公開範例」：選週次 → 預覽遮罩後結果 → 明確勾選同意 → 寫入 snapshot（記 `approved_by/at` + `source_content_hash`）。撤回 = `status='revoked'`。原文事後被改 → 重算 hash 不符時前台**自動隱藏**並在後台標示「來源已變更，需重新核准」。

### E4. UI / a11y / analytics
`SampleStructureCard.tsx` 改為 `RealSampleCard`：mobile 單欄、段落標題 h3、展開用 Radix Collapsible（`aria-expanded`）、截斷 480 字。事件：`view_weekly_sample`（沿用）＋ `expand_weekly_sample`、`sample_unavailable{reason}`。

### E5. Tests
RLS：anon 只讀 approved、draft/revoked leak 0、cross-teacher leak 0；PII gate 單元測試（email/URL/phone/LINE 正則）；hash 漂移 → 前台隱藏；empty（master-brian）/error 兩態；`expert_signals`/`trade_records` network 請求 0；390/380/560/1280 無溢位；console/4xx/5xx = 0；full regression + tsgo + build。

### E6. 邊界
- changed-files allowlist：`supabase/migrations/<new>.sql`、`src/pages/_expert/SampleStructureCard.tsx`(改名)、`src/pages/ExpertProfile.tsx`、`src/hooks/useExpertPublicSample.ts`(new)、`src/pages/admin/Signals.tsx`、`src/lib/complianceCopy.ts`、tests、`docs/funnel/v2.1-receipt.md`。
- no-touch：`expert_signals` RLS/grants、`get_expert_detail_bundle`、`save_signal_batch`、`journalRepository`、cron、edge functions、`src/integrations/supabase/*`。
- rollback：`revoke` + `drop policy` + `drop table expert_public_samples` + revert 前端；base 資料零影響。
- receipt：`docs/funnel/expert-public-sample-receipt.md`，含 sanitized manifest、測試數、changed files hash。
- 全程 Preview，不 deploy、不 Publish。

### 待你裁決
1. 遮罩層級（M0 / M1 / M2，預設建議 M1）。
2. `benny` 是否納入（他是第 6 位 mentor，不在你列的 5 位內）。
3. master-lever 只有 1 週、master-brian 0 週 → 是否接受這兩位先顯示「目前尚無公開範例」。
