## 目標

把 Phase 1（5 分鐘 cron + Realtime + 上櫃/權證補位）的「**收尾洞**」一次補完，讓使用者體感與後端一致。

---

## 現況盤點（已完成）

- 5 分鐘 cron `stock-price-sync-5min`（`*/5 * * * 1-5`）已上線 ✅
- Edge function 09:00–13:33 交易時段守門（`force=1` 可繞過）✅
- `isWarrantLike` 權證偵測 + TPEx fallback ✅
- `current_prices` 已加入 `supabase_realtime` publication，RLS 開放 SELECT ✅
- FreeCheckup `current-prices-fc` Realtime channel 已訂閱 ✅
- 「立即更新」30 秒冷卻 + `force:true` 觸發 ✅

## 未補完的洞（本次要修的）

### 洞 1：UI 文案還是寫「30 分鐘執行一次」（自打臉）
`src/pages/FreeCheckup.jsx:5562` 提示文字仍是舊的，使用者看到會困惑。
→ 改為：「後端排程每 5 分鐘自動同步（盤中 09:00–13:30），新價格寫入後畫面會即時更新。」

### 洞 2：UI 沒顯示「資料時間」與「Realtime 已連線」狀態
目前 Realtime 推來時只 `setLastUpdate`，但 Hero/持倉看板沒有可視化的「最後更新 HH:mm:ss」與「即時連線中 ●」指示。使用者不知道畫面是否真的在自動更新。
→ 在持倉看板表頭加一個極簡 chip：`● 即時 · HH:mm:ss`（連線時綠點，斷線時灰點+「重連中」）。遵循 Kore-eda 風格、橘灰系。

### 洞 3：分析師訂閱頁沒吃 Realtime（仍靠頁面 polling）
`stock-price-sync` 已寫 `user_performances`，但 `user_performances` 雖在 `supabase_realtime` publication，前端 `src/hooks/usePerformance.ts` 只做 React Query 拉取。
→ 在 `usePerformance.ts` 訂閱 `user_performances`（filter `user_id=eq.{uid}`）變化，收到 UPDATE 就 `queryClient.invalidateQueries`。讓分析師頁也 5 分鐘自動跳數字。

### 洞 4：權證 PnL 未標註「現價差」近似
權證真實 PnL 應計算 Delta/時間價值，目前當一般股票算。先在 UI 標註：當 `isWarrantLike(code)` 時，持倉看板該檔 PnL 旁顯示淺色註記「權證｜現價差估算」，避免使用者誤判。後續 ticket 才做 Delta 修正。

### 洞 5：驗收沒實際跑過 + REPLICA IDENTITY 確認
要驗證：
- `current_prices` 是否設了 `REPLICA IDENTITY FULL`（payload.new 是否含完整欄位）
- 14:30 後 cron 是否真的吐 `outside_trading_hours` 並寫入 `system_jobs_log`
- 跑一筆 `?force=1` 確認 TPEx fallback 對冷門上櫃股有效

→ 跑 `supabase--read_query` 驗證 REPLICA IDENTITY；跑 `supabase--curl_edge_functions` 帶 `force=1` 觀察 log；不通過就補 migration。

### 洞 6（小）：`refreshPrices` 用 `body:{force:true}` 但 edge 同時讀 `?force=1` 與 body
程式碼已雙保險，但 `supabase.functions.invoke` 會用 POST 帶 body，OK；只是註解寫「走 query string」誤導。順手清掉註解。

---

## 變更清單

| # | 檔案 | 動作 |
|---|------|------|
| 1 | `src/pages/FreeCheckup.jsx:5562` | 提示文案改為 5 分鐘 + 09:00–13:30 |
| 2 | `src/pages/FreeCheckup.jsx`（持倉看板表頭） | 加 `● 即時 · HH:mm:ss` chip，用 `lastUpdate` + Realtime channel `subscribe` 狀態 |
| 3 | `src/pages/FreeCheckup.jsx`（持倉列） | 權證碼 `isWarrantLike` → PnL 旁加「權證｜現價差估算」灰字註記 |
| 4 | `src/hooks/usePerformance.ts` | 新增 `useEffect` 訂閱 `user_performances` 變化，收到就 invalidate |
| 5 | `src/pages/FreeCheckup.jsx:1949` | 移除誤導註解 |
| 6 | （驗證）migration | 若 `REPLICA IDENTITY` 不是 FULL，補一條：`ALTER TABLE public.current_prices REPLICA IDENTITY FULL;` |
| 7 | （驗證）curl test | `force=1` 打一次，確認 200 + log 寫入 |
| 8 | `mem://qa/checkup/freecheckup-mobile-regression-checklist` | 改完後跑 560/390/380 三斷點 + playwright（依 Core 規範） |

---

## 不在本次 scope（標記為下階段）

- 權證 Delta/時間價值真實 PnL 計算（需履約價/到期日資料源）
- 興櫃股票（TWSE MIS 不收錄）
- 將 cron 縮到 1 分鐘（先觀察 5 分鐘穩定度）
- 將 `inWindow` 改成 13:30 收盤 + 14:00–14:30 盤後零股雙窗（目前 13:33 已涵蓋盤中尾盤撮合）

---

## 驗收 checklist

- [ ] 持倉看板表頭可看到「● 即時 · HH:mm:ss」，盤中每 5 分鐘自動更新時間戳
- [ ] 加一檔權證（如 `030001`）入持倉，顯示「權證｜現價差估算」註記
- [ ] 加一檔上櫃股（如 `6488`）入持倉，盤中/盤後都能取到價（盤中 MIS、盤後 TPEx fallback）
- [ ] 分析師訂閱頁不需重整，5 分鐘內數字會自動跳
- [ ] 14:35 觀察 `system_jobs_log`：應只看到 cron skipped，沒打 TWSE
- [ ] 「立即更新」按鈕 30 秒內第二次點擊被擋
- [ ] 三層手機斷點 RWD 通過 + i18n 掃描通過

---

要我進 build mode 執行嗎？
