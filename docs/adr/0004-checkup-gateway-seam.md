# ADR 0004 — Checkup Gateway：checkup hooks 對外握手的唯一接縫

Status: Accepted
Date: 2026-07-30

## 背景

`src/checkup/hooks/**` 有 14 支 hook 各自直接 `fetch()` 或 import supabase client：
`api/useAnalysis`、`api/useCloudSync`、`api/useResearch`、`useAuthoritativePrices`、
`useDailyAnalysisWorkflow`、`useEventReviewWorkflow`、`useHoldingShareExport`、
`useMarketData`、`useMetaOverrides`、`usePortfolioBootstrap`、`useResearchWorkflow`、
`useStressTestWorkflow`、`useTargetPriceHistory`、`useTwChipsDetail`。

後果：
- 測試無法隔離外部握手，只能整支 `vi.mock('@/integrations/supabase/client')`，
  每個測試檔重刻一份 query-builder 假物件。
- 錯誤處理各寫各的（`res.ok` / `res.json().catch()` / `error?.message`），
  同一種失敗在不同畫面呈現不同訊息。
- realtime channel 與 auth 訂閱的退訂散落各處，容易漏 `removeChannel`。

## 決策

新增深模組 `src/checkup/lib/gateway`，介面只有五個成員：

```
http { json, tryJson, text, blob }   // 失敗一律丟 CheckupGatewayError
db   { from }                        // query builder 直通
auth { getUserId, onAuthStateChange, getAccessToken }
realtime { subscribe }               // 回傳退訂函式，內部管 channel 生命週期
invoke(name, body)                   // edge function，error 正規化
rpc(fn, args)                        // Postgres RPC，error 正規化
functionsUrl()
```

取用方式固定為 `getCheckupGateway()`；測試以 `setCheckupGateway(createFakeGateway(...))`
換成 fake，並用 `fake.calls.{http,db,invoke,realtime}` 斷言握手內容。

機制強制（非自律）：`src/test/unit/checkup-gateway-seam.test.ts` 靜態掃描
`src/checkup/hooks/**` **與 `src/checkup/components/**`（含持倉抽屜 `freecheckup/`）**，
出現下列任一即失敗：

- import supabase client
- 直接 `fetch(`
- 直接 `functions.invoke(`
- 直接 `supabase.rpc(` / `client.rpc(`

`src/checkup/lib|contexts/**` 仍有既存直連檔，以 `LEGACY_DIRECT_CLIENTS` 白名單凍結：
只能變少，不能變多；修好後必須從白名單移除（有「白名單沒有殘留已修好的項目」測試把關）。

持倉抽屜的籌碼回補（`tw-institutional-daily-sync` + `enqueue_bsr_backfill`）
已下沉為 `src/checkup/hooks/useChipsBackfill.ts`，元件層只做 UI 與 toast。

## 取捨

- `db.from()` 是 pass-through，介面上不算深；但把 query 語法留在呼叫端能避免
  為每張表長出一個方法（介面會爆炸）。連線與可替換性的價值大於這點不純。
- fake gateway 對「未註冊的 URL / edge function」直接丟錯，而不是回空值 —— 讓測試
  裡任何沒被預期的外部握手立刻現形。

## 影響

- 新的 checkup hook 一律走 gateway，不得再直接握手。
- 需要新的握手型態（例如 storage 上傳）時，先擴充 gateway 介面再使用。
