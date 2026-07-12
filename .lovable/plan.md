## 症狀
- 使用者以公司管理員身份在 `/app/expert/sharkgu?tab=ai-chat` 送訊息，客戶端顯示「AI 對話發生錯誤 · Failed to fetch」，耗時 18~32 秒。
- 每次重試都失敗，看似無限錯誤循環。

## 觀察結果（已用 read-only 工具驗證）
1. Edge Function `expert-ai-chat` **零 handler 日誌**（沒有 `start` / `end` / `unauthorized` / 任何 error）— 表示請求根本沒進入 `withLogging` 內的 handler，或 handler 一啟動就掛掉沒任何 log 就被 kill。
2. AI Gateway logs 從 `08:26 UTC`（使用者測試時間）後 **沒有任何 chat_completions 呼叫** — 表示 `streamText` 從未成功送出上游請求。
3. 我用 `supabase--curl_edge_functions` 直接呼叫 `expert-ai-chat` 可以正常回 401 並寫入 log，證明 function 本身部署正常、CORS 正常、handler 有跑。
4. `expert-ai-conversation` 也在 08:30 UTC 前後被以每 1~2 秒的頻率打，全部 200 成功回應 — 表示客戶端瀏覽器與該 Supabase URL 網路連線正常，並非 DNS/CORS 問題。
5. 上一輪修改把 `expert_ai_access_logs` insert 加入 handler 主流程（雖是 fire-and-forget），且移除了原本 `.eq('user_id', uid)` 的過濾條件。migration 已套用，表存在、RLS 開啟、service_role 有 ALL 權限。

結論：使用者 POST `expert-ai-chat` 的請求進到 Supabase gateway 後，在 handler 執行過程中「連線被切斷」，前端 fetch 抛出 `Failed to fetch`，且切斷發生在 handler 尚未產生任何 stdout 之前——極可能是 handler 執行途中 throw uncaught 而 runtime 立即 kill isolate，或是 `streamText` 開啟串流後上游立即結束但沒任何錯誤傳回。

## 修復步驟

### 1) 加固 `supabase/functions/expert-ai-chat/index.ts`
- 用 try/catch 包住 handler 起始 → RAG → streamText 建立這段流程，任何錯誤都 `log.error` 並回 5xx JSON（讓錯誤有 log、client 能顯示）。
- 把 `logAccess()` 從 `.then()` fire-and-forget 改為 `EdgeRuntime.waitUntil(...)` （若可用）或直接 `await`，避免在 stream 開啟後 isolate 被 recycle 導致 insert 掛掉污染主流程。
- 在 `expertId` 查詢加回 `.eq('user_id', uid)` 的路徑分支：owner path 用 `id + user_id` 條件先試，非 owner 再退回 `id`；避免遠端 planner 在 `member_subscriptions ... expert_plans!inner` join 出現 policy 遞迴時 hang。
- `streamText.onError` 已存在，但補上 `onError` 內 throw 一個 formatted error 讓 `toUIMessageStreamResponse` 能把錯誤 flush 到 SSE stream，而不是靜默斷線。

### 2) 修客戶端 `src/pages/_expertAiChat/useExpertAiChat.ts`
- 在 `transport.fetch` 外層加 try/catch，把 `Failed to fetch` 的原生 `TypeError` 額外 `console.error` 附上 `x-correlation-id` / `x-request-id`，方便未來對照。
- **關掉自動重試（`autoRetriedRef`）**：目前 onError 內會排 600ms 後 `chat.regenerate()`，配合使用者手動點「重試」形成連續錯誤感。改為預設不自動重試，只在明確為 5xx 且有 errorId 時重試一次，其他狀況直接顯示手動重試按鈕，避免「無限錯誤」畫面。

### 3) 驗證
- 部署後在管理員帳號重新開 `/app/expert/sharkgu?tab=ai-chat` 送一則訊息，預期：
  - `supabase--edge_function_logs expert-ai-chat` 出現 `start` + `end`（status 200）。
  - `ai_gateway_logs--list_ai_gateway_requests` 出現一筆 `google/gemini-2.5-flash` chat_completions。
  - 客戶端正常收到串流回覆。
- 若仍失敗：從新出現的 `log.error` 訊息與 `x-correlation-id` 精準定位（不再是黑盒）。

## 不動的部分
- UI 版面、Access Status Card、access log 頁面、migration schema 一律不動。
- 只調整 handler 錯誤邊界 + 客戶端重試策略。
