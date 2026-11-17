# Plaid × Firstrade → 週記草稿 驗收報告（2026/11/17 台北）

環境：Plaid **Sandbox**；Production 關閉、正式站未發布。
測試資料：本輪專用「Plaid Sandbox 測試老師」（slug `plaid-sandbox-qa`，美股、停用、不對外顯示），擁有者與「他人」皆為本輪暫時測試帳號（回合結束自動移除）。未觸碰任何真實老師、會員、週記或文章。
本輪連線：`fb37c079-fe3b-4b65-adef-9e333dde2893`（已撤銷、purged）；機構 Firstrade `ins_120188`。

## 一、實際 Sandbox 測試（live Plaid API + 預覽畫面）：29/29 通過

| # | 項目 | 結果 | 證據 |
|---|---|---|---|
| 1 | [Sandbox] 測試老師本人連線 Firstrade ins_120188 取得非空持倉 | 通過 | HTTP 200 holdings=10 inst=ins_120188 |
| 2 | [Sandbox] 持倉全部為私有草稿 draft | 通過 | ACHN/equity:1, DBLTX/mutual fund:2, NFLX180201C00355000/derivative:10000, EWZ/etf:5, (無代號)/mutual fund:21.5, MIPTX/mutual fund:23.567, (無代號)/fixed income:10, NHX105509/etf:100.05, CAMYX/mutual fund:75.75, SBSI/equity:213 |
| 3 | [Sandbox] 老師本人可讀自己的草稿 | 通過 | rows=10 |
| 4 | [Sandbox+UI] 未確認時週記編輯器不提供帶入 | 通過 | Firstrade 已確認持倉 /  / 只帶入代號、名稱與和帳本的數量差；操作方向、價格、理由仍需您填寫。持倉快照不會自動變成交易紀錄。 /  / 查看（0） / 帶入週記（0） /  / 尚無已確認持倉，請先到 券商持倉 確認草稿。 |
| 5 | [Sandbox] 老師確認草稿 | 通過 | {'confirmed': 10} |
| 6 | [Sandbox+UI] 確認後列出分類（可帶入/不支援） | 通過 | 帶入週記（3） 分類={'new': 3, 'diff': 0, 'match': 0, 'ledger_only': 0, 'in_editor': 0, 'unsupported': 7} |
| 7 | [Sandbox+UI] 一鍵帶入，不需手抄代號與數量 | 通過 | 編輯器代號=['ACHN', 'EWZ', 'SBSI'] |
| 8 | [Sandbox+UI] 重複帶入被擋（按鈕歸零） | 通過 | 帶入週記（0） |
| 9 | [Sandbox+UI] 重新整理後暫存保留、仍不可重複帶入 | 通過 | 帶入週記（0） 代號=['ACHN', 'EWZ', 'SBSI'] |
| 10 | [Sandbox+UI] 未選操作方向不能儲存/發布 | 通過 | 提示=['第 1 檔：請選操作方向'] expert_signals=0 trade_records=0 |
| 11 | [Sandbox] 他人帳號 status 被拒 | 通過 | HTTP 403 FORBIDDEN_ADMIN |
| 12 | [Sandbox] 他人帳號 sync 被拒 | 通過 | HTTP 403 FORBIDDEN_ADMIN |
| 13 | [Sandbox] 他人帳號 confirm_drafts 被拒 | 通過 | HTTP 403 FORBIDDEN_ADMIN |
| 14 | [Sandbox] 他人帳號 disconnect 被拒 | 通過 | HTTP 403 FORBIDDEN_ADMIN |
| 15 | [Sandbox] 他人帳號 create_link_token 被拒 | 通過 | HTTP 403 FORBIDDEN_ADMIN |
| 16 | [Sandbox] 他人帳號 sandbox_connect 被拒 | 通過 | HTTP 403 FORBIDDEN_ADMIN |
| 17 | [Sandbox] 他人帳號直接讀 plaid_connections 無資料 | 通過 | HTTP 200 0 |
| 18 | [Sandbox] 他人帳號直接讀 plaid_holding_drafts 無資料 | 通過 | HTTP 200 0 |
| 19 | [Sandbox] 他人帳號直接讀 plaid_sync_runs 無資料 | 通過 | HTTP 200 0 |
| 20 | [Sandbox] 他人帳號直接讀 plaid_access_tokens 無資料 | 通過 | HTTP 403 42501 |
| 21 | [Sandbox+UI] 他人開啟測試老師週記編輯器看不到持倉 | 通過 | http://localhost:8080/admin/plaid-sandbox-qa/signals/new |
| 22 | [Sandbox] 同步進行中解除→撤銷成功、同步被擋 | 通過 | {'sync': (200, {'status': 'blocked'}), 'disc': (200, {'results': [{'status': 'purged', 'late': False}]})} |
| 23 | [Sandbox] 解除後 token/草稿(含已確認) 清為 0 | 通過 | purged blocked=true |
| 24 | [Sandbox] 解除後 sync 拒絕 | 通過 | HTTP 404 {'error': 'not_connected'} |
| 25 | [Sandbox] 解除後 confirm_drafts 拒絕 | 通過 | HTTP 404 {'error': 'not_connected'} |
| 26 | [Sandbox+UI] 解除後編輯器不再提供券商持倉 | 通過 | panel hidden |
| 27 | [Sandbox] 排程重試清除還原復活的 token | 通過 | HTTP 200 reapplied=1 |
| 28 | [Sandbox] 非排程呼叫重試被拒（無對外故障注入/繞權入口） | 通過 | HTTP 403 |
| 29 | [Sandbox] 解除後重放延遲寫入被資料庫鎖擋下 | 通過 | 以資料庫擁有者身分對已 purged 連線呼叫寫入 → ERROR P0001 plaid_sync_blocked；草稿仍 0 |

