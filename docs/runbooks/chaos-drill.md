# 壅塞演練（Chaos Drill）Runbook

手動觸發，用固定假資料重現三種壅塞情境，驗證 auto-heal 每次都恢復到 normal
且 `reset_at` / `daily_budget` 有被更新。建議在 staging 執行；正式環境亦安全（全程只碰 `drill_` 沙箱物件）。

## 觸發方式

- 後台：`/company/data-source-health` → 「壅塞演練（Chaos Drill）」卡片 → 執行演練（需 company_admin）。
- API：

```bash
curl -X POST "$SUPABASE_URL/functions/v1/chips-chaos-drill" \
  -H "x-cron-key: $CRON_SHARED_SECRET" -H "Content-Type: application/json" \
  -d '{"scenarios":["kill_switch","degrade","quota_pool"],"cleanup":true}'
```

回應：全部通過 `200 {"passed":true}`，任一驗收未過 `422 {"passed":false}`，
`results[].checks[]` 逐條列出 expected / actual。

參數：
- `scenarios`：省略＝三種全跑。
- `cleanup`：預設 `true`；設 `false` 可保留沙箱資料人工檢視（下次演練會先清掉）。

## 沙箱物件（唯一會被寫入的資料）

| 物件 | 值 |
| --- | --- |
| `system_kill_switches.key` | `drill_chaos_switch` |
| `tw_bsr_sync_config.key` | `degrade:drill_chaos` |
| `finmind_quota_pools.pool_name` | `drill_chaos_pool` |
| `tw_bsr_degrade_events.api_name` | `drill_chaos` |

`chips-guardian` 已排除 `drill_` 前綴的配額池；演練不寫 `system_alerts`。

## 三種情境與驗收

1. **kill_switch**：注入自動關閉且已關閉 200 分鐘、零流量樣本
   → 驗收 `enabled=true`、`disabled_reason=null`（走 `stale_force_reopen`）。
2. **degrade**：注入 `tier3_paused`、cooldown 已過 30 分、卡住 90 分、無降級訊號
   → 迴圈逐級退回，驗收最終 `mode=normal` 且至少退一級。
3. **quota_pool**：
   - A 跨日：`reset_at=昨天`、`daily_budget=60`、`base=600`、`used_today=187`
     → 驗收 `used_today=0`、`reset_at=台北今日`、`daily_budget=600`、`tokens=capacity`。
   - B 用滿：`reset_at=今天`、`daily_budget=240 < base`、`used_today=240`
     → 驗收 `daily_budget=600`，`used_today` 維持 240（不歸零）。

## 程式邊界

- 決策：`supabase/functions/_shared/autoHealRules.ts`（純函式）
- 副作用：`supabase/functions/_shared/autoHealEffects.ts`（guardian 與 drill 共用，作用對象參數化）
- 假資料與驗收條件：`supabase/functions/_shared/chaosDrillScenarios.ts`（純函式）
- 單元測試：`src/test/unit/chaosDrillScenarios.test.ts`（12 例）、`src/test/unit/autoHealRules.test.ts`（26 例）

改動 auto-heal 門檻常數時，跑 `bunx vitest run src/test/unit/autoHealRules.test.ts src/test/unit/chaosDrillScenarios.test.ts`
並重跑一次演練確認仍為 PASS。
