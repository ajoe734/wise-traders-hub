
# 訂閱有效期間時間軸

## 目標

在修煉派週記頁面加入視覺化時間軸，讓使用者一眼看清自己在每位老師的訂閱歷史（含空窗期與續訂），並與剛修好的 RLS 規則（續訂即解鎖歷史）對齊。

## 顯示範圍

- **`/app/journals`（列表頁）**：頁首下方新增一段，列出使用者曾/現訂閱的每位 mentor，各自一條時間軸（多老師直向堆疊）。
- **`/app/journal/:id`（詳情頁）**：老師 header 下方新增單一時間軸（只顯示當前老師），並用一個小標記標出「本篇週記發布時間」落在哪一段訂閱期內。

## 時間軸視覺（橫向條）

```text
2026/06/10                              2026/08/14
├──[■■■■ 已過期 ──]──[空窗4天]──[■■■ 進行中 ═══>]─
   6/10        7/10  7/10   7/14  7/14        8/14
   ░░ +7d 回溯                     ░░ +7d 回溯
                                          ▲ 本篇 7/16（詳情頁才顯示）
```

- 條的總跨度：`min(所有 started_at)` 到 `max(所有 expires_at, now())`，含 mentor 尾端 +7d 淺色延伸。
- 每段訂閱：實心色塊。
  - `status=active` 且未過期：主色（mentor 藍）+ 「進行中」標籤。
  - `status=expired` 或已過 `expires_at`：灰色 + 「已過期」標籤。
  - `canceled_at != null`：加對角線紋 + 「已取消」標籤（仍算涵蓋期）。
- 兩段之間如有空窗：灰色斷開 + 「空窗 N 天」小字。
- **mentor 7 天回溯**：每段起點左側 & 終點右側各畫一段條紋淺色延伸（虛線邊框），tooltip 顯示「導師週記可視期延伸 7 天」。分析師不畫延伸。
- 起訖日期以 `YYYY/MM/DD` 顯示（符合專案 Kore-eda 規範）。
- 詳情頁另加一支 ▲ 指標指向本篇 `published_at` 的位置。

## 資料來源

新 RPC `get_user_subscription_timeline(_user_id uuid, _expert_id uuid DEFAULT NULL)`（`SECURITY DEFINER`, `SET search_path=public`）：

- 讀 `member_subscriptions` join `expert_plans` join `experts`，回傳每位有訂閱紀錄的 mentor（`role='mentor'`）：
  - `expert_id, expert_name, expert_slug, expert_avatar_url`
  - `segments[]`: `{ id, plan_name, started_at, expires_at, status, canceled_at, is_currently_active }`
  - `has_active_now`: 目前是否對此 mentor 仍有 active 訂閱（決定 RLS 是否解鎖歷史）
- `_expert_id` 提供時只回傳該老師（詳情頁用）。
- 權限：`GRANT EXECUTE ... TO authenticated`；內部以 `_user_id = auth.uid()` 或 `has_role(auth.uid(),'company_admin')` 保護，防止跨查。

## 元件

新元件 `src/components/SubscriptionTimeline.tsx`：

- Props: `segments`, `expertName?`, `expertAvatarUrl?`, `highlightAt?: Date`（詳情頁用）、`showMentorLookback?: boolean`（預設 true）。
- 純展示、不查資料。
- 響應式：桌機一條完整橫向；手機（<640px）改為每段訂閱獨立一小條疊排（避免過細擠壓）。
- a11y：`role="img"` + `aria-label` 說明「訂閱 X：2026/06/10–2026/07/10 已過期；2026/07/14–2026/08/14 進行中」。

## 檔案異動

- 新增 `src/components/SubscriptionTimeline.tsx`。
- 新增 hook `src/hooks/useSubscriptionTimeline.ts`（React Query 包 RPC，`staleTime: 5min`）。
- 修改 `src/pages/app/Journals.tsx`：於 `weekGroups.length > 0` 分支的最上方，把 timeline 排在月份/asset 篩選之下、卡片列表之上。若使用者有多位 mentor，用 `Accordion` 或直接直向堆疊（每位 mentor 一條，附頭像+名字）。
- 修改 `src/pages/app/JournalDetail.tsx`：在 header（頭像+日期區塊）與 `weekTitle` 之間插入 timeline，傳入當前 `signal.expert_id` 與 `highlightAt={new Date(signal.published_at)}`。
- 新增 migration：`get_user_subscription_timeline` RPC。
- 新增測試：
  - `src/test/components/SubscriptionTimeline.test.tsx`：驗證 active/expired/canceled 分色、空窗顯示、mentor 7 天延伸、highlight 標記位置、a11y label。
  - drift-detection 補在 `src/test/integration/1.18-weekly-publish-rls.test.ts`（同檔案），驗證 Journals.tsx / JournalDetail.tsx 都掛上 SubscriptionTimeline。

## 邊界處理

- 沒有任何訂閱：不 render timeline（列表頁本來就會顯示「尚未訂閱」CTA）。
- 只有一段訂閱：仍畫一條，不顯示空窗。
- 詳情頁如果 `highlightAt` 落在所有訂閱期外（理論上不會發生，因為 RLS 已擋）：不顯示 ▲ 指標，避免視覺誤導。
- 未來時間（`expires_at > now()`）：進行中段的右端用漸層淡出，並用「至 8/14」文字標示到期日。
- 分析師（`role != 'mentor'`）：本次不畫時間軸（週記僅 mentor）；RPC 也只回傳 mentor。

## 不做的事

- 不加續訂 CTA 按鈕（另有 `RenewalBanner` 處理）。
- 不改 RLS 或訂閱資料模型。
- 不做管理員視角（view-as）額外處理；`useEffectiveUserId` 已覆蓋。
