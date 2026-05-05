
# 持倉一鍵帶入「減碼／出場／停損」+ 週記寫作格式盤點

## 一、現況問題

`SignalEditor.tsx` 第 570–586 行的「帶入」按鈕硬寫死 `action: 'trim'`，只能加一檔減碼草稿，不能出場、不能停損；要寫週記時還得手動改 action、再手動填股數，反而麻煩。

## 二、要做什麼

### 2.1 持倉表「帶入」改成三選一動作選單

每一列持倉的最右欄，從單一「帶入」按鈕 → 改成 **DropdownMenu**：

| 選項 | action | 預填內容 |
|---|---|---|
| 減碼 | `trim` | 股票代碼/名稱、現價；股數留空 |
| 出場 | `sell` | 股票代碼/名稱、現價、**全部股數**（quantity_shares）、單位=股 |
| 停損 | `exit` | 股票代碼/名稱、現價、**全部股數**、單位=股，並在「為什麼這樣操作」欄預填 `<p>停損出場</p>` 的占位 |

落地規則（同現況）：若最後一筆 trade draft 是空白的就覆寫，否則 `addTrade()` 後再寫入。

DropdownMenu 用既有 `@/components/ui/dropdown-menu`（shadcn）。

### 2.2 週記寫作格式重新盤點

目前 SignalEditor 對 mentor 的欄位順序有點散。盤點後固定為：

```text
[資金狀況卡] ← 不動
   ├─ 起始/已實現/未平倉/可用現金
   ├─ 送出後預估可用現金
   ├─ 目前持倉表（含「減碼／出場／停損」一鍵帶入）
   └─ 最近交易紀錄（折疊）

[週記頭部卡] (mentor only)
   ├─ 教學主題
   └─ 整體摘要（Rich text + AI）

[操作卡 #N] (重複)
   ├─ 操作時間 / 股票代碼 / 名稱
   ├─ 操作方向 / 數量(+最大可買) / 參考價位
   ├─ 套用模板（chips）
   ├─ 為什麼這樣操作？（reason_summary）
   ├─ 進場/出場思路詳述（reason_detail）
   └─ 風險與停損規則（risk_notes）

[週記尾部卡] (mentor only) ← 新增/補位
   └─ 本週學習重點（learning_points，原本欄位已存在但散落於底部）
```

確認 `learning_points` 已寫到 `expert_signals.learning_points`（line 418、849），不需改 DB；只是把區塊標題加個「本週學習重點」明確化、置於所有操作卡之後。

### 2.3 不做的部分

- 不動 `expert_signals` schema、不動 `simulateCashAfterTrades`、不動 RPC。
- 不動 advisor（非 mentor）的欄位順序，他不需要週記頭/尾。

## 三、檔案

修改：
- `src/pages/admin/SignalEditor.tsx`
  - 第 570–586 行：替換為 DropdownMenu，三個動作對應三段帶入邏輯（抽出 `applyPositionToDraft(p, action)` 共用函式）。
  - 在「本週學習重點」區塊外加 Card 標題分組（如已是獨立卡，僅補上下文標題）。

驗證：
- 打開 `/admin/sharkgu/signals/new`：
  1. 持倉「達發 6526」按 `▾` → 三選項出現。
  2. 點「出場」→ 自動新增/覆寫一張 trade card：action=賣出、數量=500（股）、價位=623。
  3. 點「停損」→ 同上但 action=平損、reason 預填占位。
  4. 點「減碼」→ 只帶代碼、價位、action=減碼，數量留空。
- mentor 模式下「整體摘要 → 操作卡 → 本週學習重點」三段落順序正確。