截圖（同目錄）：`1_unconfirmed.png` 未確認不可帶入、`3_imported.png` 帶入後、`4_save_blocked.png` 未選方向被擋、`5_other_user.png` 他人看不到、`6_after_disconnect.png` 解除後。

前一輪同日另測：非 Firstrade 機構（`ins_109508`）連線被拒 422 並立即撤銷。

## 二、模擬測試（可控 mock，非 live；無對外故障注入端點）

`supabase/functions/_shared/plaidCore_test.ts`（Deno，12/12 通過），測試的是正式程式實際呼叫的 `attemptRevokeWith` / `runSyncWith`：
- 撤銷失敗 → token 保留、次數+1；下次重試成功才刪 token 與草稿。
- 期限前 2 小時與逾期失敗 → `near_deadline`、`overdue` 告警；逾期後成功標 `late`，不算準時。
- 24 小時期限從第一次解除起算，重試不延長。
- 同步開始前已解除 → 不抓券商、不寫入、不發失敗通知。
- 抓完持倉、寫入前已解除 → 鎖定寫入拒絕，狀態 `blocked`、無寫入、無失敗通知。
- 只接受 `ins_120188`。

`src/lib/plaid/__tests__/journalImport.test.ts`（Vitest，6/6 通過）：
- 未確認草稿永不提供帶入。
- 對既有帳本分類：帳本無（new）、數量不同（diff，只帶差額）、一致（match，不帶）、帳本有券商無（ledger_only，只提示，不編造出場）。
- 選擇權、共同基金、無代號、非美股帳本一律不支援。
- 帶入只填代號、名稱、數量差；操作方向、價格、理由留空。
- 重複帶入冪等；老師已手打的同代號不重複；同代號多筆合併。

## 三、規則摘要

- 持倉快照不是交易：不寫 trade_records、不產生進出場，只預填既有週記編輯器的列；老師必須選操作方向，原有驗證才會放行，並經原週記流程儲存／發布。
- 現有持倉仍以 `useExpertHoldingsBundle` 帳本為準；Live 測試中測試老師帳本為空，故「數量不同」情境只在模擬測試覆蓋。
- 解除連結會刪除全部草稿（含已確認），編輯器隨即不再提供帶入。

## 四、變更檔案（本輪）

- `src/lib/plaid/journalImport.ts`（新增）
- `src/lib/plaid/__tests__/journalImport.test.ts`（新增）
- `src/pages/_signalEditor/BrokerageImportPanel.tsx`（新增）
- `src/pages/_signalEditor/types.ts`（`brokerageSourceKey` 去重欄位）
- `src/pages/admin/SignalEditor.tsx`（掛上帶入區塊）
- `supabase/functions/_shared/plaidCore.ts`（`runSyncWith`、`attemptRevokeWith`、Firstrade 白名單）
- `supabase/functions/_shared/plaidCore_test.ts`
- `supabase/functions/plaid-link/index.ts`（已部署）
- `AGENTS.md`
- `docs/qa/plaid-2026-11-17/`（本報告與截圖）

## 五、尚待正式核准／正式上線前待辦

1. Plaid Production 審核與正式金鑰；切換 `PLAID_ENV=production` 前不得連真實帳戶。
2. 真實 `/item/remove` 失敗只有模擬測試；正式後需觀察告警。
3. Plaid webhook 未建；延遲寫入以重放與並行解除驗證。
4. 真實老師間互測（本輪用暫時帳號）。
5. access token 無應用層加密（僅後端權限隔離＋平台靜態加密）。
6. 一般會員帳號刪除 30 天內清除個資：未實作（本輪不擴大）。
7. 備份副本保留與刪除期限稽核：未核實（本輪不擴大）。
8. 正式站未發布。
