## 目標

讓 `checkup-calendar` 和 `checkup-predict-events` 共用同一份 Google News RSS 結果,避免重複抓新聞,但**完全不動兩支函式各自的 LLM 職責、quota 規則、per-event 24h cache**。

---

## 現況痛點

同一檔股票(例:2330),在持倉變動時:
- `checkup-calendar` 抓 1 次(每檔 5 則)
- `checkup-predict-events` 又抓 1 次(每檔 2 則)

兩次抓的是**幾乎一樣的東西**,還都跑了 Google News RSS 的網路往返。一份持倉 10 檔 → 一輪互動最多打 50+ 次外部 RSS。

---

## 解法:共用新聞快取(5 分鐘 TTL)

新增一個小型共用模組 `supabase/functions/_shared/newsCache.ts`,提供 `fetchNewsForCode(code)`:
1. 先讀 `checkup_storage` 的 `news-cache-{code}` (system UID `00000000-...`)
2. 若 `updated_at` 在 5 分鐘內 → 直接回傳 cached items
3. 否則打 Google News RSS,**取前 5 則**(取較大那邊),寫回 cache,回傳

兩支函式各自決定要用幾則(calendar 取前 5、predict 取前 2),讀的是同一份資料。

```text
                          ┌──── news-cache-2330 (5min TTL) ────┐
                          │                                     │
持倉變動 ──► calendar ────┤                                     │
                          │  讀同一份                            │
事件列表 ──► predict ─────┘                                     │
                                                                 │
                          └─ 命中時 0 次 RSS,失誤時 1 次 RSS ──┘
```

---

## 變更檔案

### 1. 新增 `supabase/functions/_shared/newsCache.ts`
- `fetchNewsForCode(supabase, code, opts?)` → 回傳 `{ title, source, pubDate }[]`
- TTL 預設 5 分鐘,可參數化
- 內含 RSS 抓取 + 解析(把 `decodeHtml` / `pickTag` / `parseRssItems` 從現有兩支函式抽出來)
- 3 秒 timeout,失敗回空陣列(不爆錯)
- 寫 cache 用 system UID `00000000-0000-0000-0000-000000000000`,key `news-cache-{code}`

### 2. 修改 `supabase/functions/checkup-calendar/index.ts`
- 移除本檔的 `decodeHtml` / `pickTag` / `parseRssItems` / `fetchNewsRSS`
- `fetchNewsContext()` 改為:對每檔 code 呼叫 `fetchNewsForCode`,取前 5 則
- 新增 `getSupabaseAdmin()`(目前這支沒有 supabase client)
- 保留原本「每檔之間 300ms sleep」可拿掉(cache 命中就不打 RSS 了)

### 3. 修改 `supabase/functions/checkup-predict-events/index.ts`
- 移除本檔的 `decodeHtml` / `pickTag` / `fetchNewsForStocks` 內的 RSS 抓取邏輯
- `fetchNewsForStocks()` 改為:對每檔 code 呼叫共用 `fetchNewsForCode`,取前 2 則
- 保留原本的並行(`Promise.all`)和 timeout 行為(共用模組已含 timeout)

### 4. 不動的東西(刻意保持原狀)
- `checkup-calendar` 的 LLM prompt、`tryRepairTruncatedArray`、JSON 解析三層保險
- `checkup-predict-events` 的 24h per-event cache(`prediction-cache-{eventId}`)
- `consumeCheckupQuota` 的扣點時機
- RAG 知識庫查詢、TWSE MIS 即時報價抓取
- 兩支函式的對外 API、輸入 schema

---

## 預期效益

| 場景 | 改前 | 改後 |
|---|---|---|
| 持倉 10 檔,連續觸發 calendar 和 predict | 50 次 RSS | 10 次 RSS(首次) → 0 次(5 分鐘內重觸) |
| 同一個事件 7 天內被點開 N 次 | 已被 24h cache 擋掉 LLM,但每次預測仍打 RSS | 5 分鐘內 RSS 也省掉 |
| 失敗半徑 | 不變 | 不變(共用模組有 try/catch + 空陣列 fallback) |

---

## 風險與防護

- **Cache 過期判斷錯誤** → 防護:用 `updated_at` 字串解析失敗時當作 miss。
- **system UID 寫入衝突** → 已用 `onConflict: 'user_id,key'` upsert(同 prediction-cache 模式)。
- **RSS 內容過大撐爆 row** → 只存 `{ title, source, pubDate }` 三欄,每檔最多 5 則,單筆 < 2KB。
- **TTL 太長導致行事曆抓不到「剛剛發布的新聞」** → 5 分鐘是一般財經類新聞可接受的延遲;若使用者覺得短可調為 3 分鐘。

---

## 驗證步驟(實作後)

1. `supabase--deploy_edge_functions` 部署 calendar + predict-events
2. `supabase--curl_edge_functions` 連續 call calendar 兩次,第二次應該明顯快(看 console log `news cache hit for {code}`)
3. `supabase--read_query` 查 `checkup_storage` where key like `news-cache-%`,確認有寫入且 updated_at 在 5 分鐘內
4. 確認 `checkup-predict-events` 仍正確扣 quota、24h prediction cache 仍生效

---

要我開工嗎?改動範圍小、零 schema 變更、零 quota 影響。