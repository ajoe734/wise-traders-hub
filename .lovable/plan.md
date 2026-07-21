
## 現況（已查證 DB）

彥愷（`experts.slug=sharkgu`, id `13926bcc…`）在 4576 大銀微系統 的資料出現「張／股」單位混亂。

**expert_signals（週記端）**
| 時間 | action | qty | unit | 價格 | 狀態 |
|---|---|---|---|---|---|
| 07/17 09:05 | buy | 1 | 張 | 204 | published |
| 07/17 10:16 | add | 999 | 股 | 198 | published |
| 07/21 10:20 | trim | 1 | 張 | 188 | **pending（未發布）** |

**trade_records（持倉／系統端）**
| 建立時間 | qty | unit | entry | exit | 狀態 |
|---|---|---|---|---|---|
| 07/17 09:05 | **1000** | **張** | 198.01 | — | open |
| 07/17 20:00 | **999** | **張** | 198.01 | — | open |
| 07/21 10:20 | 1 | 張 | 198.01 | 188 | closed |

## 根因

trade_records 的前兩筆是從 expert_signals 展開時單位換算錯誤：
- signal「buy 1 張」→ 被寫成 `quantity=1000, unit=張`（正確應為 `1 張` 或 `1000 股`）
- signal「add 999 股」→ 被寫成 `quantity=999, unit=張`（應為 `999 股`）

結果持倉看板把兩筆都解讀成「張」，出現「2 張」；而週記端讀 signals 原欄位，仍顯示「賣 1 張」。使用者最後意圖：**只留 1 張（=1000 股）open 部位**，其他歸零。

## 目標終態

- 持倉：4576 大銀微系統 = **1 張（1000 股）open**，entry_price 198.01
- 已賣出：**0 張**（因為老師其實只想要留 1 張，之前的 trim 1 張是為了修正錯誤庫存，不是真的減碼）
- 週記端保留 buy 1 張 + add 999 股歷史；把 pending 的 trim 1 張撤銷（避免發布誤導訂閱者）

## 執行步驟

1. **trade_records 修正**
   - `DELETE` id `ea29173d…`（qty 1000 張）
   - `DELETE` id `483dea25…`（qty 999 張）
   - `DELETE` id `06272d35…`（closed 1 張）
   - `INSERT` 一筆乾淨的 open row：`quantity=1000, quantity_unit=股, entry_price=198.01, entry_date=2026-07-17, status=open, signal_id=73ea999e…（原始 buy signal）`

2. **expert_signals 處理**
   - `UPDATE` id `c872f4a9…`（pending trim 1 張）→ `status='withdrawn'`（或 taken_down），寫入 `taken_down_reason='老師修正持倉單位錯誤，此筆非真實減碼'`，避免這筆流入週記匯出

3. **驗證**
   - 重新查 trade_records / expert_signals 確認只剩上述目標狀態
   - 請老師刷新持倉看板，確認顯示「1 張 大銀微」
   - 確認 /company/journals-export 週記匯出不再出現「賣出 1 張」

## 需要老師確認的一件事

老師訊息說「我只要留 1 張」，但沒明說原本已發布的兩則 signal（buy 1 張 + add 999 股）要不要一併撤下重寫。**目前計畫：保留兩則已發布 signals（訂閱者已看過，且合起來語意就是「進 1 張」），只撤下未發布的 trim。** 若老師希望連歷史 signals 也清掉，請告知，我再加一步撤除+補發。
