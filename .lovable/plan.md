# 第五輪優化已完成

## 已完成（累計）
- 第二輪 ✅ Checkout.tsx 1351→808、Pricing.tsx 1028→301
- 第三輪 ✅ checkup-sparkline / checkup-calendar / checkup-predict-events
- 第四輪 ✅ checkup-twse / checkup-telemetry
- 第五輪 ✅ checkup-analyze / checkup-research / checkup-knowledge / checkup-report / checkup-research-extract
  - 全部改用 `_shared/cors.ts` 的 `corsHeaders` + `jsonResponse`
  - 4 個用到 DB 的 function 改用 `serviceClient()`，移除 inline `createClient(@2.49.1)`
  - 全部以 `withLogging('<name>', ...)` 包裝，handler 取得 `log` 參數
  - 部署完成，`checkup-knowledge?action=stats` curl 驗 200 + `x-correlation-id` 正確傳遞

## 下一輪可選
- 移除 `_shared/checkupCors.ts` re-export（全 checkup-* 已切完，可確認無殘留引用後刪除）
- 仍未遷移的 edge：confirm-linepay / confirm-remittance / validate-signal-prices 等 inline `corsHeaders` 與 `createClient(@2.49.1)` 可以同模式批次遷移
- P2 Index.tsx 拆分（目前 1049 行）
