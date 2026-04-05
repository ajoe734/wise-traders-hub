# Checkup Module — Design Specification (Finalized)

> 此規範為 `/free-checkup` 頁面的最終設計約束文件。
> 任何 UI 修改必須遵守以下規則。

---

## 1. Theme Token 列表

所有色彩來自 `theme.js` 的 `L` 物件，透過 `const C = ThemeL` 引用。

### 底色系

| Token | 色值 | 用途 |
|-------|------|------|
| `C.bg` | `#F5F3EF` | 頁面底色、sticky header 底色 |
| `C.shell` | `#F2F0EB` | 未使用（與 bg 合併） |
| `C.card` | `#FFFFFF` | input/textarea 背景 |
| `C.subtle` | `#EEEAE4` | 表單展開區背景、disabled 按鈕底色 |

### 文字三階層

| Token | 色值 | 用途 | fontWeight |
|-------|------|------|-----------|
| `C.text` | `#4A4640` | 主文字（股名、標題） | 400 |
| `C.textSec` | `#7A756C` | 次要文字（摘要數值、tab active） | 400 |
| `C.textMute` | `#A8A298` | 標籤、placeholder、inactive tab | 400 |

### 語義色（僅限損益數值）

| Token | 色值 | 用途 |
|-------|------|------|
| `C.up` | `#9E4050` | 正損益數值 |
| `C.down` | `#3A7A5A` | 負損益數值 |

### 分隔

| Token / 寫法 | 用途 |
|--------------|------|
| `C.border` | 主分隔線（`rgba(60,56,48,0.08)`） |
| `alpha(C.textMute,'06')` | 列表行分隔 |
| `alpha(C.textMute,'08')` | 進度條底色 |

---

## 2. Typography 規則

| 層級 | fontSize | fontWeight | 範例 |
|------|----------|-----------|------|
| 頁面標題 | 18px | 400 | 「持倉看板」 |
| 區塊焦點數值 | 20-22px | 500 | Hero 損益、Header 損益 |
| 行內焦點數值 | 12px | 500 | 持股行損益金額 |
| 一般文字 | 12-13px | 400 | 股名、摘要、說明 |
| 標籤 | 10-11px | 400 | Section header、metadata |
| `lbl` 常數 | 11px | 400 | 全域標籤樣式 |

### 禁止

- `fontWeight: 600` — 禁止使用
- `fontWeight: 700` — 禁止使用
- `fontSize > 22px` — 禁止使用

---

## 3. 色彩使用規則

### 允許使用 accent color 的場景

- ✅ 損益金額（`C.up` / `C.down`）
- ✅ 損益百分比（同上，`opacity:0.6-0.7`）
- ✅ 事件/交易分頁的功能按鈕（`C.blue` 等，僅限文字色）

### 禁止使用 accent color 的場景

- ❌ 標籤背景（DEMO、LINE、雲端等）
- ❌ 進度條填充（統一用 `alpha(C.textMute,'20')`)
- ❌ 按鈕背景填充（統一 transparent + border）
- ❌ 分隔線（統一 `C.border` 或 `alpha(C.textMute,'06')`)
- ❌ 狀態指示（到期、警示等，統一 `C.textMute`）

---

## 4. 禁止使用的樣式

| 樣式 | 說明 |
|------|------|
| `boxShadow` | 全面禁止（theme shadow 設為 `none`） |
| `linear-gradient` / `radial-gradient` | 禁止用於背景 |
| `background` 彩色填充 | 按鈕不可用實色填充（`alpha(C.olive,'cc')` 等） |
| Emoji | 禁止（📅🔒⚠️⏳👀） |
| `borderRadius > 8px` | 避免「卡片感」 |
| `borderLeft` 裝飾線 | 禁止（反轉追蹤等區塊） |
| `@keyframes pulse` | 已刪除，禁止重新引入 |

---

## 5. 每個區塊的焦點規則

| 區塊 | 唯一焦點 | 其餘元素 |
|------|----------|---------|
| Header | 右側損益金額（500） | 標題/按鈕/標籤皆 400 |
| Hero | 中央總損益數字（500） | 標籤/百分比 400+opacity |
| Sub-metrics | 無焦點 | 全部 textSec/400 |
| Top5 佔比 | 無焦點 | 全部 textMute |
| 勝敗摘要 | 漲跌色彩（無 fontWeight 強調） | 股名 textSec/400 |
| 持股行 | 損益金額（500） | 股名/代碼/metadata 400 |
| 觀察清單行 | 獲利/虧損狀態文字 | 其餘 textMute/400 |

---

## 6. Alpha 使用規範

所有透明度必須使用 `alpha(C.color, 'xx')` 函式。

禁止：`C.color + "xx"` 或 `` `${C.color}xx` `` 字串拼接。

| alpha 值 | 用途 |
|----------|------|
| `'06'` | 列表行分隔線 |
| `'08'` | 進度條底色、LINE 標籤底色 |
| `'20'` | 進度條填充 |
| `'30'` | Top5 佔比條填充 |
| `'33'`-`'55'` | 事件/交易分頁功能按鈕邊框 |
| `'cc'` | 功能按鈕實色（僅事件/交易分頁） |

---

## 7. 殘留項目（已知，暫不處理）

- 事件/交易/日誌/預測分頁仍使用 `C.blue` accent — 屬於功能色，與持倉/觀察清單的「無色」原則分開管理
- `card` 常數（L117）仍有 `background:C.card` + `border` — 用於表單區塊，不違反規範
- `lbl` 常數已統一為 `fontWeight:400`
