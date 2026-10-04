# 修正：開 tester 後看不到任何老師

## 根因（已查證）
- qw2811569@gmail.com 開了 tester 後，老師清單改走「tester 模式」。
- 該模式的過濾只留 `status = 'draft'` 的老師（原意是預覽草稿），把 active 老師全部濾掉。
- 目前資料庫老師狀態：active 5、pending 6、suspended 2、draft 0 → 結果 0 位。
- 後端權限沒擋：請求回 200，資料有拿到，是前端過濾掉的。

## 修正
1. `src/hooks/useExpert.ts` 的 `filterExpertRows`：tester 模式改為顯示 `active + draft`，suspended 仍排除（pending 不顯示，維持現狀）。
2. 同檔 `useExpert`（單一老師頁）若使用同一過濾，一併生效，tester 可正常進老師頁。
3. 更新 `src/test/integration/1.15-suspended-expert-visibility.test.ts`：tester 看得到 active 與 draft、看不到 suspended。

## 順帶修的既有錯誤（同一帳號網路紀錄可見）
- `src/hooks/useMemberSubscriptions.ts` 查訂閱時選了 `experts.line_oa_id / line_channel_name / qr_code_url`，這些欄位不在 experts 表，請求回 400「column line_oa_id does not exist」，訂閱清單因此壞掉。改為比照 `useAccountData.ts` 從 `expert_line_channels` 另查後合併。

## 驗證
- 跑上述測試與 tsgo。
- 登入該帳號 Preview 打開 /app/explore，確認列出 5 位 active 老師、訂閱請求不再 400。

不改資料庫、RLS、權限，不發布正式網站。
