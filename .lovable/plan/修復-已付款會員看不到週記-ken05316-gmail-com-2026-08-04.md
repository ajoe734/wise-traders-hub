# 修復：已付款會員看不到週記（ken05316@gmail.com）

## 查證到的事實（皆已用資料庫實查確認）

- 帳號 `ken05316@gmail.com` = `373045aa…`，與畫面「登入身分」一致，沒有帳號錯置問題。
- `member_subscriptions` 有一筆 **active**：彥愷「修煉派」，2026/08/03 16:00 → 2026/09/02（台北），另有一筆 7/3–8/2 已 expired。
- RPC `has_active_subscription` 的 SQL 條件（status=active 且未過期）對這筆資料**會回傳一列**，不是後端判定錯誤。
- 週記可見性 RLS（`has_active_subscription_after`）在「目前仍 active」時會解鎖歷史區段，7/29 那批 published 週記對他是可見的。
- 彥愷目前 `expert_signals`：**published 71 筆（最新 7/29）、pending 4 筆（8/4 建立、尚未發佈）**。

## 根因

1. **前台快取沒有重驗（主因）**
   `src/pages/app/Journals.tsx` 的 `app-journals` query 設定 `refetchOnMount: false`、`gcTime: 24h`，且此 key 在 `PERSISTED_QUERY_PREFIXES` 內被寫進 localStorage。付款前那次「無訂閱」結果被永久化，之後開頁**不會重新查詢**，於是持續顯示「您尚未訂閱任何實戰導師／有效訂閱數：0」。
   同一頁的訂閱時間軸（`useSubscriptionTimeline`）沒有關掉 refetchOnMount，所以顯示「進行中」——這正是同一畫面互相矛盾的原因。
   同樣寫法也存在於 `src/pages/app/Signals.tsx`（訂閱門檻的即時訊號列表）。

2. **本週週記仍是 pending**
   即使快取修好，他這週也只會看到 7/29 以前的內容，因為彥愷 8/4 的 4 筆仍未發佈（自動發佈排程週五才跑）。

## 要做的修改

1. `src/pages/app/Journals.tsx`：`refetchOnMount: false` → `'always'`（保留 `placeholderData` 避免畫面閃爍）。
2. `src/pages/app/Signals.tsx`：同上，避免同一個「付款後仍看到舊狀態」的類別性錯誤。
3. `src/pages/app/_journalDetail/useJournalDetail.ts` 與 `src/pages/app/SignalDetail.tsx`：內容本體可續用快取，但改為在**訂閱門檻判斷**的分支不吃持久化結果（以 `refetchOnMount: 'always'` 對齊，避免詳情頁誤擋）。
4. 登出／切換帳號時清除 `lf-app-cache-v1`，避免跨帳號殘留（檢查 `AuthContext` 是否已處理，未處理則補上）。
5. 針對彥愷 8/4 的 4 筆 pending：確認批次狀態並依既有發佈視窗規則處理（不繞過 `publishingWindow` 規則）。

## 驗收

- 以該會員身分（View-as）開 `/app/journals`：診斷面板應顯示「有效訂閱數：1」、彥愷 role=mentor/status=active、已納入查詢，並列出 7 月週記卡片。
- 手動在 localStorage 塞入舊的「無訂閱」快取後重新整理，畫面必須自動更新為有訂閱。
- `/app/signals` 同樣驗一次。
- 跑 `bunx vitest run src/test/integration/1.12-role-subscription-db-functions.test.ts src/test/integration/1.18-weekly-publish-rls.test.ts`。
