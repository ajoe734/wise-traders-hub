## 問題根因

`src/components/ExpertCard.tsx` 第 16 行：

```ts
const isFeatured = person.name.includes('趙彭博');  // ❌ 鵬 vs 彭
```

實際資料庫與畫面顯示的是 **趙鵬博**（鵬），所以 `isFeatured` 永遠是 `false` —— 之前你以為已加上的「🔥 熱門推薦」金色徽章 + 金色 ring 從來沒在這位分析師卡片上出現過。截圖裡兩張卡視覺權重完全相同，就是這個原因。

另外 `src/pages/company/Analysts.tsx` 第 388、498 行的 placeholder 也用了同樣的錯字「趙彭博」，會誤導後台運營人員打錯名字，未來新增分析師會踩同一顆雷。

## 修復內容

1. **`src/components/ExpertCard.tsx`**
   - 把 `'趙彭博'` 改成 `'趙鵬博'`。
   - 順便讓 featured 判斷不要硬綁姓名 → 改用更穩的條件：優先檢查 `person.isFeatured` 欄位（若型別有），fallback 才用姓名比對 `'趙鵬博'`。避免下次改名又斷掉。

2. **`src/pages/company/Analysts.tsx`**
   - 兩處 placeholder「趙彭博」→「趙鵬博」。

3. **驗證**
   - 重新開 `/experts` 頁面，確認趙鵬博卡片右上角出現琥珀色「熱門推薦」徽章 + 整張卡有 `ring-2 ring-amber-500/50` 金邊。
   - 林修齊那張不應有徽章。

## 沒動到什麼

- 角色品牌色（advisor 紅 / mentor 藍）不動，符合 mem 裡的 expert-role-branding 規則。
- 上次猜的「CTA 按鈕顏色錯」是錯方向 —— advisor 用紅色 CTA 是 token 設計，不是 bug。
