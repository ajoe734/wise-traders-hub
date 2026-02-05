

# 頁首提示條：前往網頁版查看完整績效

## 設計目標

在 LINE 版績效頁面的標題區塊下方，新增一條低調的提示條，引導用戶知道可以到網頁版查看更詳細的績效分析。

---

## 視覺設計

```text
┌─────────────────────────────────────────────────────────┐
│  📊 策略成績單                                           │
│  趙朋伯 • 五族共和策略                                   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  💻  想看更詳細？網頁版有完整圖表分析  →          │    │  ← 新增的頁首提示條
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  📋 T+7 教學用資料                               │    │
│  │  以下為一週前策略示範帳戶...                     │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  [整體成績總覽]                                         │
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 元件規格

| 項目 | 規格 |
|------|------|
| **位置** | 標題區塊與 T+7 提示（或第一個 Card）之間 |
| **背景** | `bg-muted/30 dark:bg-white/[0.04]` |
| **邊框** | `border border-border/50` |
| **圓角** | `rounded-lg` |
| **內距** | `px-3 py-2.5` |
| **圖示** | `Monitor` (lucide-react) |
| **文字** | 主文：`text-sm`，箭頭：`ExternalLink` 或 `ChevronRight` |

---

## 互動行為

| 動作 | 行為 |
|------|------|
| **點擊** | 開啟新分頁，導向網頁版績效頁面 |
| **目標網址** | 完整網址 (published URL) + `/app/performance`，使用 `window.open()` |

---

## 檔案變更

### 修改 `src/components/strategy/PerformanceOverviewPanel.tsx` 或 `src/pages/line/Performance.tsx`

由於此提示條是 LINE 版專屬，最適合放在 `src/pages/line/Performance.tsx` 頁面層級。

#### 新增 import

```tsx
import { Monitor, ChevronRight } from 'lucide-react';
```

#### 新增提示條元件（內嵌）

在 Header 區塊的 `</div>` 結束後、第一個 `<Card>` 之前插入：

```tsx
{/* Web Version Hint */}
<button
  onClick={() => window.open('https://wise-traders-hub.lovable.app/app/performance', '_blank')}
  className="w-full flex items-center gap-3 px-3 py-2.5 bg-muted/30 dark:bg-white/[0.04] border border-border/50 rounded-lg text-left hover:bg-muted/50 dark:hover:bg-white/[0.08] transition-colors"
>
  <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
  <span className="text-sm text-muted-foreground flex-1">
    想看更詳細？網頁版有完整圖表分析
  </span>
  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
</button>
```

---

## 替代方案：使用 `<a>` 標籤

如果希望更語義化，可改用 anchor：

```tsx
<a
  href="https://wise-traders-hub.lovable.app/app/performance"
  target="_blank"
  rel="noopener noreferrer"
  className="flex items-center gap-3 px-3 py-2.5 bg-muted/30 dark:bg-white/[0.04] border border-border/50 rounded-lg hover:bg-muted/50 dark:hover:bg-white/[0.08] transition-colors"
>
  <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
  <span className="text-sm text-muted-foreground flex-1">
    想看更詳細？網頁版有完整圖表分析
  </span>
  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
</a>
```

---

## 完整佈局順序（修改後）

1. Header（標題 + 專家名稱）
2. **Web Version Hint（新增）**
3. T+7 教學用資料提示（如有）
4. 整體成績總覽 Card
5. 其餘績效區塊...

---

## 修改檔案清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/pages/line/Performance.tsx` | 修改 | 在 Header 下方新增網頁版提示條 |

