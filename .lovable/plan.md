
# /free-checkup Demo 模式一致性審計

只有 `/free-checkup` 一條路由是訪客（demo）入口；登入後會跳到 `/app/...`、`/checkup/...` 走 `PortfolioLayout` + 子頁，與 demo 無關。所以「每個頁面」實際上是這頁的六個分頁 tab。

## 一、現況逐 tab 盤點

| Tab | 資料來源 | 是否打 Edge | 「登入解鎖」說明 | 行為一致性 |
|---|---|---|---|---|
| 持倉 (`holdings`) | `INIT_HOLDINGS` (demo) | ❌ 但 sparkline (1514) 仍會打 → 401 | ✅ 配額卡片（3055） | ⚠️ sparkline 漏守 |
| 行事曆 (`events`) | `DEMO_CALENDAR` + 模擬延遲（858） | ✅ 已守 | ❌ **沒有** demo 說明 | ⚠️ 「↻ 立刻更新行事曆 / ↻ 立刻預測事件」按鈕在 demo 仍可按；雖然 fetch 已守，但 UI 未告知這是示範 |
| 事件分析 (`news`) | `DEMO_EVENTS`（622 初始化） | ✅ 已守（1043, 1323） | ❌ **沒有** demo 說明卡 | ⚠️ 缺 demo 提示 |
| 收盤分析 (`daily`) | `DEMO_ANALYSIS` + 4 步模擬（1938） | ✅ 主流程已守 | ❌ **沒有** demo 說明卡 | ⚠️ 缺 demo 提示 |
| 上傳成交 (`trade`) | — | ✅（2572 守） | ✅ 有 demo 提示卡（5667） | ✅ OK |
| 交易日誌 (`log`) | 空陣列 | ❌ | ❌ 無 demo 說明 | ⚠️ 訪客只看到「還沒有交易記錄」，無從得知這是 demo |

## 二、會打到後端造成 401 的真正漏網之魚

`grep callEdge` 共 8 處，逐一檢查：

| 行 | Edge | demo 守門 | 備註 |
|---|---|---|---|
| 892 | checkup-calendar | ✅ 858 已 return | OK |
| 1352 | checkup-predict-events | ✅ 1323 已 return | OK |
| **1514** | **checkup-sparkline** | ❌ **未守** | 持倉變動就打，demo 仍會 401（雖 silent，但會在 Network 噴錯） |
| **1853** | **checkup-twse**（refreshPrices） | ❌ **未守** | 「查看價格 / 刷新」按鈕在 demo 可按 → 直接 401，這就是用戶剛剛遇到的「沒有畫面」 |
| 2003 | checkup-twse（runDailyAnalysis 內） | ✅ 1938 守在前面 | OK |
| 2138 | checkup-analyze | ✅ 1938 守在前面 | OK |
| 2266 | checkup-analyze (brain) | ✅ 1938 守在前面 | OK |
| 2598 | checkup-parse | ✅ 2572 守 | OK |

另：`refreshPrices` 還會被自動呼叫兩處（581 server-sync 完成後、2703 解析後），但這兩處只在已登入流程觸發，不影響 demo。

## 三、修補計畫（一次補完）

### A. 補上 demo 守門（避免 401 / 黑屏）

1. **`refreshPrices` (1827)** — 函式開頭加 demo 分支：
   - 若 `isDemo`：以 `simulateSteps` 跑 1.5–3 秒「擷取 TWSE 即時報價...」「比對昨收計算漲跌...」，結束後對 `holdings` 各檔做小幅隨機 ±0.5%~±2% 模擬「即時報價」、更新 `lastUpdate=new Date()`、`setSaved('DEMO 模擬報價已更新')`，**不打** edge。
   - 這同時修掉用戶剛剛回報「點查看價格沒畫面」。

2. **Sparkline effect (1506)** — 在 `if (!H || H.length === 0) return;` 後加 `if (isDemo) return;`，demo 不抓 sparkline（圖表本來就裝飾用，無 sparkline 不影響資料完整性）。

### B. 在「行事曆 / 事件分析 / 收盤分析 / 交易日誌」四個 tab 加入統一 demo 說明卡

新增一個就地常數元件 `DemoTabNotice`（直接 inline 在 FreeCheckup.jsx 內，符合 mem://architecture/checkup/inline-rendering-audit 規範），文案隨 tab 切換：

| Tab | 標題 | 說明 |
|---|---|---|
| events | 這是 DEMO 行事曆 | 顯示的法說、營收、除息日為示範資料。登入後會根據你的真實持倉自動抓取財報行事曆與 AI 事件預測。 |
| news | 這是 DEMO 事件分析 | 範例事件已套用策略大腦邏輯。登入後 AI 會即時抓取個股新聞、進行事件影響評估與命中率追蹤。 |
| daily | 這是 DEMO 收盤分析 | 點「開始今日收盤分析」會以模擬延遲呈現範例報告。登入後系統會根據你的實際持倉與盤後資料生成個人化分析。 |
| log | 這是 DEMO 交易日誌 | 訪客看到的是空白範本。登入後上傳成交截圖即可自動寫入交易日誌與 Q&A 反思。 |

每張卡片都包含：「LINE 登入解鎖」 + 「Email 登入」兩個按鈕（沿用 startLineLogin / `/auth/login?redirect=/checkup`）。

### C. 「行事曆」tab 的兩個 ↻ 按鈕

`manualRefreshCalendar` / `runPredictEvents(true)` 雖然底層 callEdge 已守，但仍應在 demo 點下時改顯示「DEMO 模式無法手動更新；登入後可即時抓取」toast，避免靜默假裝有效。實作上在兩個按鈕的 `onClick` 開頭加 `if (isDemo) { showDemoLockToast(); return; }`。

### D. demoData.js 維護機制（確認既有）

- `DEMO_DATA_VERSION = '2026-05'` 已在；`DemoBanner` 在 >60 天時顯示「示範資料更新中」。
- `scripts/refresh-demo-data.mjs` + `docs/demo-data-maintenance.md` 已存在，每月手動跑一次更新即可。本次審計不需改動。

## 四、技術細節（給工程實作）

```
src/pages/FreeCheckup.jsx
  1506 useEffect sparkline → 開頭加 isDemo 早 return
  1827 refreshPrices()    → 開頭加 isDemo 模擬分支
  4644 / 4655 行事曆 ↻ / 事件 ↻ 按鈕 onClick → demo lock toast
  4608 events tab、5098 daily tab、6116 log tab、6203 news tab
       → 在 tab 容器頂端加 {isDemo && <DemoTabNotice kind="events|news|daily|log" />}
```

## 五、不做什麼

- 不重構任何元件抽出（mem 規範禁止），全部 inline 加。
- 不更動 `CheckupModeContext`、`DemoBanner`、`demoSimulate.js`。
- 不動 `src/checkup/pages/*` 子頁（那些是登入後 PortfolioLayout 用，跟 demo 無關，已確認無 callEdge 直呼）。
- 不調整路由（`/free-checkup` 仍是唯一 demo 入口）。

---

審計確認：以上六個 tab、八個 callEdge 點、兩個手動按鈕、demo 資料更新機制全數覆蓋，無遺漏。是否照此計畫實作？
