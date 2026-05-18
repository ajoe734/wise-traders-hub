## 效能 / 可維護性 — 剩餘缺口盤點

下面是目前還沒做、且 ROI 較高的項目。已完成的（Legal eager、routePrefetch 清理、manualChunks 拆分、prod console drop、tab 拆 5/6）不再列。

---

### A. FreeCheckup.jsx 收尾（最大維護債）

現況：3973 行 / 186KB / 121 個 hook、5 個 Tab 已拆但 **TradeTab 還沒拆**，且容器本身仍塞滿 runtime composer、CoachMarks 排程、prompt 模板、debug 視窗。

A1. **拆出 TradeTab**（剩下唯一一個 inline tab，依 memory 約束 L2965/L4745 `<style>` 字面字串不可外移，其餘 JSX/handler 可走 props 注入模式，比照其他 5 個 tab 已驗證的合約）。
A2. **抽出 runtime hooks 群**：把 `useAppRuntimeComposer` (33KB) 的呼叫包成 `useFreeCheckupRuntime()`，讓 FreeCheckup.jsx 只剩「容器 + tab 切換 + style 硬合約」。
A3. **debug / dev-only 區塊用 `import.meta.env.DEV` gate 並動態 import**，避免 prod bundle 帶 dev panel。

驗收：FreeCheckup.jsx ≤ 1500 行；`bunx playwright test e2e/freecheckup-card.spec.ts` + 560/390/380 RWD 清單通過。

---

### B. 大檔案拆分（>40KB 頁面）

下列頁面都 >40KB 單檔，re-render 與閱讀成本都高：

- `admin/Signals.tsx` (66KB)、`Checkout.tsx` (60KB)、`company/KnowledgeBase.tsx` (53KB)、`Index.tsx` (51KB)、`company/Revenue.tsx` (49KB)、`Pricing.tsx` (48KB)、`admin/SignalEditor.tsx` (42KB)、`company/Payments.tsx` (37KB)、`company/Plans.tsx` (33KB)

B1. 為每個檔案抽出「資料 hook + 子區塊元件」到同層 `./_parts/` 或 `./_hooks/`。先做流量最高的 `Index.tsx`、`Checkout.tsx`、`Pricing.tsx`。
B2. `Index.tsx` 把 hero 以外的 section 全部 `lazy + LazyOnVisible`（已有元件可重用）。

---

### C. Bundle / 載入效能

C1. **`recharts` route-level lazy**：目前 `vendor-recharts` chunk 被 admin/company 多頁共用，但 portal `Index` / `Pricing` 沒用到卻可能被 prefetch 鏈帶入；確認 dynamic import 路徑乾淨。
C2. **`@tiptap` 只在 SignalEditor / RichTextEditor 內 lazy**：檢查 `LazyRichTextEditor` 是否真的延後到互動才載入（目前 `vendor-tiptap` 體積大）。
C3. **`lucide-react` icon tree-shake 檢查**：`vendor-lucide` 是手動合併 chunk，若某些頁只用 3-5 個 icon，改 `import { X } from "lucide-react/icons/x"` 可直接 tree-shake，砍掉 `vendor-lucide` 共用 chunk。
C4. **預連接 / preload LCP**：`index.html` 加 `<link rel="preconnect" href="<supabase-url>">` 與首頁 hero 圖 `rel="preload" as="image" fetchpriority="high"`。
C5. **route prefetch 節流**：`prefetchHighTrafficRoutes` 在 `requestIdleCallback` 內逐個 import，確認沒在低階手機塞滿主執行緒。

驗收：用 `/company/perf-metrics` 看 LCP/FCP 7 天分位，B+C 後 P75 LCP 應 < 2.5s。

---

### D. React re-render / state 熱點

D1. **`AuthContext`** 是否把整包 user/session/profile 放同一個 value？拆成 `AuthStateContext`（變動少）+ `AuthActionsContext`（穩定 ref），避免每次 token refresh 全 app re-render。
D2. **`PortfolioPanelsContext`、`CheckupModeContext`** 同樣審視 value 物件是否 `useMemo`。
D3. **`useSignalRealtimeInvalidation`** 確認 channel 只 subscribe 一次、unmount 有 unsubscribe，避免重複 invalidate。
D4. **大列表**（admin/company subscribers、payments、analysts）若 >200 列，導入 `@tanstack/react-virtual`（已在 vendor-tanstack chunk）。

---

### E. Edge Functions 維護債

- `knowledge-backtest/index.ts` 28KB 單檔；其他 supabase/functions 也應檢視。
E1. 共用邏輯抽到 `supabase/functions/_shared/`（已有資料夾，但使用率不一）：DB client、auth check、CORS、error envelope 全部統一。
E2. 加 `EdgeFunctionLogger` wrapper，所有 fn 一致寫入 `function_logs`（`/company/function-logs` 已有 UI）。
E3. 列出沒有對應測試的 fn，補 `supabase--test_edge_functions` 最低保 happy path。

---

### F. 型別 / Lint / Dead code

F1. `rg "any"` 在 src 內統計濫用，逐檔收斂（保留 `validateProps.js` 等明確 any）。
F2. `npx knip` 或 `ts-prune` 跑一次找未使用 exports（特別是 `src/checkup/lib/index.js` re-export 大集合，可能拖 tree-shake）。
F3. `src/lib/refundProcessor.ts` 只是 re-export `supabase/functions/_shared/refundProcessor`，這種跨界 import 在 client bundle 會把 edge code 拉進來；改成「共用純函式放 `src/lib/`、edge 從 lib import」單向依賴。

---

### G. 測試 / CI 加固

G1. RWD 清單 + i18n 檢查已有 script，但 `.github/workflows/freecheckup-rwd.yml` 是否阻擋 merge？確認 required check。
G2. 為 D1 拆 context 之前先寫 `AuthContext` re-render 計數測試（render counter component）作為 baseline。
G3. Edge function 失敗（E2）後自動寫 `function_logs` 的 vitest 用 supabase mock 補測。

---

### H. 觀測 / 回饋迴路

H1. `PerfMetricsTracker` 目前蒐 FCP/LCP，加上 **INP** 與 **CLS**（web-vitals 已是輕量，可同檔擴充）。
H2. `/company/perf-metrics` 加「依路由分位數」表，定位是哪頁拖累 P75。
H3. 加「bundle size 趨勢」CI step：`vite build --report` 後寫一份 size json 進 artifact，PR diff > 50KB 警告。

---

### 建議實作順序（依 ROI）

1. **A1+A2** — FreeCheckup 收尾（解最大維護債、影響日常開發速度）
2. **D1** — AuthContext 拆分（全 app re-render）
3. **C3+C4** — lucide tree-shake + preconnect（LCP 立即見效）
4. **F3** — refundProcessor 跨界 import（避免 edge 程式碼污染 client bundle）
5. **B1** — 大頁面拆分（Index → Checkout → Pricing）
6. **H1+H3** — 觀測 INP/CLS + bundle 趨勢（建立回饋迴路）
7. **E1+E2** — Edge function 共用層
8. 其餘長尾

要我先開哪一塊？建議從 1（A1 TradeTab）或 2（AuthContext 拆分）起手。
