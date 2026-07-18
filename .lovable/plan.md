## 根因

這**不是**後台不支援美股，而是資產類別切換後的快取沒串好，導致下游元件在 30 秒內仍讀到舊的 `tw_stock` 快照，看起來像「後台寫不了美股」。

流程實際發生的事：

1. `admin/Profile` 把資產類別切成美股 → `useAdminProfile.saveProfile` 對 `experts` 表 `UPDATE {asset_class:'us_stock'}`
2. DB 觸發器 `sync_expert_currency_with_asset_class` 自動把 `currency` 同步成 `USD`（DB 側已正確）
3. `saveProfile.onSuccess` 只 invalidate 了 `['admin','profile',slug]` 這一把 key
4. `SignalCreateDialog` 拿到的 `expert` 是從 `useAdminSignals` 的 `['admin-signals-bundle', slug]` 出來的（`staleTime: 30_000`），**沒被 invalidate**
5. `resolveAssetClass(expert)` 因此仍回 `tw_stock` → NT$ / 張 / 台股代碼驗證
6. `CapitalPanel` 走 `['expert-holdings-bundle', expertId]` 也同樣沒失效

硬重整頁面就會恢復正常，這也是為什麼「看起來後台不支援美股」的錯覺出現。

同時：一旦該分析師曾經發布過任何一筆訊號，DB 觸發器 `enforce_expert_asset_class_lock` 會直接 RAISE EXCEPTION 阻擋。這位分析師若已有歷史台股訊號，我會**在同一輪一併解鎖** asset_class 切換路徑（管理員專用），並在切換完後把過去發布的台股訊號在後台清單裡標為 legacy，避免混淆。

## 動作

### 1. 修「快取失效缺口」（真正解決 UI 卡在 NT$ 的 bug）

`src/hooks/admin/useAdminProfile.ts` — `saveProfile.onSuccess` 補上下游 bundle 的 invalidate：

```ts
queryClient.invalidateQueries({ queryKey: expertQueryKey });
queryClient.invalidateQueries({ queryKey: ['admin-signals-bundle', expertSlug] });
queryClient.invalidateQueries({ queryKey: ['admin', 'signal-editor', expertSlug] });
if (expert?.id) {
  queryClient.invalidateQueries({ queryKey: ['expert-holdings-bundle', expert.id] });
}
```

### 2. 給「這位老師想從台股整個切成美股」一條合法路徑

因為 DB 觸發器 `enforce_expert_asset_class_lock` 會擋，先問你要哪一種：

- **A. 提供管理員專用「重置為美股」按鈕**：在 `CurrencyCard` 於 `company_admin` 且 `locked=true` 時顯示「重置為美股」，走一個新的 edge function `admin-reset-expert-asset-class`：以 service_role 先把舊 `expert_signals` 標記 `status='archived'`（或搬到 legacy 表），再 `UPDATE experts.asset_class='us_stock'`，並清 `starting_capital` 讓老師重新設定美股本金。
- **B. 保留舊台股資料，另開一個純美股 expert 帳號**：不動觸發器，只在 `admin/experts` 給「複製老師檔案 → 新增美股版」的入口。

### 3. 加回歸測試

- `src/hooks/admin/__tests__/useAdminProfile.test.ts`：mock supabase，驗證 saveProfile 成功後 4 把 key 都被 invalidate。
- `e2e/admin-asset-class-switch.spec.ts`：模擬「Profile 切美股 → 進 Signals 頁 → 開 SignalCreateDialog」，斷言看到 `US$` 前綴、單位下拉只有「股」、代碼 placeholder 是 `例：AAPL / BRK.B`。

### 4. 文件

`.lovable/plan.md` 追加一段「asset_class 切換的快取失效清單」，明列 4 把 query key 與觸發器行為，避免下一次改 profile 又漏。

## 需要你決定

1. 走 **A（重置為美股）** 還是 **B（另開美股帳號）**？
2. 如果選 A，過去台股訊號要 **保留可查（archived）** 還是 **物理刪除**？

只要你回答，我就進 build mode 一次做完 1 → 4 步。