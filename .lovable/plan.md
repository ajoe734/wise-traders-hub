
# 全站效能與可維護性改善計畫

掃過 480 個前端檔 + 71 個 edge functions + 175 條 migrations 後，列出真正會影響使用者體驗或長期維護成本的問題，依「影響大、改動小」的順序分四批執行。

---

## 一、立即改善（高 ROI、低風險）— Batch 1

### 1. Hero 影音與圖檔瘦身（首屏體感）
| 檔案 | 目前 | 問題 | 動作 |
|---|---|---|---|
| `public/videos/hero-bg.mp4` | **4.4 MB** | 即使已 `preload="none"`、idle 才掛 source，行動網路仍會吃光額度 | 用 ffmpeg 重壓 H.264 CRF 30 + AAC 96k；同時輸出 `webm`（VP9 CRF 35），`<source>` 依序提供。目標 ≤ 1.2 MB |
| `src/assets/hero-bg.png` | **1.7 MB** | 同時存在但似乎沒被引用 | 確認後刪除 |
| `src/assets/vs-brush-alpha.png` / `vs-brush-transparent.png` | **935 + 894 KB** | 兩張內容疑似重複；PNG 但用於裝飾 | 留一張，轉 WebP（預期 < 80KB） |
| `src/assets/template-step2-mentor.png` | 889 KB | PNG | 轉 WebP |
| `card-kungfu-bones/speed.webp` | 227 / 194 KB | 仍偏大 | `cwebp -q 75 -resize 1200 0` |

預期：首頁傳輸量 −5 MB 以上，LCP 在 3G 約 −1.2s。

### 2. Index.tsx idle prefetch 重複呼叫
`src/pages/Index.tsx` 內自己 `requestIdleCallback` 預載 Experts/Pricing/Login，又跑 `prefetchHighTrafficRoutes()`（在 `AttributionTracker`），兩者重複。
→ 移除 Index.tsx 內聯版本，集中由 `routePrefetch.ts` 管理；可順手把 `expert-profile`、`app-home` 加入清單。

### 3. lucide-react icon 拆 chunk
`Index.tsx` 一次 import 15 個 icon，但 vite 沒對 `lucide-react` 強制分塊（vite.config 註解寫 P5-C 已移除），icon barrel 會被打進 Index chunk。建議：
- 改為命名子路徑：`import Shield from "lucide-react/dist/esm/icons/shield"` 或
- 重新加入 `if (id.includes("lucide-react")) return "vendor-lucide"`

二者擇一即可，預期 Index chunk gzipped −15~25 KB。

### 4. console.* / debug 殘留
- `src/pages/FreeCheckup.jsx` 15 處、`auth/LineCallback.tsx` 14 處、`Checkout.tsx` 10 處 `console.log/warn/error`。
- 加 `vite` 設定：`esbuild.drop = ['console','debugger']` 僅在 production 移除，保留 `console.error`（透過 `pure` 機制白名單）。一行設定，零侵入。

---

## 二、結構性重構（中風險）— Batch 2

### 5. `src/pages/FreeCheckup.jsx`（4513 行）
記憶體中明訂「不可拆元件」（依賴 inline 渲染），但 **可拆的**：
- 29 個 `useEffect` + 93 個 `useState` → 抽出純 hooks（`useFreeCheckupPersistence`、`useFreeCheckupHeroState`、`useFreeCheckupSubscription`）放 `src/checkup/hooks/freecheckup/`，主檔只留 JSX。
- 不違反「inline rendering 憲法」，因為只搬狀態邏輯不搬 JSX。
- 同步補對應 unit test（已有 `freecheckup-tab-perf.test.tsx`、`freecheckup-mobile-card-overflow.test.ts` 作回歸保護）。

### 6. 大型管理頁去 `any`
| 檔 | any 數 |
|---|---|
| `pages/company/KnowledgeBase.tsx` | 41 |
| `pages/admin/Signals.tsx` | 31 |
| `pages/company/BacktestMonitor.tsx` | 26 |
| `pages/admin/SignalEditor.tsx` | 22 |

→ 從 `src/integrations/supabase/types.ts` 拉 `Database['public']['Tables'][...]['Row']` 取代 `any`，每檔 PR 規模可控（< 200 行 diff）。全站 520 處 `any` 預估第一輪可砍 60%。

