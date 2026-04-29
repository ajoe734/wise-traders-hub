## 結論

你的判斷是對的。匯款帳戶就是收款設定的一環，不該獨立一頁。目前「金流設定」頁的真正問題不是「東西太多」，而是：

1. **健檢分潤卡是空殼**（純說明文字，不能改）
2. **命名「金流設定」容易誤解**為金流商串接設定
3. **頁面缺乏分區層次**，四個 Card 平鋪沒有視覺分組

只要解決這三點，匯款帳戶留在這頁是合理的。不需要再拆頁。

## 改動範圍

只動 `src/pages/company/PaymentSettings.tsx` 和 `src/components/layouts/CompanyLayout.tsx`，其他不動。

### 1. 重新命名與分組

頁名從「金流設定」改為「**收款設定**」（更精確：這頁就是設定平台怎麼收錢、怎麼分錢）。側邊欄項目同步改名。

頁面分成兩個明確的區塊（用大標題分隔，不是只用 Card）：

```text
收款設定
├─ 一、分潤規則
│   └─ 標準分潤預設（平台 % / 專家 %）
│       附註：個別方案覆寫請至「方案管理」；健檢由平台 100%
│
└─ 二、結帳頁公開資訊
    ├─ 匯款帳戶（銀行、代碼、帳號、戶名）
    └─ 跨產品折扣（NT$ 金額，4 個欄位）
```

### 2. 刪除空殼「健檢分潤」Card

那張 Card 沒有任何可操作項，純佔版面。改成把「健檢由平台 100%」這句話**併入標準分潤卡的附註文字**，省一個區塊。

### 3. 側邊欄調整

`CompanyLayout.tsx` 目前長這樣：

```text
金流管理       /company/payments
匯款審核       /company/remittance
金流設定       /company/payment-settings
```

三個都叫「金流」太混。改成：

```text
金流管理       /company/payments          （金流商交易紀錄）
匯款審核       /company/remittance        （人工匯款訂單審核）
收款設定       /company/payment-settings  （分潤、折扣、匯款帳戶）
```

「金流管理」和「匯款審核」的命名其實也可以更好，但那是另一個議題，這次不動。

### 4. 不做的事

- 不拆頁、不新增 route
- 不動資料庫（`payment_settings` 表結構不變）
- 不動 `Remittance.tsx`（匯款訂單審核頁，跟這次無關）
- 不動 `Plans.tsx`（方案管理仍然管個別方案的分潤覆寫）
- 跨產品折扣**不**獨立成優惠券系統（你沒說要擴充，先留在這頁）

## 技術細節

**檔案異動：**

- `src/pages/company/PaymentSettings.tsx`
  - 標題改「收款設定」
  - 加兩個 section header（`<h2>` 級的「分潤規則」、「結帳頁公開資訊」）
  - 刪掉「健檢分潤」整張 Card
  - 把「健檢由平台 100%」的說明併到「標準分潤預設」卡的副標
  - Card 順序調整：標準分潤 → 匯款帳戶 → 跨產品折扣
  - 既有的 `saveStandard` / `saveRemit` / `saveCross` 邏輯完全不動

- `src/components/layouts/CompanyLayout.tsx`
  - `navItems` 中 `/company/payment-settings` 的 label 改為「收款設定」

**不影響：**
- `payment_settings` 資料表的 keys（`split_standard`、`remittance_account`、`cross_discounts`）
- `revenueSplit.ts`、`paymentProcessor.ts` 等下游邏輯
- 任何測試（沒有測試是針對這頁標題或健檢卡的）

## 驗收

1. `/company/payment-settings` 頁面打開，標題顯示「收款設定」
2. 頁面有兩個 section：「分潤規則」（含標準分潤）、「結帳頁公開資訊」（含匯款帳戶、跨產品折扣）
3. 不再看到空殼的「健檢分潤」Card
4. 標準分潤卡的附註提到「健檢商品由平台獨享 100%」
5. 側邊欄「金流設定」改名為「收款設定」
6. 三個儲存按鈕（標準分潤、匯款帳戶、跨產品折扣）都還能正常存檔
