# 估值站牌「是否只對特定個股有效」全面稽核

## 已先查到的
- 估值計算程式（站牌、PE／PB／PS 分頁、已反映程度、財報服務）裡沒有寫死任何股票代碼；唯一的名單是「未登入可看的 5 檔範例股」，屬刻意設計。
- 但不寫死代碼，不代表每檔都算得出來。有幾處要看資料覆蓋才知道，例如同業名單只涵蓋部分股票、同業每日營收比只算名單內約 377 檔、產業代碼對照、上櫃與興櫃、ETF、權證、KY 股、剛上市未滿一年的股票。

## 要做的
1. **程式碼窮舉掃描**：搜尋估值相關所有前端、共用計算、後端服務，找出寫死的代碼、產業名稱字串比對、只對某些產業成立的特例、固定日期與固定數字，逐條列出並判斷是否合理。
2. **全市場實跑**：對上市櫃全部普通股（約 1,900 檔）逐檔跑同一套站牌計算，記錄每檔結果：哪把主尺、三站價格、四個分頁有沒有區間、已反映分級，或「無法判斷」與原因。
   - 財報資料有額度限制，分批跑、可中斷續跑；額度用完就停在那裡並回報進度，不拿假資料補。
3. **異常歸類**：把結果依原因分組統計（虧損、股數變動、資料不滿一年、無每日營收比、無同業、產業代碼缺、程式錯誤），特別標出「程式錯誤／非預期例外」與「站牌價離譜（例如高壓站超過現價 5 倍或低於 1/5）」的股票。
4. **修正**：程式錯誤當場修；屬規則面的問題（例如非名單股票的營收比尺沒資料）列出影響檔數與建議，給你決定後再改。
5. **加通用測試**：用隨機產生的各種情境（虧損、缺資料、極端倍數、上櫃、ETF、權證代碼）跑計算，確認不會出錯、不會畫出假區間；再把全市場實跑做成可重複執行的稽核腳本。
6. 產出全市場結果表放到檔案區，給你核對。

## 範圍外
- 不改估值規則本身（除非你看完報告同意）。
- 只改預覽，不發布。

## 技術細節
- 掃描範圍：`src/checkup/lib/valuation*`、`forwardValuation.ts`、`HoldingsDetailPanel.tsx`、`usePricedInList.ts`、`useValuationSnapshot.ts`、`useStationExtras.ts`、`supabase/functions/_shared/{fundamentalsBasis,monthRevenue,peerPsCore,forwardEpsCore}.ts`、`valuation-fundamentals`、`valuation-ps-sync`、`valuation-sync`、RPC `valuation_snapshot`／`valuation_peer_multiples`。
- 實跑：以 `stock_names` 取普通股清單，登入 session 直調 `valuation-fundamentals`＋`valuation_snapshot`，餵進同一個 `buildDrawerStations`／`selectedRulerBand`；結果寫 `/mnt/documents/估值全市場稽核.csv`，進度檔可續跑。
- 通用測試用 fast-check 式隨機輸入（自寫產生器，不新增套件）。
