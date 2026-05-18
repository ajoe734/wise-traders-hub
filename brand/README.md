# legendflow Brand Kit

完整規範請打開 [`brand-kit.html`](./brand-kit.html)（v1 · 2026-05-18）。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `brand-kit.html` | 完整品牌規範（命名、字標、色票、不要這樣用、套用情境） |
| `legendflow-wordmark-ink.svg` | 主版字標 · 米/白背景 |
| `legendflow-wordmark-bone.svg` | 深色版字標 · 墨黑背景 |
| `legendflow-wordmark-cta.svg` | 主橘前景字標 · 米/白背景，橘點自動翻墨黑 |
| `legendflow-wordmark-mono.svg` | 單色版（`fill="currentColor"`）· 印刷／浮水印 |
| `legendflow-favicon-16.svg` | 16px tab icon · 純橘點 |
| `legendflow-favicon-32.svg` | 32px favicon · `l●f` |
| `legendflow-favicon-64.svg` | 64px · `l●f` |
| `legendflow-favicon-180.svg` | 180px Apple touch icon |
| `legendflow-favicon-512.svg` | 512px PWA / maskable |
| `legendflow-og-1200x630.svg` | Open Graph social card |

## 在 React 用

```tsx
import { Logomark, Wordmark, BRAND } from '@/components/brand';

<Logomark size={28} />
<Wordmark size={15} tone="ink" />
```

完整 props 與規則寫在 `src/components/brand/`。Color tokens 從 `BRAND` 取，**不要** 在 component 寫死 hex。

## 核心規則（違反請回去看 brand-kit.html）

1. 字標全小寫、無空格、無連字號。
2. 橘點是裝飾、不是字元；除「背景是 CTA 橘」外一律 `#EC662D`。
3. 必須 serif（Source Serif 4 → Noto Serif TC → Georgia）。**禁用** Inter/Helvetica/Arial。
4. 禁描邊、禁漸層、禁加箭頭/K 線/任何金融圖標。
5. 字標最小寬度 120px；低於改用 `Logomark` 方塊。
