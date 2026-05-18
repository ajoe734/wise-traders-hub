# A1 — FreeCheckup bootstrap 重構 + chunk 分析

## 1. Bootstrap 重構（已完成）

抽出 `src/hooks/useFreeCheckupBootstrap.js`：

- `useHoldingsMigration()` — 一次性 `pf-holdings-v2-migrated` localStorage 清理
- `useFreeCheckupBootstrap({...})` — auth-ready → demo / cloud-first / local fallback
  + trade_memos 拉回 + 衍生事件重建
- `useFetchCalendarEventsRef(fn)` — 包 ref 避免 hook 依賴循環

`src/pages/FreeCheckup.jsx`：
- 移除 123 行 inline bootstrap effect（758–880 → 14 行 hook call）
- 移除 8 個僅供 bootstrap 用的 imports（`SEED_HOLDINGS / DEMO_BRAIN /
  INIT_TARGETS / loadAllFromCloud / loadScopedLocal / loadLocal /
  setCurrentUserId / setLocalStorageOwner`）
- 行數：**3,595 → 3,486**（−109）
- inline 憲法：未動 L2965/L4745 `<style>` 字面 + `.wb-card` 持倉看板

## 2. Chunk 分析（esbuild --splitting，externals 已扣）

| Chunk | Size | 觸發時機 |
|---|---:|---|
| **FreeCheckup.js**（入口）| **287.6 KB** | 首屏必載 |
| HoldingsTab | 93.8 KB | tab=holdings（預設） |
| shared (chunk-34IA…) | 51.7 KB | 多 tab 共用 |
| DailyTab | 36.0 KB | tab=daily |
| EventsTab | 34.1 KB | tab=events |
| TradeTab | 33.5 KB | tab=trade |
| NewsTab | 17.6 KB | tab=news |
| HoldingsDetailPanel | 13.0 KB | 點開持倉 |
| TargetPriceHistorySection | 6.8 KB | TP 區段 |
| LogTab | 6.2 KB | tab=log |
| CoachMarks | 4.6 KB | 新手導覽 |
| Md | 3.7 KB | Markdown 渲染 |

**lazy 已節省**：~250 KB 從首屏延後

### 首屏 chunk 內 top inputs（287.6 KB 拆解）

```
153.7 KB  FreeCheckup.jsx          ← 主檔本體（仍是最大宗）
 31.5 KB  react-helmet-async       ← SEO 元件
 19.2 KB  _freeCheckup/constants
 15.3 KB  checkup/data/demoData    ← ⚠ demo 模式才需要，可動態 import
  8.4 KB  holdingEventUtils
  7.4 KB  edgeInvoke
  7.1 KB  edgeSchemas
  5.6 KB  edgeFieldUI
  5.2 KB  edgeCoerce
  5.2 KB  useFreeCheckupBootstrap  ← 本次新增
  5.1 KB  DemoBanner
```

### 後續可摘的低垂果實（不在 A1 範圍）

1. **demoData 動態載入** — 15.3 KB，可在 `useFreeCheckupBootstrap`
   `if (isDemo)` 分支用 `await import()` 載入，非 demo 用戶 0 成本
2. **react-helmet-async** 31.5 KB — 改用 lightweight `<title>` setter 或
   `react-helmet-async/lib/index.js` 個別子模組
3. **edgeSchemas / edgeFieldUI / edgeCoerce** 共 ~18 KB — 抽 worker 或
   lazy import 至 parse-flow 時點
4. 主檔本體 153.7 KB — 持倉看板 + Hero + 配額 modal 仍 inline，受
   inline 憲法限制不外移；可考慮把 quota/refund/coverage 三個 modal
   抽 lazy 子元件再省 20–30 KB

## 3. 驗證

- 無 JSX 動到，inline `<style>` 合約區（`wb-hero-grid` / `.wb-card`）
  字面字串原樣保留
- bootstrap 行為等價：cleanup flag、cancelled guard、setter 順序皆比照
- imports 已收斂，無未用 symbol
