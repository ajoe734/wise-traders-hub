## 問題
`src/components/account/RenewalBanner.tsx` 目前把「立即續訂」連到：

```
/${expert.slug}/checkout?plan=${plan_id}&cycle=${cycle}&utm_...
```

但 `src/App.tsx` 只註冊了這些 checkout 路由：
- `/checkout/:slug/:planId`（訪客／未訂閱者結帳）
- `/checkout/checkup/:planId`
- `/app/checkout/:slug/:planId`（已訂閱者在戰情室內續訂）

因此 `legendflow.tw/sharkgu/checkout?plan=...` 匹配不到任何路由 → 404。

## 修正方式
改用正確的 App checkout 路徑（使用者已登入且在 `/app/account`，走 `/app/checkout/:slug/:planId`），把 `cycle` 與 UTM 保留為 query string：

```
/app/checkout/${expert.slug}/${plan_id}?cycle=${cycle}&utm_source=account_banner&utm_campaign=renewal
```

備援：若 `expert?.slug` 缺值，導回 `/app/account` 而不是 `/account`（後者也不存在／不是主要帳號路徑）。

## 驗證
1. 在 `/app/account` 檢視續訂 banner，按「立即續訂」→ 應進入 `/app/checkout/sharkgu/<planId>?cycle=monthly&...` 並顯示 checkout 頁，不再 404。
2. 過期 24h 內的紅色 banner 同樣走這條連結。
3. 新增／或延伸 `e2e/subscription-cancel-renew.spec.ts`（該檔已 mock 續訂情境）加一條斷言：`getByRole('link', { name: /立即續訂/ }).getAttribute('href')` 以 `/app/checkout/` 開頭，避免以後又回退到壞路徑。

## 檔案異動
- 編輯 `src/components/account/RenewalBanner.tsx`：修正 `url` 組法與 fallback。
- 編輯 `e2e/subscription-cancel-renew.spec.ts`：新增 href 前綴斷言（可選但建議，防止回歸）。
