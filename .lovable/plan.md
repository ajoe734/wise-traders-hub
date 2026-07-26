
# A 方案：origin echo + credentials（宏觀 → 微觀）

## 1. 宏觀：這是「CORS 合約」問題，不是單一函式 bug

目前 100+ 個 Edge Functions 共用 `supabase/functions/_shared/cors.ts` 一份 `corsHeaders`，值是：

```
Access-Control-Allow-Origin: *
（沒有 Access-Control-Allow-Credentials）
```

而前端有兩類呼叫者：
- **一般 API**：走 `supabase-js`，預設 `credentials: 'same-origin'` → 跨源時等於 omit → `*` 合法。
- **Traffic / Beacon**：`navigator.sendBeacon` 規範**強制帶 cookies**，等同 `credentials: 'include'`。瀏覽器規則：只要請求帶 credentials，`Allow-Origin` **不得為 `*`**，且必須回 `Allow-Credentials: true`，否則整個 response 被瀏覽器丟掉 → 這就是 E2E 7 條路由全紅的原因。

所以問題本質是：**共用 CORS 合約只服務了「無 credentials」的呼叫者，忽略了「Beacon 類必帶 credentials」的呼叫者**。任何未來新增的 sendBeacon / `credentials: 'include'` 端點都會再踩一次。修法應該收在共用層，而不是散在每支函式。

## 2. 中觀：三個模組的邊界該怎麼切

```text
┌─────────────────────────────────────────────┐
│ 前端 src/lib/trafficTracker.ts              │  ← 呼叫端
│   fetch fallback 明確 credentials:'include' │
└──────────────┬──────────────────────────────┘
               │ Origin: https://xxx.lovable.app
               ▼
┌─────────────────────────────────────────────┐
│ 共用 _shared/cors.ts                        │  ← 合約層（本次主要改動）
│   buildCorsHeaders(req, { credentials })    │
│   - echo Origin（白名單過濾）               │
│   - Vary: Origin                            │
│   - Allow-Credentials: true（可選）         │
└──────────────┬──────────────────────────────┘
               ▼
┌─────────────────────────────────────────────┐
│ traffic-ingest / 其他 beacon 類函式         │  ← 消費端
│   corsPreflight(req) / jsonResponse(req,…) │
└─────────────────────────────────────────────┘
```

原則：
- **白名單集中在 cors.ts**：`legendflow.tw`、`www.legendflow.tw`、`*.lovable.app`、`*.lovableproject.com`、`localhost:8080`。未列入者 → 回 `Allow-Origin: null`，瀏覽器阻擋，但函式仍回 200（避免 sendBeacon 無限重試）。
- **credentials 是 opt-in**：只有真的需要（traffic-ingest 這類）才呼叫 `corsPreflight(req, { credentials: true })`。其他函式不變，繼續走 `*`，行為零回歸。
- **Vary: Origin 必加**：否則 CDN / 瀏覽器會把某個 origin 的 response cache 給另一個 origin，造成偶發 CORS 錯誤。

## 3. 微觀：檔案級改動清單

### 3.1 `supabase/functions/_shared/cors.ts`（新增能力，不破壞舊介面）
- 新增 `ALLOWED_ORIGINS` 白名單 + `matchOrigin(req)`（支援 `*.lovable.app` 這類 suffix）。
- 新增 `buildCorsHeaders(req?, opts?)`：無 req → 回原本的 `*` 版本（現有 100+ 函式行為不變）；有 req + `credentials:true` → 回 echo origin + `Allow-Credentials: true` + `Vary: Origin`。
- `corsPreflight(req?, opts?)` / `jsonResponse(data, init, req?, opts?)` 增加可選第二/三參數；舊呼叫方式維持相容。
- 匯出 `corsHeaders` 常數保留給仍在直接展開 `...corsHeaders` 的舊函式使用。

### 3.2 `supabase/functions/traffic-ingest/index.ts`
- `OPTIONS` 分支改成 `corsPreflight(req, { credentials: true })`。
- 所有 `jsonResponse(...)` 改成 `jsonResponse(payload, init, req, { credentials: true })`（或 `errorResponse` 相對應版本）。
- 確認錯誤路徑也走同一路徑（避免 500 掉 CORS）。

### 3.3 `src/lib/trafficTracker.ts`
- `fetch` fallback 明確 `credentials: 'include'`（目前沒設 → 預設 same-origin，跨源會漏 cookie，跟 sendBeacon 行為不一致）。
- `sendBeacon` 保持不動（本來就強制帶 credentials）。
- 加一行註解說明「本端點是需要 credentials 的少數例外」。

### 3.4 E2E harness
- `e2e/portfolio-modules-smoke.spec.ts` 的 console.error 監聽：CORS 訊息已被 fix 掉，不用再加白名單。
- 補一支 `e2e/traffic-ingest-cors.spec.ts`：跨 origin 打一次 preflight + POST，斷言 response header 有 `Access-Control-Allow-Credentials: true` 且 `Allow-Origin` 是實際 origin 而非 `*`。

## 4. 驗證步驟（做完 A 之後）
1. Unit：`bunx vitest run src/test/unit/checkup-*`（21 條回歸）。
2. Edge function 直打：`curl -X OPTIONS -H "Origin: https://id-preview--….lovable.app" …/traffic-ingest` → 檢查回 header。
3. E2E：重跑 `e2e/portfolio-modules-smoke.spec.ts`（7 條）+ 新增的 traffic-ingest-cors。
4. Prod smoke：確認 `/company/perf-metrics` 的 traffic 事件仍有寫入（不會因 origin 白名單漏掉正式站）。

## 5. 為什麼不選 B / C

- **B（前端 omit credentials）**：治標。sendBeacon 規範就是強制帶 credentials，改不動；只有 fetch fallback 能 omit。而且未來若要用 traffic 做「登入者行為分析」還是得帶 cookie，等於自斷後路。
- **C（E2E ignore CORS 錯誤）**：純粹遮眼睛。真實用戶的 sendBeacon 一樣被丟掉，traffic 數據會長期缺一角，還會掩蓋未來其他 CORS 回歸。

## 6. 風險與回滾
- 風險：白名單漏列某個正式 origin → traffic 事件掉。緩解：函式端仍回 200，前端不會爆；監控 `traffic_events` 每小時筆數，異常掉幅 > 30% 觸警。
- 回滾：`_shared/cors.ts` 舊介面完全相容，單獨 revert `traffic-ingest/index.ts` 即回到現況。
