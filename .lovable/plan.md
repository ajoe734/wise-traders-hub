
# 持倉抽屜籌碼面規劃

## 一、使用者價值（先想清楚客戶要什麼）

持有一檔台股時，散戶最想快速判斷三件事：
1. **今天誰在買／賣我這檔？**（三大法人方向與力道）
2. **這波是誰在吃貨／出貨？**（分點主力集中度、關鍵券商動向）
3. **這股資金流是延續還是反轉？**（5/20/60 日累計趨勢）

抽屜是「決策書」，所以籌碼區塊必須在 3 秒內給出**方向 + 力道 + 集中度**三個訊號，不能是原始表格。

## 二、資料範圍與資料源

| 資料 | 來源 | 免費 | 更新時間 |
|---|---|---|---|
| 三大法人（外資／投信／自營） | TWSE `T86`（已有 `checkup-institutional`） | ✅ | T+0 收盤後 ~17:30 |
| 個股分點買賣超（BSR） | `bsr.twse.com.tw/bshtm/bsMenu.aspx` + 驗證碼 OCR | ✅ | T+0 收盤後 ~21:00 |
| 歷史累計 5/20/60 日 | 自建快照表（每日 cron 落地） | ✅ | 每日一次 |

美股（`asset_class ≠ tw`）整個區塊不渲染。

## 三、後端架構

### 1. 資料表（新增 3 張）

```text
tw_institutional_daily         每日全市場三大法人（T86 落地）
  stock_id, trade_date, foreign_net, trust_net, dealer_net, total_net
  PK (stock_id, trade_date)

tw_bsr_daily                   每日個股分點買賣超
  stock_id, trade_date, broker_id, broker_name, buy_shares, sell_shares, net_shares, avg_price
  PK (stock_id, trade_date, broker_id)

tw_chips_rollup                預先算好的 5/20/60 日累計快照（查詢加速）
  stock_id, as_of_date, window_days, foreign_net, trust_net, dealer_net,
  top_buy_brokers jsonb, top_sell_brokers jsonb, concentration_ratio
  PK (stock_id, as_of_date, window_days)
```

RLS：三張表全部 `authenticated SELECT`；只有 service_role 可寫。

### 2. Edge Functions（新增 4 支 + 復用 1 支）

- `tw-bsr-fetch`：抓 BSR 網頁 → 破解驗證碼 → 解析表格 → upsert 到 `tw_bsr_daily`。單檔股票單次呼叫，可指定 `stock_id` 與 `date`。
- `tw-institutional-daily-sync`：全市場 T86 落地到 `tw_institutional_daily`（復用現有 `checkup-institutional` 邏輯，加上寫入 DB）。
- `tw-chips-rollup-cron`：每日 22:00 跑，重算 5/20/60 日 rollup、找出前 5 買方券商、前 5 賣方券商、集中度。
- `tw-chips-detail`：**前端唯一查詢入口**，輸入 `stock_id` 回傳整合好的籌碼摘要（1/5/20/60 日 + top brokers + 三大法人趨勢）。有 5 分鐘記憶體快取。
- `tw-bsr-backfill`：管理員手動觸發，補抓歷史指定區間。

### 3. 驗證碼 OCR 策略

BSR 頁面的驗證碼是 5 碼英數字扭曲圖：
- **首選**：Deno 環境用 `wasm-tesseract`（純 wasm，無外部依賴），成功率 ~70%
- **失敗自動重試**：最多 3 次不同 session（重抓驗證碼）
- **仍失敗**：寫入 `tw_bsr_fetch_failures` 表，`tw-chips-rollup-cron` 隔天早上再補
- **監控**：`data_source_refresh_logs` 記錄成功率，低於 60% 觸發 `system_alerts`

### 4. 排程（`pg_cron`）

- 17:45 每交易日：`tw-institutional-daily-sync`
- 21:00 每交易日：對「今日至少一位使用者持倉的台股」跑 `tw-bsr-fetch`（避免全市場 1800 檔浪費配額，只跑活躍持倉集合，約 100~300 檔）
- 22:00 每交易日：`tw-chips-rollup-cron`
- 週末不跑

