## 目標
把全站「價格 / 金額 / 日期 / 時間」formatter 的極端輸入合約鎖死：不論收到 `null` / `undefined` / `''` / 純字串 / `NaN` / `±Infinity` / `Number.MAX_VALUE` / `Number.MIN_VALUE` / 負零 / invalid Date / 極端 ISO，都必須**不丟例外**且回傳穩定 sentinel（`—` / `-` / `''` / fallback），絕不輸出 `NaN`、`Invalid Date`、`∞` 或 `NaN/NaN/NaN`。

## 覆蓋清單（完整盤點，禁止漏檔）

| # | 檔案 | 導出函數 | 對應測試檔（新增） |
|---|---|---|---|
| 1 | `src/checkup/lib/checkupFormat.ts` | `fmtSigned` `fmtSignedInt` `fmtWan` `clampReturnBar` `daysBetween` `fmtDate` `fmtMD` | `src/checkup/lib/__tests__/checkupFormat.test.ts` |
| 2 | `src/lib/currency.ts` | `normalizeCurrency` `formatMoneyByCurrency` `formatPriceByCurrency` `isValidSymbol` | `src/lib/__tests__/currency.test.ts` |
| 3 | `src/checkup/utils/formatTaipeiDate.ts` | `formatTaipeiYMD` `formatTaipeiYMDWithFallback` `formatTaipeiYMDHM` `formatTaipeiYMDHMWithFallback` `taipeiMonthStartIso` | `src/checkup/utils/__tests__/formatTaipeiDate.test.ts` |
| 4 | `src/checkup/lib/datetime.js` | `parseStoredDate` `parseFlexibleDate` `formatDateToStorageDate` `daysSince` `formatDateTW` `formatDateMD` `formatTime` `formatDateTime` `getRelativeTime` | `src/checkup/lib/__tests__/datetime.test.ts` |
| 5 | `src/pages/_freeCheckup/constants.jsx` | `fmtN` `formatResetCountdown` `formatResetDateTime` | `src/pages/_freeCheckup/__tests__/quotaFormatters.test.ts` |
| 6 | `src/pages/_backtestMonitor/format.ts` | `fmtDateTime` `fmtPct` | `src/pages/_backtestMonitor/__tests__/format.test.ts` |
| 7 | `src/pages/_companyRevenue/utils.ts` | `fmtMoney` `fmtDate` `fmtDateTime` | `src/pages/_companyRevenue/__tests__/utils.test.ts` |

（7 檔 formatter × 26 導出函數 → 7 個新測試檔）

## 探索階段揭露的既有 bug（測試會 fail → Phase B 修正）

| 位置 | 輸入 | 目前輸出（bug） | 期望 |
|---|---|---|---|
| `fmtN` (constants.jsx) | `NaN` | `"NaN"` | `"—"` |
| `fmtN` (constants.jsx) | `Infinity` | `"Infinity萬"` | `"—"` |
| `fmtWan` (checkupFormat.ts) | `Infinity` | `"∞ 萬"` | `"—"` |
| `formatMoneyByCurrency` | `Infinity` | `"NT$∞"` | `"—"`（統一 sentinel） |
| `fmtPct` (_backtestMonitor) | `NaN` | `"NaN%"` | `"—"` |
| `fmtDate` (_companyRevenue) | `'garbage'` | `"NaN/NaN/NaN"` | `"-"` |
| `fmtDateTime` (_companyRevenue) | `'garbage'` | `"NaN/NaN/NaN NaN:NaN"` | `"-"` |
| `fmtDateTime` (_backtestMonitor) | `'garbage'` | `"NaN/NaN/NaN NaN:NaN"` | `"—"` |
| `formatResetCountdown` (constants.jsx) | `'garbage'` / `NaN` | `"NaN 分鐘後重置"` | `""`（同 falsy 分支） |

## Phase A — 撰寫測試（純新增，不動元件）

