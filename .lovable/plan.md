# 修復計畫：舊會員補償權益納入收盤分析配額

## 目標
讓「舊會員／補償會員」在上傳成功後，能依實際補償權益使用收盤分析；不能再被誤顯示成「LINE 註冊禮 1/1 已用完」。

## 會做的事
1. **補上正式的補償權益來源**
   - 新增一個專門承載健檢補償權益的資料來源，不再把補償會員硬塞進 `line_free` 或靠刪 `checkup_usage` 假裝恢復額度。
   - 這個來源會能明確表示：
     - 使用者是誰
     - 補償類型／原因
     - 額度數量
     - 期間（終身 / 指定到期日）
     - 是否啟用

2. **改寫 `check_checkup_quota` 的權益優先順序**
   - 先判斷 tester
   - 再判斷有效訂閱
   - 再判斷補償權益
   - 最後才退回 `line_free` 或 `none`
   - 這樣 `checkup-analyze` 在扣點時，才會吃到正確權益，不會繼續把補償會員當成只有 LINE 註冊禮 1 次。

3. **同步修正前端文案與狀態卡**
   - `FreeCheckupQuotaCard`、持倉看板上的 quota banner、收盤分析按鈕狀態，改成能顯示「補償額度／舊會員權益」而不是一律寫成 LINE 註冊禮。
   - 若有補償額度，CTA 必須是可分析，不得再顯示升級阻擋訊息。

4. **保留既有 reset / reconcile，但降級為例外補救工具**
   - admin reset / reconcile 仍保留，用來處理歷史異常扣點。
   - 但不再當成舊會員正常 entitlement 模型。

5. **補齊完整回歸測試**
   - SQL 合約測試：補償權益存在時，`check_checkup_quota` 應回正確 tier/limit/remaining。
   - Edge function 合約測試：`checkup-analyze` 對補償會員不得回 `QUOTA_EXCEEDED`。
   - 前端單元測試：quota 卡、收盤分析 gate、文案顯示不能再誤判成 `line_free 已用完`。
   - 掃描所有相關檔案，避免只修一處又漏另一處。

## 會改到的範圍
- Database migrations
  - `check_checkup_quota` 所在 migration 的新版本
  - 新的補償權益表 / function / GRANT / RLS
- Frontend
  - `src/pages/_appAccount/FreeCheckupQuotaCard.tsx`
  - `src/pages/FreeCheckup.jsx`
  - 可能涉及持倉看板內 quota banner 的元件
- Tests
  - `src/test/integration/checkup-quota-rpc-contract.test.ts`
  - 與 quota / analyze 相關的 integration / unit tests
  - 需要新增補償會員案例

## 技術細節
```text
權益判斷優先序
1. tester
2. active subscription
3. compensated entitlement
4. line_free gift
5. none
```

```text
目前錯誤點
舊會員補償 = 沒有正式資料模型
=> quota RPC 只能回 line_free / none
=> 前端顯示已用完
=> checkup-analyze 也真的擋掉
```

## 驗證清單
- 補償會員：可上傳、可跑收盤分析
- 補償會員：quota 卡顯示補償權益，不顯示 LINE 註冊禮已用完
- 純 `line_free` 已用完者：仍正確被擋
- basic / pro：仍維持原月 / 週配額
- tester：仍維持 22 次
- predict-events / parse / brain-update 不被這次修壞

## 預期結果
修完後，真正有回送／補償權益的舊會員，會被 quota 系統正確辨識並放行收盤分析；不會再出現你現在截圖這種「上傳成功，但還被當成 LINE 免費 1 次已用完」的錯誤。