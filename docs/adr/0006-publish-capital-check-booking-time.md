# ADR-0006：資金檢核發生在「建帳時」，發布只做狀態轉換

## 背景
`handle_signal_trade` 在 signal 以 `pending` 寫入時就建立 `trade_records`（現金當下就被扣）。
但 `enforce_signal_capital_limit` 只在 `status -> published` 才檢核，且用
`get_expert_capital_status().available_cash`（已扣掉自己那筆）再扣一次 → **雙重計算**，
造成導師明明寫完週記，週五批次發布時整批噴 `CAPITAL_EXCEEDED`，只有部分列上架。
實例：brcto 707414（需 24,500 / 可用顯示 10,886）、老周 INTC/META/VRT。

## 決策
1. 資金與單位檢核在**建帳當下**執行：`status IN ('pending','published')` 的 INSERT。
2. `UPDATE` 且 `OLD.status IN ('pending','published')` 時**直接放行**（現金已於草稿時計入）。
3. 防禦性補償：若該 signal 已有自己的 open `trade_records`，把自身成本加回 available。

## 後果
- 導師在編輯器送出當下就會被擋（訊息與 client 模擬一致），不會拖到發布日才失敗。
- 發布批次不再因資金檢核而部分成功。
- 失敗通知連結修正：`listExpertsByIds` 補回 `slug`，否則 link 退回 `/account/notifications`。
