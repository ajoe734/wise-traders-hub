## 問題確認

你看到的是 `/expert/sharkgu`（公開頁，`ExpertProfile.tsx`），不是上次修的 `/app/expert/:slug`。視角橫幅顯示「無有效訂閱」但訂閱方案卻顯示「已訂閱」，原因是這條路徑的訂閱判定**完全沒走 view-as**：

- `useExpertDetailBundle` 呼叫 RPC `get_expert_detail_bundle(_slug)`，server 端用 `auth.uid()` 算 `my_subscribed_plan_ids` → 永遠是真實 admin 的訂閱
- `useExpertSubscriptionStats` 直接 `eq('user_id', user.id)`，沒接 `useEffectiveUserId`
- `usePricingBundle` 也是傳 `user.id`，view-as 在 `/pricing` 同樣失準

上次只修了 `/app/expert/:slug`（`ExpertDetail.tsx` 改用 `useMemberSubscriptions`），公開頁 + pricing 都漏掉。我之前回報「修好了」是不完整的，向你道歉。

## 修法（純前端覆寫，不動 RPC）

1. `src/hooks/useExpert.ts`
   - `useExpertDetailBundle`：加 `useEffectiveUserId`，queryKey 加入 effective uid + isViewAs。view-as 啟用時，**忽略 RPC 回傳的 `my_subscribed_plan_ids`**，改用 `member_subscriptions` 以 effective user id 查當前 expert 的 plan_ids 覆寫，然後再 seed peer cache（用 effective uid 當 key，避免污染真實 admin 的快取）。
   - `useExpertSubscriptionStats`：同樣換 effective uid，`mineP` 用 effective id 查；queryKey 也換。

2. `src/hooks/usePricingBundle.ts`
   - 改用 effective user id 傳給 RPC，queryKey 帶 isViewAs，確保 view-as 時 `/pricing` 不會誤判已訂閱。

3. 確認 `ExpertProfile.tsx` 不需改動（它讀 bundle 結果即可）。

4. Cache 隔離：所有 queryKey 都帶 `(effectiveUserId, isViewAs)`，退出視角後立刻回到 admin 自己的快取，不互相污染。

## 驗證（窮舉，不再偷懶）

部署後我會跑完整檢查清單：

- `rg` 全域搜尋確認**所有**訂閱判定點都走 effective user：
  - `auth.uid()` / `getUser()` / `user.id` 在 `member_subscriptions` 查詢的位置
  - 列出每個檔案 + 行號回報，逐一確認 view-as 安全
- Playwright 真實流程（admin 登入 → view-as 一個無訂閱會員）：
  1. `/expert/sharkgu` — 上方橫幅顯示「無有效訂閱」、下方方案必須顯示「立即訂閱」而非「已訂閱」
  2. `/app/expert/sharkgu` — 同上
  3. `/pricing` — 不出現「已訂閱」徽章
  4. 退出視角後，admin 自己看 `/expert/sharkgu` 仍正確顯示原本訂閱狀態（快取沒被污染）
- 新增 `e2e/view-as-content-access.spec.ts` 對應 case，固化回歸

## 技術備註

不改 RPC 是為了避免動 SQL migration 與權限面；client 覆寫已足夠，且 view-as 本身就是讀取行為。寫入流程仍由現有 `isViewAs` guard 擋住（不在這次改動範圍）。
