# 第三輪優化已完成

## 已完成
- **步驟 1（第二輪）** ✅ Checkout.tsx 1351 → 808 行（拆 4 子元件）
- **步驟 2（第二輪）** ✅ Pricing.tsx 1028 → 301 行（拆 4 子元件）
- **步驟 3（第三輪）** ✅ Edge 共用層遷移
  - `checkup-sparkline` — 改用 `_shared/cors.ts`、`serviceClient()`、`withLogging`
  - `checkup-calendar` — 同上
  - `checkup-predict-events` — 同上
  - 三者已部署、sparkline curl 驗 200，`x-correlation-id` header 正確回傳

## 下一輪可選
- 把 `_shared/checkupCors.ts` 的 re-export 移除，掃全部 checkup-* function 切到 `_shared/cors.ts`
- Edge 第二批：`checkup-stock-info`、`checkup-twse`、`checkup-telemetry` 同模式遷移
- P2 Index.tsx 拆分（若超過 1000 行）
