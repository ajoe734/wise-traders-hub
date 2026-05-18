# 第四輪優化已完成

## 已完成（累計）
- 第二輪 ✅ Checkout.tsx 1351→808、Pricing.tsx 1028→301
- 第三輪 ✅ checkup-sparkline / checkup-calendar / checkup-predict-events 切到 `_shared/cors.ts` + `serviceClient()` + `withLogging`
- 第四輪 ✅ checkup-twse、checkup-telemetry 切到同模式
  - 移除 inline `corsHeaders`、改用 `_shared/cors.ts` 的 `jsonResponse`
  - telemetry 改用 `serviceClient()`，twse 純代理不需 client
  - 兩者已部署，curl 驗 200、`x-correlation-id` 正確回傳

## 下一輪可選
- 第三批 edge：`checkup-analyze`、`checkup-research`、`checkup-knowledge`、`checkup-report` 等較大型 function 同模式遷移
- 移除 `_shared/checkupCors.ts` re-export（全 checkup-* 切完後）
- P2 Index.tsx 拆分（目前 1049 行，可拆 hero/sections）
