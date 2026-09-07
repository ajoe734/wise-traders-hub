# 修正「手動輸入股票代碼會被中斷」

## 根因（已從現行 source 確認）

`src/checkup/components/freecheckup/TradeUploadModal.jsx` L15–29 的 focus 管理 effect：

```js
useEffect(() => { ...
  previouslyFocused.current = document.activeElement;
  setTimeout(() => dialogRef.current?.focus?.(), 0);   // 把焦點搶到 dialog 容器
  return () => { ...
    try { previouslyFocused.current?.focus?.(); } catch {}  // cleanup 又搶一次
  };
}, [open, onClose]);
```

`onClose` 是 `FreeCheckup.jsx` L3457 每次 render 都新建的 inline arrow：

```js
onClose={() => { setUploadModalOpen(false); if (tab === 'trade') setTab('holdings'); }}
```

→ **父層每重繪一次，effect 就 cleanup + 重跑一次**，等於每次重繪都把焦點從輸入框搶走（先 refocus 舊元素，再 setTimeout focus 到 dialog 容器）。輸入框失焦後鍵盤輸入落空，使用者只能一直點回欄位再打一個字。

父層重繪頻率（都會打斷輸入）：
- `src/pages/_freeCheckup/useHoldingsSync.js` L337：refresh 冷卻倒數 `setInterval(tick, 1000)` → **每秒一次**（剛做過報價更新時最明顯）
- `src/checkup/components/freecheckup/HoldingsHero.tsx` L99：每 30 秒
- `FreeCheckup.jsx` L127：quota tick 每 60 秒
- 任何持倉／報價／sparkline 自癒 state 更新

與 `ManualTradeForm` 的名稱解析 race 防護無關；那部分邏輯正確。

## 修法（最小原子修正，僅 UI 層）

### 1. `TradeUploadModal.jsx` — 讓 focus effect 只在「真正開關」時執行
- 用 `onCloseRef` 保存最新 `onClose`（獨立 effect 更新 ref），keydown handler 讀 ref。
- 主 effect 的相依陣列改為 `[open]`，移除 `onClose`。
- 記錄前一個焦點元素 + `setTimeout(focus dialog)` 只在 `open` 由 false→true 時做一次。
- cleanup 的「還原焦點」只在真正關閉／卸載時執行；且若目前焦點仍在 dialog 內就不強搶。
- `document.body.style.overflow` 的鎖定／還原同樣只綁 `open`。

### 2. `FreeCheckup.jsx` — 穩定 modal 的 props identity
- 用 `useCallback` 包 `onClose`（依賴 `tab`），避免每次 render 產生新函式。
- 這是防護性收斂，即使 1 修好也應該做，避免未來別的 effect 重蹈覆轍。

不改 `ManualTradeForm`、不改資料流、不改 DB／Edge。

## 驗收
- 新增回歸測試 `src/test/unit/trade-upload-modal-focus-stability.test.tsx`：
  - 修前紅：modal 開啟、focus 在「股票代碼」input，父層連續重繪 3 次 → 斷言 `document.activeElement` 仍是該 input（修前會變成 dialog 容器）。
  - 斷言父層重繪時不會重跑 focus trap（dialog `focus` 只被呼叫一次）。
- 既有相關測試須維持綠：`manual-trade-form`、`manual-trade-name-race`、`manual-trade-pipeline`、`manual-trade-entry`。
- Playwright 手動重現：開新增成交 → 手動輸入 → 逐字輸入 `2330`，每字間隔 1.2 秒（跨越每秒 tick），值必須是完整 `2330` 且焦點未離開。
