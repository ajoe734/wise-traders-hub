## 不是 100% 最優。區分兩個層次：

| 層次 | 現行計畫的覆蓋 | 缺口 |
|---|---|---|
| **UI 不說謊** | 有：摘要對齊 readiness | 做得太保守，把 partial 值隱藏成 `—`；使用者會以為壞掉 |
| **60 日資料真的存在** | 只有「自動觸發一次 backfill」 | 沒有追蹤是否補滿、沒有逾時/失敗揭露 |

所以最優解 = 我原本計畫的修正 + 兩項加強。

## 加強後的最優計畫

### 1. 摘要格子顯示 partial 值 + 誠實覆蓋標記（不藏數字）

`src/checkup/components/freecheckup/ChipsSection.tsx`

```tsx
const isReady = rd?.state === 'ready';
const isPartial = rd && rd.have < rd.need;
return (
  <div
    data-testid={`chips-inst-${row.k}-${w.key}`}
    data-readiness-state={rd?.state ?? 'unknown'}
    title={isPartial ? `僅 ${rd.have}/${rd.need} 個交易日` : undefined}
    style={{
      textAlign: 'right',
      color: isReady ? tone(WB, val ?? null) : WB.inkMute,
      fontVariantNumeric: 'tabular-nums',
    }}
  >
    {isReady ? fmtNet(val ?? null) : isPartial ? `${fmtNet(val ?? null)} (${rd.have}/${rd.need})` : '—'}
  </div>
);
```

效果：6 天資料時顯示 `-9,388 (6/60)`，使用者立刻看懂「數字有，但視窗不完整」。

### 2. 自動 backfill 後追蹤是否補滿

`src/checkup/components/freecheckup/ChipsSection.tsx` + `useTwChipsDetail.ts`

- 抽屜開啟偵測 `sparse` → 自動觸發一次 `handleBackfill()`（同原計畫）。
- 觸發後把 `backfillStartedAt` 寫入 local ref，並在 `useTwChipsDetail` 輪詢時附帶 `backfill_tracking` 旗標。
- 若 30 分鐘內 `readiness.institutional['60'].state` 轉為 `ready`：toast 關閉、顯示正常。
- 若 30 分鐘後仍未 ready：在摘要格子上方顯示一行「歷史資料補齊中，預計 5–15 分鐘後完成」，並把該 stock_id 寫入 `cron_dispatch_log`（source: `chips_sparse_manual_backfill_timeout`）供後台追蹤。

### 3. 後端補 `days_covered`（保險）

同原計畫：在 `supabase/functions/tw-chips-detail/index.ts` 的 `institutional[d${w}]` 加 `days_covered` 欄位，僅供 debug/測試，主判定仍走 `readiness`。

### 4. 測試

- 擴充 `src/test/unit/pr8-chips-circuit.test.ts`：partial 案例斷言文字為 `-9,388 (6/20)` 且 `data-readiness-state="filling"`。
- 新增 `e2e/chips-summary-readiness.spec.ts`：驗證摘要與趨勢圖 caption 數字一致（都是 `6/60`）。

## 不做

- 不動 schema / Orchestrator / Lane / seal 契約。
- 不擴大 sparse 門檻。

## 影響檔案

- `src/checkup/components/freecheckup/ChipsSection.tsx`（摘要 partial 顯示、backfill 追蹤）
- `src/checkup/hooks/useTwChipsDetail.ts`（backfill tracking 旗標）
- `supabase/functions/tw-chips-detail/index.ts`（`days_covered`）
- `src/test/unit/pr8-chips-circuit.test.ts` + `e2e/chips-summary-readiness.spec.ts`