### 7. Index.tsx（1058 行）拆 section
仿 `index-sections/MobileCarousels.tsx` 模式，依首屏/二屏拆：
- `IndexHero.tsx`（eager）
- `IndexFeatures.tsx`（eager）
- `IndexLeaderboard.tsx`、`IndexFaq.tsx`、`IndexCta.tsx`（`LazyOnVisible`）

主檔縮到 < 200 行，二屏以下不影響首屏 JS。

---

## 三、查詢與資料層（持續性效能）— Batch 3

### 8. 補齊 React Query 命中率
近期 `useExpertDetailBundle` 已示範「seed peer caches」模式。同樣模式套到：
- `useExperts` ↔ `useExpert`：list 頁的卡片資料應 seed `['expert', slug]`，避免進詳情頁再打一次。
- `useMemberSubscriptions` 在 `AppLayout` 已抓，但 `AppHome/Explore/ExpertDetail` 仍各自 query → 統一改吃 context 或共用 queryKey。

### 9. `staleTime` 校準
`queryClient.ts` 預設 `staleTime: 5min`，但 `useExperts` / `useExpert` / `useExpertSubscriptionStats` 各自又設 30~60s，覆蓋了預設。確認 SLA 後拉齊（建議公開頁 60s、登入頁 30s）。

### 10. `supabase/functions/` 71 支共用程式碼
`_shared` 已存在，但抽樣看 `checkup-*` 12 支 edge function 仍各自重複 CORS / Auth / Supabase client 初始化樣板。建議補一支 `_shared/handler.ts`：
```ts
export const withCors = (h) => async (req) => { ...handle OPTIONS... return h(req) }
export const withSupabase = (h) => async (req) => { ... }
```
不必一次全改，新功能用、舊的 touch 到就改。

---

## 四、長尾整理（低急迫）— Batch 4

### 11. 175 條 migration 壓平
不會刪 history，但可：
- 在 `supabase/migrations/` 旁建 `_archive/` 放 2025/12 之前的舊 migration（CI 不執行，只供翻閱）。
- 同時產出一份 `schema-snapshot.sql` 當參考。
新人 onboarding 看 schema 從 3000 行 types.ts 改成讀 snapshot。

### 12. 移除/合併未使用的 UI primitives
`src/components/ui/` 有 52 檔（shadcn 全套）。實際引用掃描後砍掉 0 次引用者（保留檔案會被打進 chunks 是迷思，但會增加 IDE/lint 工作量）。

### 13. PerfMetrics 儀表板加報警閾值
你已建 `/company/perf-metrics`，但目前只顯示 p50/p75/p95。再加：
- 紅燈閾值（LCP > 2.5s, FCP > 1.8s）
- 「過去 24h 比前一天惡化」標記
這樣本計畫上線後可以用自己的儀表板驗收。

---

## 技術細節（給工程實作）

- **影片轉檔**（Batch 1.1）：
  ```bash
  ffmpeg -i hero-bg.mp4 -vf "scale=1280:-2" -c:v libx264 -crf 30 -preset slow -an -movflags +faststart hero-bg.mp4.new
  ffmpeg -i hero-bg.mp4 -vf "scale=1280:-2" -c:v libvpx-vp9 -crf 35 -b:v 0 -an hero-bg.webm
  ```
- **drop console**（Batch 1.4）：`vite.config.ts` → `esbuild: { drop: mode === 'production' ? ['console','debugger'] : [] }`，並用 `pure: ['console.error']` 避免錯誤回報被吃掉。
- **lucide chunking**（Batch 1.3）：vite.config.ts `manualChunks` 加：
  ```ts
  if (id.includes("lucide-react")) return "vendor-lucide";
  ```
- **FreeCheckup 拆 hook**（Batch 2.5）：所有抽出的 hook 都要符合「inline rendering audit」記憶 — 只搬 state/effect，**不可** 搬 JSX 或創造新 component。

---

## 執行順序建議

| Batch | 改動規模 | 風險 | 預期收益 |
|---|---|---|---|
| 1（資產 + 設定） | 小 | 低 | 首頁 LCP −1s、JS −25KB |
| 2（重構） | 中 | 中 | FreeCheckup 可維護性↑、any −300 |
| 3（資料層） | 中 | 低 | 詳情頁 round-trip −50% |
| 4（清理） | 小 | 低 | 長期維護成本↓ |

每個 batch 跑完都用 `/company/perf-metrics` 對比 RUM 數據驗收，符合「不准偷懶」核心規範要求的「驗證閉環」。