每個測試檔用共用矩陣覆蓋以下 12 類極端輸入 + 該 formatter 領域特定 case：

**數值 formatter 矩陣（fmtN / fmtSigned / fmtSignedInt / fmtWan / formatMoneyByCurrency / formatPriceByCurrency / fmtPct / fmtMoney / clampReturnBar）**
1. `null`、`undefined`
2. `NaN`、`Number.NaN`
3. `Infinity`、`-Infinity`
4. `Number.MAX_VALUE`、`-Number.MAX_VALUE`
5. `Number.MIN_VALUE`（極小正）、`Number.EPSILON`
6. `0`、`-0`
7. 字串 `''`、`'abc'`、`'12.5abc'`、`'  '`
8. Boolean `true` / `false`（TS `any` 傳入）
9. 一般正常值：正、負、跨零、小數點四捨五入邊界（1.005 / -0.005）
10. 大整數 `1e15`
11. 中文全形字元字串 `'一二三'`
12. 物件 `{}` / 陣列 `[]`（防守 TypeScript 之外的 runtime 誤傳）

斷言雙保險：
- `expect(() => fn(x)).not.toThrow()`
- `expect(fn(x)).toMatch(SENTINEL_RE)` 或明確 equal 期望 sentinel

**日期 formatter 矩陣（fmtDate / fmtMD / formatTaipei* / formatDateTW / formatDateMD / formatTime / formatDateTime / getRelativeTime / daysSince / parseFlexibleDate / fmtDateTime × 2 / fmtDate × 1 / formatResetDateTime / formatResetCountdown）**
1. `null`、`undefined`、`''`、`'   '`
2. `'garbage'`、`'2026-13-40'`、`'not-a-date'`、`'2026/02/30'`（不存在的日期）
3. `NaN`、Boolean、`{}` `[]`
4. `new Date(NaN)`、`new Date('')`
5. 極端 timestamp：`0`（1970 epoch）、`Number.MAX_SAFE_INTEGER`、`8.64e15`（Date 上界）、`8.64e15+1`（overflow → invalid）、`-8.64e15`、`-8.64e15-1`
6. ISO 邊界：`'1970-01-01T00:00:00Z'`、`'9999-12-31T23:59:59Z'`
7. 閏年：`'2024-02-29'`、`'2100-02-29'`（非閏年，應 fallback）
8. Taipei 跨日：`'2026-01-01T15:00:00Z'`（TW 23:00 vs 隔日）→ 明確斷言 YMD
9. `formatResetCountdown`：`resetsAt` 過去 → `"即將重置"`；1 天以上 / 1 小時以上 / 分鐘 分支各一。
10. `daysSince` / `getRelativeTime`：今天 / 昨天 / 6 天 / 7 天 / 29 天 / 30 天 / 364 天 / 365 天 邊界。
11. `taipeiMonthStartIso`：以固定 `now` 驗證輸出格式 `YYYY-MM-01T00:00:00+08:00`。
12. `parseFlexibleDate`：`'2024/2/9'`（單位數月）、`'2024-02-09'`、Date instance、number timestamp。

**Symbol / normalize 矩陣（normalizeCurrency / isValidSymbol）**
- `normalizeCurrency`：`'USD'` / `'usd'` / `null` / `undefined` / `''` / `{}` / `'JPY'` → 全都應回傳 `'TWD'` 或 `'USD'`（無例外）
- `isValidSymbol`：TW 4/5/6 位數字、含 `L`/`R`/`B` 尾綴、含空白、小寫；US 1-5 字母、含 `.B`、超長字串、含中文、含數字 → 各斷言 true/false

**clampReturnBar 邊界**
- `pct=null` / `NaN` / `0` → `{ratio:0, over:false, sign:0}`
- `40` / `-40` / `41` / `-41` / `Infinity` / `-Infinity` → over 判定
- `scale` 客製為 `20`

