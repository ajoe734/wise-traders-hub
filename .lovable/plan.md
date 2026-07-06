# 族群分佈 chip → 展開對應個股

## 需求
`HoldingsSectorSummary`（`/holding-checkup` 持倉分頁 Hero 下方那塊 off-white 區塊）目前三排 chip：
- 產業分佈（依市值）
- 題材曝險（依檔數）
- 策略（依檔數）

目前是純顯示。使用者要**點任一 chip → 就地在該區塊下方展開屬於這個族群的個股清單**（不用滾到下面的卡片牆）。

## 互動規格
- 每個 chip 改成 `<button>`，`aria-pressed` 標記選中狀態。
- 同一時間只選一個 chip；再點一次同 chip = 取消（收合列表）。
- 點另一個 chip = 切換選取（列表跟著換）。
- 選中的 chip 加深底色 + 加左側 dot（保留日式 minimal 樣式）。
- chip 上加細字 caret「▾」提示可點。

## 展開列表（selected 存在時渲染）
inline 卡片式清單，貼在對應區段下方：

```text
選中：光通訊 (產業)                                     [清除]
─────────────────────────────────────────
2454 聯發科   市值 8.2%   +12.3%   ← 多族群 30%
3037 欣興     市值 6.1%   -3.4%
6446 藥華藥   市值 5.7%   +21.0%
```

每列顯示：
- 代號 + 名稱（`stockMeta[code]?.name`）
- 該檔對本族群的貢獻百分比：
  - 產業：`marketValue * weight / totalIndustryValue`（用 revenueMix 拆分後的權重）
  - 題材／策略：顯示該檔占總持倉市值%
- 損益% + 台股慣例配色（紅漲綠跌）
- 若為多族群持股：右側灰字標「拆 xx%」

列表本身：
- 依貢獻%由大到小排序
- 最多 12 檔，超過折疊成「⋯ 還有 n 檔」
- 空清單：顯示「此族群目前無個股」
- 手機（<560px）密度更緊，字級 11px

## 實作範圍
### `src/checkup/lib/holdingUtils.js`
新增純函式：
```
holdingsInSector(holdings, stockMeta, overrides, { kind, key })
  → Array<{ code, name, marketValue, pctOfSector, weight, pnlPct, isMulti }>
```
- `kind: 'industry' | 'theme' | 'strategy'`
- 產業用 revenueMix/industries 拆分權重；題材/策略直接命中即納入權重 = 1。
- 排序：`pctOfSector desc`。

配套 unit test（新增 `src/test/holdingsInSector.test.ts`）：
- 單族群命中
- 多族群依 revenueMix 拆分（權重 30% 只算 30%）
- 題材命中 = 全額
- 未命中 = 空陣列
- 未分類邊界

### `src/checkup/components/freecheckup/HoldingsSectorSummary.tsx`
- 加入 `useState` 選中 `{ kind, key } | null`
- 三個區塊的 chip render 抽成小函式，統一改成 button + `aria-pressed`
- 新增 `SectorDrilldown` 子元件（同檔內），接收 `selected`、`holdings`、`stockMeta`、`overrides`、`C`、`alpha`，呼叫 `holdingsInSector` 渲染
- 產業條那 6px 長條也可點：hover cursor pointer、click = 選該產業（bonus，實作簡單）

### `src/checkup/components/freecheckup/HoldingsTab.tsx`
現有 props 已足夠，不需改動。

## 不做的事
- 不改下方 `HoldingsFilterBar` 或卡片牆 filter，兩者獨立（本地 inline 展開就好，不動全域 filter，避免使用者一鍵就把卡片牆過濾掉造成困惑）。
- 不動 aggregate 邏輯與警示訊息。
- 不改配色 / 版面骨架。

## 驗證
1. `bun run test src/test/holdingsInSector.test.ts` 全綠。
2. `/holding-checkup` 手動：
   - 點「光通訊 3檔」→ 下方跳出 3 檔並含拆分%
   - 點「AI伺服器 7」（題材）→ 跳出 7 檔
   - 點「成長股 8」（策略）→ 跳出 8 檔
   - 再點同 chip → 收合
3. 手機 390/560 斷點視覺無溢出（跑既有 `e2e/freecheckup-card.spec.ts`）。
