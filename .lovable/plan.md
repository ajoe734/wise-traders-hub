
## 根因

`/admin/[expertSlug]`（導師後台首頁「最近發布的週記」）與其他兩三個角落，**各自維護一份 actionLabels，且用 `|| actionLabels.buy` 當 fallback**。任何非 buy/sell 的 action（`exit`、`teaching`、`add`、`trim`、`hold`…）通通掉進 fallback → 全部印成「買進」+ 綠色 badge。

已用資料庫確認兩筆記錄本身是對的：
- `4755 三福化` → `action='exit'`（應顯示「平損」）
- 純教學週記 → `action='teaching'`（應顯示「教學」+ 標的名「純教學週記」）

亂象出處清單（一次盤點完）：

| 檔案 | 問題 |
|---|---|
| `src/pages/admin/Dashboard.tsx` L14-17, L222 | 自建 map 只有 `buy`/`sell`，且 `|| actionLabels.buy` — **這就是使用者看到的那頁** |
| `src/pages/_adminSignals/SignalRow.tsx` L90 | 用共用 map，但仍 `|| actionLabels.buy` — 未來新增 action 會再爆 |
| `src/pages/_adminSignals/PreviewTradeItem.tsx` L26 | 同上 `|| actionLabels.buy` |
| `src/pages/SignalPreviewHarnessEntry.tsx` L69 | 相同 fallback 模式 |
| `src/components/ActionBadge.tsx` | 第 3 份重複 map（自訂 config） |
| `src/pages/admin/SignalTemplates.tsx` L37 | 第 4 份重複（只列 buy） |

除了 label 錯誤，`admin/Dashboard.tsx` 對 `teaching` 也沒有像 SignalRow 那樣把空 `instrument` 換成「純教學週記」。

## 修法（單一資料源 + 消滅 fallback）

### 1. 建立唯一真相 `src/lib/signalAction.ts`
- `SIGNAL_ACTION_META`：包含 `buy / sell / add / trim / exit / hold / teaching` 完整 7 種，欄位 `{ label, className, badgeVariant }`。
- `getActionMeta(action)`：查不到回傳 `{ label: action ?? '—', className: 'bg-muted text-muted-foreground border-border' }`（**灰色未知**，不再偷偷變買進）。
- `isTeachingSignal(signal)`、`getSignalDisplayInstrument(signal)`：把「教學顯示成純教學週記」的邏輯集中。

### 2. 全站替換
- 刪除 `src/pages/_adminSignals/actionLabels.ts`、`ActionBadge` 內建 map、`admin/Dashboard.tsx` 內建 map、`SignalTemplates.tsx` 內建 map。
- 全部改 import `getActionMeta` / `SIGNAL_ACTION_META`。
- 移除所有 `|| actionLabels.buy` fallback。
- `admin/Dashboard.tsx` 的最近週記卡片：`teaching` 顯示「純教學週記」+ 教學 badge；其他顯示 `signal.instrument`。

### 3. 護欄
- 單元測試 `src/test/unit/signalActionLabel.test.ts`：斷言 7 種 action + `null` + 未知字串各自的 label / className，明確禁止未知 action 落到「買進」。
- 加入 `scripts/audit-signal-action-labels.mjs`（複用 audit-journal-authoring 模式）：`rg` 掃描專案，出現 `actionLabels.buy` 當 fallback、或 `Record<..., { label ... }>` 定義 buy label 於 `signalAction.ts` 之外 → CI 失敗。
- 掛進 `.github/workflows/ci.yml` 既有 audit job。

### 4. 驗證
- `bunx vitest run src/test/unit/signalActionLabel.test.ts`
- Playwright：以 view-as 身份開 `/admin/[mentor-slug]`，斷言最近週記區塊有 `4755 三福化` + `平損` badge、`純教學週記` + `教學` badge，且**不存在**帶「買進」文字的元素對到這兩筆 id。
- `bun run tsgo` 型別檢查。

## 影響

- 使用者立即看到 4755 顯示「平損」、7/23 那筆顯示「教學 / 純教學週記」。
- 之後再加任何 action（例：`stop_win`、`observe_close`），只要在 `signalAction.ts` 補一筆就全站生效，忘了補也只會顯示灰色未知，不會誤導成「買進」。
- CI 擋住未來任何人再新增一份區域 actionLabels 或 fallback 到 buy。