**測試工具：** vitest（已在 `vitest.config.ts` 設好）。每檔 30-60 case。

## Phase B — 修正 formatter（依 Phase A 揭露 bug）

### `src/pages/_freeCheckup/constants.jsx`
```js
export const fmtN = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const num = Number(n);
  return Math.abs(num) >= 10000 ? (num/10000).toFixed(1) + "萬" : num.toLocaleString();
};

export function formatResetCountdown(resetsAt) {
  if (!resetsAt) return "";
  const target = new Date(resetsAt).getTime();
  if (!Number.isFinite(target)) return "";
  // ...其餘不動
}
```

### `src/checkup/lib/checkupFormat.ts`
```ts
export function fmtWan(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  // ...其餘不動
}
```
`fmtSigned` / `fmtSignedInt` 亦補 `!Number.isFinite` 保險（現在只擋 `NaN`，未擋 `Infinity`）。

### `src/lib/currency.ts`
```ts
export function formatMoneyByCurrency(n, c = 'TWD') {
  const sym = CURRENCY_SYMBOL[c] || 'NT$';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const v = Math.round(num);
  if (v < 0) return `-${sym}${Math.abs(v).toLocaleString()}`;
  return `${sym}${v.toLocaleString()}`;
}
```

### `src/pages/_companyRevenue/utils.ts`
```ts
export const fmtMoney = (n?: number | null) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return 'NT$0';
  return `NT$${num.toLocaleString()}`;
};
export const fmtDate = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '-';
  // ...
};
export const fmtDateTime = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '-';
  return `${fmtDate(d)} ${...}`;
};
```

### `src/pages/_backtestMonitor/format.ts`
```ts
export const fmtDateTime = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  // ...
};
export const fmtPct = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${(Number(v) * 100).toFixed(1)}%`;
};
```

**不動的檔案（現行實作已充分守護）：**
- `src/checkup/lib/checkupFormat.ts` 的 `fmtDate` / `fmtMD` — 已 `Number.isNaN(x.getTime())` guard
- `src/checkup/utils/formatTaipeiDate.ts` — 已完整 guard
- `src/checkup/lib/datetime.js` — `parseFlexibleDate` 全走 `Number.isNaN(getTime())` guard
- `constants.jsx` 的 `formatResetDateTime` — 已 guard

## Phase C — 執行與驗證

1. `bunx vitest run src/checkup/lib/__tests__/checkupFormat.test.ts src/lib/__tests__/currency.test.ts src/checkup/utils/__tests__/formatTaipeiDate.test.ts src/checkup/lib/__tests__/datetime.test.ts src/pages/_freeCheckup/__tests__/quotaFormatters.test.ts src/pages/_backtestMonitor/__tests__/format.test.ts src/pages/_companyRevenue/__tests__/utils.test.ts` — 期望全綠。
2. `bunx vitest run` — 全域回歸：確保修改 `fmtN` / `fmtWan` / `formatMoneyByCurrency` / `fmtPct` 沒炸現存測試（尤其 `holdings-*` / `_companyRevenue` 相關）。若既有 snapshot 有 `Infinity` 或 `NaN` 字面（不太可能）則檢查後決定修正。
3. **故障注入驗證**：暫時在某 formatter 拿掉 `Number.isFinite` guard，跑 vitest 應立即 fail 於 `Infinity` case，證明測試有攔到；復原後全綠。
4. `tsgo` 檢查 TS 型別（`Number | null | undefined` 拓寬到 `unknown` 傳入時的行為）。

## 不改變的合約
- Sentinel 每個 formatter 保留自己既有 sentinel（checkupFormat 用 `—`、_companyRevenue 用 `-`、Taipei 用空字串 / fallback），不做跨模組統一，避免衝擊 UI 佈局。只在 NaN/Infinity/garbage 時對齊自己模組內的既有 sentinel。
- 不改動函數簽名、不改 export 名稱、不改 CSS。
