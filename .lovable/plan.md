

# 網頁版提示條：深色對比配色方案

## 設計目標

將現有的低調灰色提示條改為深色對比風格，讓它在淺色頁面中更加醒目突出。

---

## 視覺對比

| 項目 | 現況 | 修改後 |
|------|------|--------|
| **背景** | `bg-muted/30` (淺灰) | `bg-foreground` (深色/黑色) |
| **邊框** | `border-border/50` | 移除或改為透明 |
| **圖示** | `text-muted-foreground` (灰色) | `text-background` (淺色/白色) |
| **文字** | `text-muted-foreground` (灰色) | `text-background` (淺色/白色) |
| **Dark mode 背景** | `bg-white/[0.04]` | `bg-white` (反轉為亮色) |

---

## 修改內容

### 檔案：`src/pages/line/Performance.tsx`

將提示條的 className 從：

```tsx
className="flex items-center gap-3 px-3 py-2.5 bg-muted/30 dark:bg-white/[0.04] border border-border/50 rounded-lg hover:bg-muted/50 dark:hover:bg-white/[0.08] transition-colors"
```

改為：

```tsx
className="flex items-center gap-3 px-3 py-2.5 bg-foreground dark:bg-white rounded-lg hover:opacity-90 transition-opacity"
```

圖示與文字顏色從：

```tsx
<Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
<span className="text-sm text-muted-foreground flex-1">
<ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
```

改為：

```tsx
<Monitor className="h-4 w-4 text-background dark:text-foreground shrink-0" />
<span className="text-sm text-background dark:text-foreground flex-1">
<ChevronRight className="h-4 w-4 text-background dark:text-foreground shrink-0" />
```

---

## 視覺效果預覽

```text
Light Mode:
┌─────────────────────────────────────────────────┐
│  ████████████████████████████████████████████  │
│  █  💻  想看更詳細？網頁版有完整圖表分析  →  █  │  ← 黑底白字
│  ████████████████████████████████████████████  │
└─────────────────────────────────────────────────┘

Dark Mode:
┌─────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░  💻  想看更詳細？網頁版有完整圖表分析  →  ░  │  ← 白底黑字
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└─────────────────────────────────────────────────┘
```

---

## 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/pages/line/Performance.tsx` | 修改 | 更新提示條為深色對比配色 |

