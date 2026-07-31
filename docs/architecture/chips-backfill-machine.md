# 籌碼面自動回補狀態機（C3）

抽屜 §4.6 籌碼面在資料稀疏時會自動排入 60 日回補。這段邏輯原本散在
`ChipsSection.tsx` 的 4 個 `useEffect`（重置／觸發／補滿／逾時）＋ 1 個 `useRef` Set，
條件互相牽制、只能開瀏覽器手測。C3 把它拆成三層：

| 層 | 檔案 | 職責 |
| --- | --- | --- |
| 純狀態機 | `src/checkup/lib/chipsBackfillMachine.ts` | `(state, event) -> { state, effects }`，零 React、零 I/O |
| React 接線 | `src/checkup/hooks/useChipsAutoBackfill.ts` | 餵事實、跑計時器、排出 effects，回傳 `phase` |
| 握手 | `src/checkup/hooks/useChipsBackfill.ts` | 走 Checkup Gateway seam（ADR-0004）的 invoke + rpc |
| UI | `ChipsSection.tsx` | 只讀 `phase` 決定是否顯示逾時橫幅 |

## 狀態圖

```
idle --(hasData && sparse && eligible && status∉{pending,running} && 本股未觸發過)--> triggered
triggered --(satisfied)--> ready
triggered --(30 分鐘)--> timeout        // 送 chips_auto_backfill_timeout
stock 事件 --> idle（fired 記憶保留，切回同一檔不重排）
```

- `satisfied` 由 `isBackfillSatisfied()` 判定：readiness 60 或 20 日 `ready`，或本地
  三大法人日資料 ≥ 20 天。
- `ready` / `timeout` 皆為該檔的終態；換股才會重置 phase。
- 換股後殘留的 `snapshot` / `timeout` 事件（stockCode 不符）一律忽略，避免誤報。
- 輪詢退避階梯也收在同一模組（`nextPollDelay` / `POLL_BACKOFF_MS`：60s→15m 封頂），
  BSR status ∈ {pending, running} 時才啟用。

## 測試

- `src/test/unit/chipsBackfillMachine.test.ts`（23）：所有轉移分支、不觸發的 5 種前置條件、
  終態不回退、換股殘留事件忽略。
- `src/test/unit/useChipsAutoBackfill.test.ts`（6）：假計時器驗證排入一次、ready 清計時器、
  逾時回報 elapsed、換股行為。

新增觸發條件時只改 `shouldAutoTrigger`，不要在元件裡加 `useEffect`。