## 四、前端 UI（抽屜內）

在 `HoldingsDetailPanel.tsx` 「§4.5 價格軸」與「§4.8 決策履歷」之間插入新區塊 **§4.6 籌碼面**（僅 `asset_class === 'tw'` 渲染）：

```text
────────────── 籌碼面 ──────────────

三大法人      1日      5日      20日     60日
外資         +2,340   +8,120   +15.2萬   -3.1萬
投信         +150     +820     -1,240    +2,410
自營商       -80      -320     -450      +190
────────────────────────────────
關鍵分點（近 5 日）
買超前 3   富邦 · 台北      +4,120 張
           凱基 · 松江      +2,880 張
           元大 · 敦南      +1,540 張
賣超前 3   摩根大通 · 台北  -3,200 張
           美林 · 台北      -1,980 張
           群益 · 民生      -1,120 張
集中度：買超前 15 大占 68%   ●●●●●○○ 高
```

視覺規範：
- 遵守 [Kore-eda minimal] 與 [Holdings PnL 憲法]：紅=買超（正）/綠=賣超（負，台灣慣例）
- 數字使用 `Number.formatChinese`（張 / 萬張）
- 集中度條用 5 格點狀圖，>70% 標「高（籌碼集中，跟隨風險升高）」
- 資料 `staleAt > 24h` 或缺漏顯示 `— 資料尚未更新`，不顯示 loading spinner 干擾
- 手機 <560px：三大法人折成 2 欄卡片、分點只顯示前 2

### 前端資料層
- 新 hook：`useTwChipsDetail(stock_id, enabled)`，內部呼叫 `tw-chips-detail`
- `useExpertHoldingsBundle` 不動；籌碼是抽屜私有查詢，避免拖慢主表
- SWR 5 分鐘 stale-while-revalidate

## 五、實作順序（分 3 個 PR）

**PR-1（骨架）**：3 張 DB 表 + `tw-institutional-daily-sync` + 抽屜三大法人 UI（先不做 BSR）
**PR-2（BSR）**：`tw-bsr-fetch` + OCR + `tw-chips-rollup-cron` + 抽屜分點 UI
**PR-3（強化）**：手動 backfill 面板（`/company/tw-chips-monitor`）+ 監控告警 + E2E 測試（三大法人渲染、BSR 缺漏 fallback、asset_class 非 tw 不渲染、手機斷點）

## 六、風險與底線

- **BSR OCR 失敗**：允許最多 3 天資料延遲；UI 顯示 `— 待補` 不擋整個抽屜
- **TWSE 限流**：BSR 每次抓帶 3-5 秒延遲、失敗指數退避，只跑活躍持倉集合
- **合規**：TWSE 公開資料轉載需標註「資料來源：臺灣證券交易所」→ 抽屜區塊底部小字加註
- **停止條件**：連續 3 日 OCR 成功率 <50% 觸發告警，管理員可從監控面板一鍵切換到「只顯示三大法人」降級模式

## 七、E2E 覆蓋（依「不准偷懶」原則窮舉）

1. 台股抽屜：三大法人 4 種時間軸都渲染、無 `NaN`／`undefined`
2. 台股抽屜：BSR 前 3 買／前 3 賣、集中度條與百分比
3. 台股抽屜：BSR 缺漏顯示 `— 待補`、不影響其他區塊
4. 美股抽屜：籌碼區塊完全不出現（DOM 不存在）
5. RWD：560/390/380px 三斷點不溢出（沿用現有 helper）
6. Edge function：`tw-bsr-fetch` OCR 失敗 3 次寫入 failures 表、`tw-chips-rollup-cron` 冪等
7. RLS：非登入使用者無法讀取三張表；service_role 可寫
8. Cron：週末不執行、`data_source_refresh_logs` 有完整紀錄
