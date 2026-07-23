## 目前已確認的根因

這不是單一 `3443` 的前端顯示問題，而是同步流程的全域狀態錯判。

已查資料庫：

- `status = done` 的台股個股工作中：
  - `331` 筆是 `done` 但 `tw_bsr_daily` raw rows = `0`
  - `0` 筆是 partial done（raw rows 1–4）
  - `1385` 筆是真正完成（raw rows >= 5）
- `3443` 屬於這 331 筆之一：queue 被標成完成，但實際沒有任何分點 raw data，也沒有 rollup。
- 因為 `ensure_bsr_queued()` 只看「今天已有 done」就停止排隊，所以這些股票會永久卡住：前端等不到 fallback，後端也不再補抓。

## 根因定義

目前 worker 把 FinMind 空結果當成成功；收盤後空結果會被寫成 `done`。但 `done` 沒有對應 raw rows，等於「假完成」。

後續自動排隊函式看到 `done` 就不再排入，造成所有同類股票卡死。

## 修復範圍：不是只修 3443，是掃全股票

會以全量口徑修：

1. 所有 `tw_bsr_sync_queue` 裡台股個股代號 `[1-9][0-9]{3}`
2. 所有 `done` 但 raw rows `< 5` 的 job
3. 所有持倉中需要 BSR 的台股個股
4. 所有有 raw data 但缺 rollup 的股票
5. 所有最新 queue 狀態與前端 `tw-chips-detail` 回傳不一致的股票

不只挑 `3443`。

## 修復計畫

### 1. 修正完成狀態的定義

`done` 不再只是 queue 狀態，而必須同時滿足：

- `tw_bsr_sync_queue.status = done`
- 同股票、同交易日 `tw_bsr_daily` raw broker rows `>= 5`

否則一律視為「空完成 / 假完成」。

### 2. 修正 `ensure_bsr_queued()`

目前邏輯：

```text
今天有 done → 不排隊
```

改成：

```text
今天有 done 且 raw rows >= 5 → completed
今天有 done 但 raw rows < 5 → 重新排 pending
已有 pending/running → 不重複排
不支援標的 → 不排
```

### 3. 修正 worker 空結果處理

目前空結果會在收盤後變成 `done`。

改成：

```text
FinMind empty / aggregated empty
→ 未達 max_attempts：pending + backoff retry
→ 達 max_attempts：skipped / no_chip_data，不可標 done
```

這會防止未來再產生新的假完成。

### 4. 一次性清理現有 331 筆假完成

把所有：

```text
台股個股 + status=done + raw rows=0
```

改回：

```text
status=pending
next_run_at=now()
last_error=retry_after_empty_done
started_at=null
finished_at=null
last_success_at=null
```

這會包含 `3443`，但不只修 `3443`。

### 5. 補資料一致性審計 SQL

新增或整理一組可重跑的診斷查詢，輸出：

- fake done 數量
- partial done 數量
- pending/running/dead/skipped 分布
- 有 raw 但缺 rollup 的股票
- 有持倉但沒有任何 BSR raw / rollup 的股票
- 最近錯誤原因 top list

### 6. 補回歸測試

擴充既有測試：

- `ensure_bsr_queued_test.sql`
  - 新增 Case：`done` 但 raw rows = 0 → 必須重新排 `pending`
  - 新增 Case：`done` 且 raw rows >= 5 → 才能回 `completed`
- `tw-bsr-finmind-sync` 純邏輯測試
  - `finmind_empty` 不得轉 `done`
  - `aggregated_empty` 不得轉 `done`
  - retry 次數達上限後才可 `skipped/no_chip_data`

### 7. 實際驗收，不只回測試通過

修完後會回報具體數字：

1. 修復前 fake done：目前已知 `331`
2. 修復後 fake done 應為 `0`
3. `3443` 的 queue 狀態應從 fake `done` 變成 `pending/running/done/skipped` 其中之一，但不能再是假 `done`
4. worker 跑完後檢查：
   - `tw_bsr_daily` 是否寫入 rows
   - `tw_chips_rollup` 是否產生 d5/d20/d60
   - `tw-chips-detail` 是否回 `bsr_as_of` / `bsr.d5`
5. 若 FinMind 對某股票真的回空，UI 應顯示真實 pending/skipped/error，而不是假完成或永遠「未同步」。

## 不做的事

- 不改 UI
- 不新增功能
- 不改持倉抽屜設計
- 不把 ETF / 權證硬塞進 BSR
- 不只針對 `3443` 特判