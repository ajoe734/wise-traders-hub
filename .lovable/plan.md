# 修正計畫

## 我已確認的問題
- 你貼的正式站 checkout 連結不是「登入後資料沒顯示」而已，實際上是頁面直接黑掉。
- 瀏覽器 production console 已出現 React `error #310`，官方對應是：`Rendered more hooks than during the previous render.`
- network 也證明資料其實有回來：`expert_plans`、`payment_providers_safe`、`experts` 都是 200。
- 因此目前 root cause 偏向 `Checkout.tsx` 的 hooks 呼叫順序錯誤，不是後端查不到資料。

## 具體 root cause
`src/pages/Checkout.tsx` 目前有這個結構：
- 前面先 `if (loading) return ...`
- 再 `if (!plan || !expert) return ...`
- 但後面才呼叫：
  - `useCrossProductDiscount(...)`
  - `useState(0)` for `upgradeCredit`
  - `useEffect(...)` for upgrade credit

這會造成：
- 第一次 render（loading=true）時，後面那批 hooks 沒被呼叫
- 下一次 render（loading=false）時，後面 hooks 又被呼叫
- hooks 數量前後不一致，正式環境就直接炸成黑頁

同檔對照：`CheckupCheckout.tsx` 已經有把 hooks 放在 early return 之前，還寫了註解 `Hooks must be called unconditionally`，所以這更能證明 `Checkout.tsx` 是漏改。

## 我會怎麼改
1. 調整 `src/pages/Checkout.tsx` 的 hooks 順序
   - 把 `useCrossProductDiscount`
   - `upgradeCredit / upgradeFromSubId` 的 `useState`
   - 對應的 `useEffect`
   全部移到任何 early return 之前，確保每次 render hooks 順序一致。

2. 保持功能不變
   - 不改 Hero
   - 不改首頁其他區塊
   - 不改 checkout 商業邏輯
   - 不改資料表／後端
   - 只修這次黑頁 root cause

3. 驗證範圍
   - 重新打開 `https://legendflow.tw/checkout/sharkgu/ab1d8e55-290b-43a8-8cbb-b94dcc937200`
   - 確認不再黑頁
   - 確認 plan / expert / provider 正常顯示
   - 再驗一次未登入 → 登入 → 回到 checkout 的流程沒有被這次修正影響

## 技術說明
這次不是資料問題，而是 React hooks 規則問題：

```text
錯誤模式：
render A -> 提前 return，只跑一部分 hooks
render B -> 不提前 return，多跑了其他 hooks
=> Rendered more hooks than during the previous render
```

正確模式：
```text
每一次 render
-> 先固定呼叫所有 hooks
-> 再決定 loading / empty / content 要 return 哪個 UI
```

## 預期結果
修完後，正式站這條 checkout 連結應該會正常顯示內容，不會再只剩黑畫面。