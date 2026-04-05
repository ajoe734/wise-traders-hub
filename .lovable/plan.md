

# Phase 1：Light Theme Migration 基底切換

## 修改檔案

### 檔案 1：`src/checkup/theme.js`

新增 `L` 物件（Light palette）並 export：

```js
export const L = {
  bg:        "#F5F3EF",
  shell:     "#EDE9E3",
  card:      "#FFFFFF",
  cardHover: "#F8F6F2",
  subtle:    "#F0ECE6",
  subtleElev:"#E8E4DE",
  border:    "rgba(60,56,48,0.08)",
  borderSub: "rgba(60,56,48,0.04)",
  borderStrong:"rgba(60,56,48,0.15)",
  borderSoft:"rgba(60,56,48,0.05)",
  shadow:    "0 2px 12px rgba(60,56,48,0.08)",
  insetLine: "inset 0 1px 0 rgba(60,56,48,0.03)",
  shellShadow:"0 4px 20px rgba(60,56,48,0.10)",

  cardBlue:  "#F0F3F8",
  cardAmber: "#F8F5F0",
  cardOlive: "#F0F5F2",
  cardRose:  "#F8F0F2",

  text:      "#3C3830",
  textSec:   "#7A746A",
  textMute:  "#B0A99E",

  up:        "#B5485A",
  upBg:      "rgba(181,72,90,0.06)",
  down:      "#3A8A66",
  downBg:    "rgba(58,138,102,0.05)",

  blue:      "#5A88B8",
  blueBg:    "rgba(90,136,184,0.07)",
  cyan:      "#4A98B0",
  cyanBg:    "rgba(74,152,176,0.05)",
  amber:     "#A68530",
  amberBg:   "rgba(166,133,48,0.07)",
  orange:    "#B07848",
  orangeBg:  "rgba(176,120,72,0.06)",
  teal:      "#3A8F78",
  tealBg:    "rgba(58,143,120,0.06)",
  mint:      "#3AA080",
  mintBg:    "rgba(58,160,128,0.06)",
  olive:     "#6A9A60",
  oliveBg:   "rgba(106,154,96,0.06)",
  lavender:  "#7A70B8",
  lavBg:     "rgba(122,112,184,0.06)",
  rose:      "#B06878",
  roseBg:    "rgba(176,104,120,0.06)",
  choco:     "#9A7030",
  chocoBg:   "rgba(154,112,48,0.06)",
  stone:     "#8A8478",
  urgent:    "#B5485A",
  onFill:    "#FFFFFF",
  focusRing: "0 0 0 2px rgba(58,143,120,0.20)",

  fillTeal:   "#3A8F78",
  fillTomato: "#B5485A",
  fillChoco:  "#9A7030",
};
```

### 檔案 2：`src/pages/FreeCheckup.jsx`

#### 改動 1：切換 theme 指向（第 8, 58 行）
- 第 8 行：`import { C as ThemeC, A, alpha } from ...` → `import { C as ThemeC, L as ThemeL, A, alpha } from ...`
- 第 58 行：`const C = ThemeC;` → `const C = ThemeL;`

#### 改動 2：`lbl` 常數（第 118 行）
- `fontWeight:600` → `fontWeight:400`

#### 改動 3：刪除 `@keyframes pulse`（第 1315 行）
- 刪除整個 `@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`

#### 改動 4：所有 `C.color+"xx"` 替換為 `alpha()`

完整清單（含之前遺漏的 events/trade 分頁內的）：

| # | 行號 | 原寫法 | 改為 |
|---|------|--------|------|
| 1 | 1340 | `C.amber+"22"` | `alpha(C.amber,'22')` |
| 2 | 1348 | `C.blue+"14"` | `alpha(C.blue,'14')` |
| 3 | 1350 | `C.blue+"33"` | `alpha(C.blue,'33')` |
| 4 | 1502 | `C.olive+"22"` | `alpha(C.olive,'22')` |
| 5 | 1503 | `C.olive+"55"` | `alpha(C.olive,'55')` |
| 6 | 1555 | `C.olive+"cc"` | `alpha(C.olive,'cc')` |
| 7 | 1735 | `TYPE_COLOR[t]+"33"` | `alpha(TYPE_COLOR[t],'33')` |
| 8 | 1737 | `TYPE_COLOR[t]+"66"` | `alpha(TYPE_COLOR[t],'66')` |
| 9 | 2134 | `C.amber+"66"` | `alpha(C.amber,'66')` |
| 10 | 2210 | `C.olive+"cc"` | `alpha(C.olive,'cc')` |
| 11 | 2210 | `C.blue+"cc"` | `alpha(C.blue,'cc')` |
| 12 | 2282 | `C.teal+"cc"` | `alpha(C.teal,'cc')` |
| 13 | 2401 | `C.olive+"99"` | `alpha(C.olive,'99')` |
| 14 | 2401 | `C.up+"99"` | `alpha(C.up,'99')` |
| 15 | 2402 | `predC(e.pred)+"55"` | `alpha(predC(e.pred),'55')` |
| 16 | 2489 | `C.oliveBg+"88"` | `alpha(C.olive,'08')` |
| 17 | 2489 | `C.upBg+"88"` | `alpha(C.up,'08')` |
| 18 | 2490 | `C.olive+"44"` | `alpha(C.olive,'44')` |
| 19 | 2490 | `C.up+"44"` | `alpha(C.up,'44')` |
| 20 | 2502 | `${C.blue}33` | `alpha(C.blue,'33')` |
| 21 | 2513 | `C.olive+"22"` | `alpha(C.olive,'22')` |
| 22 | 2513 | `${C.olive}55` | `alpha(C.olive,'55')` |
| 23 | 2566 | `C.olive+"cc"` | `alpha(C.olive,'cc')` |
| 24 | 2665 | `C.blue+"cc"` | `alpha(C.blue,'cc')` |

共 24 處（比原估 19 處多 5 處，因為 events filter buttons、復盤教訓、復盤送出、新增事件按鈕也有）。

#### 不做的事
- 不改 layout / spacing / 文案
- 不改 `#fff` 硬編碼（屬於 Phase 2 對比系統調整）
- 不改 LINE 登入按鈕的 `#06C755`（品牌色，不屬於 theme）
- 不新增任何美學優化

