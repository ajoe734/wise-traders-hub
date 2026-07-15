# Plan：Footer / PriceTrack DOM 快照回歸

## 目的
用 vitest `toMatchInlineSnapshot` 鎖住 `HoldingCardFooter` 與 `HoldingCardPriceTrack` 在關鍵組合下的 DOM 結構與可見文字，防止未來 refactor 意外改動 class / grid 定位 / badge 文案 / decText 截斷。

## 檔案
新增：
- `src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCardFooter.snapshot.test.tsx`
- `src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCardPriceTrack.snapshot.test.tsx`

不動元件源碼。使用 `container.firstChild` 的 `toMatchInlineSnapshot()`；快取整段 markup 於檔案內，人審友善。

## Footer 快照矩陣（12 case）

軸：
- `variant`：`normal` / `ink`
- `priceSource` badge 分流：`live` / `screenshot` / `demo` / `yclose` / `null`（`priceError` 觸發 errBadge）
- 補充：`hasToday=false` / `todayPnl<0` / `showTgt=true` 三個獨立情境

| # | variant | priceSource | priceError | 其他 |
|---|---------|-------------|------------|------|
| 1 | normal  | live        | -          | 基準 |
| 2 | normal  | screenshot  | -          | badge 走 muteColor 支 |
| 3 | normal  | demo        | -          | badge 走 lossColor 支（非 live/非 screenshot）|
| 4 | normal  | yclose      | -          | 同上，label='昨收' |
| 5 | normal  | null        | '報價逾時'  | errBadge=失敗 |
| 6 | normal  | null        | null       | 完全無 badge |
| 7 | ink     | live        | -          | ink live tint |
| 8 | ink     | screenshot  | -          | ink 非-live 支 |
| 9 | ink     | null        | '網路錯誤'  | ink errBadge |
| 10 | normal | live        | -          | `hasToday=false` → today 節點=「—」 |
| 11 | normal | live        | -          | `todayPnlNum=-800`、`todayPctNum=-1.23` → 負號無 `+` |
| 12 | ink    | live        | -          | `tp=120, upside=8.5` → `.wb-bottom-val` 內含 `TGT +8.5%` |

固定共用 props：
```
h.value=123456, h.price=100.5, h.yesterday=99, h.priceUpdatedAt='2026-01-01T02:30:00Z'
hasToday=true, todayPnlNum=500, todayPctNum=1.23（除 10/11）
subColor='#292520', muteColor='#8A857F', hairColor='#EEE', lossColor='#8A857F'
```

## PriceTrack 快照矩陣（8 case）

軸：
- `variant`：`normal` / `ink`
- `dec.actionText`：無 / 短句（<40字）/ 超長（觸發 truncateAction 截尾＋…）
- `meta.strategy`：無 / 有（測試 fallback）

| # | variant | dec.actionText | meta.strategy | 預期焦點 |
|---|---------|----------------|---------------|----------|
| 1 | normal  | '維持持有'      | 'STRAT'       | decText='維持持有' |
| 2 | normal  | null           | 'STRAT'       | fallback = strategy.slice(0,40) |
| 3 | normal  | null           | null          | decText='' |
| 4 | normal  | 超長 80 字＋句號 | null          | 走標點斷句 + '…' |
| 5 | ink     | '維持持有'      | 'STRAT'       | ink layout（min-height 48、gap 18）|
| 6 | ink     | null           | null          | ink fallback = '持續監控基本面與籌碼變動。' |
| 7 | ink     | 超長 120 字     | null          | limit=90 截尾 |
| 8 | normal  | '維持持有'      | 'STRAT'       | `h.cost=null, h.price=null` → 顯示 '—' 兩處 |

固定共用 props：
```
h={ cost:100, price:123 }, subColor='#292520', muteColor='#8A857F'
```

## 實作重點
- 用 `render()` + `container.firstChild` → `toMatchInlineSnapshot()`；首跑 vitest 會自動填入 snapshot literal，之後就會鎖住。
- 每個 case 一個 `it()`，命名含 variant + badge，方便 diff 定位。
- 不斷言完整 style 物件字串（React 已把 style 展開成 `style="..."` attr，會被 snapshot 完整收錄——本來就是我們要鎖的）。
- 不做視覺截圖（Playwright 那條路已由 sparkline-width-parity 覆蓋）；此處純 DOM/HTML 快照，跑得快、review 直觀。

## 驗收
```
bunx vitest run src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCardFooter.snapshot.test.tsx \
                src/checkup/components/freecheckup/_ui/holdingCard/__tests__/HoldingCardPriceTrack.snapshot.test.tsx
```
首跑 → 自動寫入 inline snapshot；二跑 → 20 tests 全綠、無 snapshot 更新。
再跑既有 Footer/PriceTrack derived/refStability 測試確認沒回歸。
