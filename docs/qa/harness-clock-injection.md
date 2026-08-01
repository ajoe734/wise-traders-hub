# Harness 時鐘注入策略（ChipsSection E2E）

> 單一實作：`src/checkup/lib/harnessClock.ts`
> 單元測試：`src/checkup/lib/__tests__/harnessClock.test.ts`
> 使用端：`src/pages/ChipsSectionHarnessEntry.tsx`（route `/e2e/chips-section`）
> 視覺回歸：`e2e/chips-section-visual.spec.ts`

## 為什麼要有這份東西

「新鮮度」相關斷點（STALE badge、`更新於 N 分鐘前`）是全站唯一會**隨時間改變畫面**
的 UI。過去 harness 就地手刻時間覆寫，出現兩類間歇性失敗：

1. `force=stale` 與 `freezeTime` 各自覆寫 `Date.now`，後註冊者把前者蓋掉 → 位移失效。
2. `stale` 由 `useFreshness` 的 ticker 決定（最短 5s 才跳一次），只前推 `Date.now`
   不會觸發 re-render → badge 在測試窗內來不及亮，或亮起後被自動重抓吃掉。

因此時間注入被抽成有明確**權重規則**、可單元測試、可被任何 harness 復用的工具。

## 覆寫規則與權重（高 → 低）

| 權重 | 輸入 | 行為 |
| --- | --- | --- |
| 1 | `mode: 'fresh'`（`force=fresh`） | 強制新鮮：時鐘釘死在 `freshAt ?? fixedNow ?? anchor`，**永不位移**、不壓縮 ticker、`shiftNow()` 為 no-op → `stale` 恆為 false |
| 2 | `mode: 'stale'`（`force=stale`） | `staleAfterMs`（預設 800）後把 `offset` 加上 `staleShiftMs`（預設 6 分鐘 = TTL 5 分 + 1），同時把 ticker 的 5s / 30s `setTimeout` 壓成 `tickCompressMs`（預設 120ms） |
| 3 | `fixedNow`（`now=<epochMs\|ISO>`） | 把 `Date.now` 的 base 釘死在指定時刻，不隨真實時間前進 → 相對時間文字完全決定論 |
| 4 | `freeze`（`freezeTime=1`） | 沒給 `fixedNow` 時，凍結在 install 當下的 anchor |
| 5 | 皆未給 | 不安裝任何覆寫，`install` 回傳 `active: false` 的 no-op |

規則要點：

- **fresh 勝過 stale**。`force=stale,fresh`（任意順序、`,` / `+` / 空白分隔）一律解析成 `fresh`。
  理由：`fresh` 是明確宣告「這個斷點不准過期」，比預設的位移行為更強。
- **base 與 offset 正交**：`Date.now() = base() + offset`。base 由 fixedNow / freeze /
  真實時間決定，offset 只由 stale 位移改動。兩者不再互踩。
- **只壓縮 freshness ticker 的間隔**（`TICKER_INTERVALS_MS = [5000, 30000]`），
  其他 `setTimeout` 的 delay 原封不動，避免順手改壞 debounce / 動畫。
- **`uninstall()` 必須呼叫**，會完整還原 `Date.now` 與 `setTimeout`。React 端在
  `useEffect` cleanup 還原；單元測試在 `afterEach` 還原。

## Harness URL 參數

```
/e2e/chips-section
  ?code=2330
  &force=offline|stale|fresh      # 可逗號組合，fresh > stale
  &freezeTime=1                   # 凍結在 mount 當下
  &now=<epochMs|ISO>              # 固定時鐘注入（優於 freezeTime）
  &staleAfter=<ms>                # 位移延遲，預設 800
  &staleShift=<ms>                # 位移量，預設 360000
  &visibility=hidden|visible      # 分頁可見性覆寫（預設：force=stale→hidden，其餘 visible）
```

Harness 對外訊號（spec 用來取代 `waitForTimeout`）：

| 屬性（在 `chips-harness-root`） | 意義 |
| --- | --- |
| `data-stale-shifted="1"` | 位移已實際套用 |
| `data-fixed-now="1"` | 時鐘已被釘死 |
| `data-visibility="hidden\|visible"` | 目前的可見性覆寫值 |

Spec 可用 `window.__harnessSetVisibility('visible'|'hidden')` 於執行期切換，
會同步 dispatch `visibilitychange`，`useTwChipsDetail` 的 listener 才跟得上。

`visibility=hidden` 是 STALE 快照的保護傘：`useTwChipsDetail` 的
`planAutoRefresh` 在 `!visible` 時回 `paused` 不排程；反之 stale 一亮就被自動
重抓刷新 `fetchedAt`（= `query.dataUpdatedAt`，真實時鐘），badge 會熄滅。
`force=fresh` 不需要這招。

## 測試端使用規範（STALE 斷點）

`e2e/chips-section-visual.spec.ts` 的 STALE 斷點採三道保險，新增同類斷點請照抄：

1. **固定時鐘注入** — `now=Date.parse(FROZEN_FETCHED_AT)`，讓相對時間文案決定論，
   不必再 mask「更新於 …」。
2. **決定論等待** — 等 `data-stale-shifted="1"`，不睡固定秒數。
3. **快照鎖定** — 先斷言 badge 可見 + 文案為固定的「6 分鐘前」+ 500ms 後仍未熄滅，
   再 `toHaveScreenshot({ animations: 'disabled', maxDiffPixelRatio: 0 })`，
   並對該 describe 設 `test.describe.configure({ retries: 2 })`。

### STALE 視覺回歸矩陣（#10）

`visibility` × auto revalidate 回應延遲 兩個變數的完整組合，確保 badge 不會被
auto revalidate 意外吃掉（或反過來，該熄滅時沒熄滅）：

| 案例 | visibility | 重抓回應延遲 | 期望 | 快照 |
| --- | --- | --- | --- | --- |
| A | hidden | 0ms | 不排程（請求數恆為 1），badge 永久亮、文案「6 分鐘前」 | `chips-badge-stale-hidden.png` |
| B | visible | 3000ms | 重抓飛行中 `fetchedAt` 未更新 → badge 仍亮 | `chips-badge-stale-refreshing.png` |
| C | visible | 0ms | 重抓完成後 badge 熄滅、文案回「剛剛更新」，請求數 > 1 | —（行為斷言） |
| D | hidden → visible | 0ms | 切換前恆亮且無請求；切換後才被 revalidate 收掉 | —（行為斷言） |

首發請求一律立即回應，只對第 2 次（含）之後的請求加延遲，避免初次載入被拖慢。


## 復用到其他 harness

```ts
import { installHarnessClock, resolveMode, parseEpoch } from '@/checkup/lib/harnessClock';

const clock = installHarnessClock({
  mode: resolveMode(params.get('force')),
  fixedNow: parseEpoch(params.get('now')),
  freeze: params.get('freezeTime') === '1',
  onShift: () => setShifted(true),
});
// cleanup
clock.uninstall();
```

禁止在新的 harness 裡再手刻 `Date.now = ...` 或 `window.setTimeout = ...`；
需要新語義（例如 `force=ancient`）就加到 `harnessClock.ts` 並補單元測試。
