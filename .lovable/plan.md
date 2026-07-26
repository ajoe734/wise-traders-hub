## 加回「1 日」視窗

現在視窗語意變成「高亮 W 根柱、加總=讀值」，1 日就是最自然的「單日檢視」——高亮 scrubber 當日那 1 根柱，讀值 = 當日淨買賣，語意一致。

### 改動

**`src/checkup/components/freecheckup/ChipsTrendChart.tsx`**
- `type Window = 1 | 5 | 20 | 60`
- 視窗按鈕陣列 `[1, 5, 20, 60]`
- `useState<Window>(1)` 預設從 5 改成 1（單日最直覺，配合 scrubber 立即回饋）
- clamp fallback 陣列補上 1：`[60, 20, 5, 1]`
- 讀值標籤：`win === 1` 時顯示「當日淨買賣」，其餘維持「N 日累計淨買賣」
- bsr 模式維持固定 5 日（bsr 沒有視窗切換 UI）

### 測試

**`e2e/chips-section.spec.ts`**
- 補「1 日」按鈕可點、切到 1 日時 `[data-window-active="true"]` 只剩 1 根、讀值顯示「當日淨買賣」
- 保留現有 5→20 高亮擴張斷言

**`e2e/chips-section-visual.spec.ts`**
- 若有 baseline，需要重取（多一顆按鈕會挪動版面）

### 不動
- 播放鍵維持移除。
- 柱色規則、資料源、readiness 邏輯不變。
