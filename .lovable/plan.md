# 配額顯示與升級路徑強化

讓使用者「**隨時知道還剩幾次、什麼時候重置、撞上配額時下一步該做什麼**」。

---

## 一、新增常駐配額卡（Quota Meter）

在持倉看板分頁頂部（`tab==="holdings"` 區塊最上方，Demo 提示之後）放一張極簡卡，**所有登入使用者皆可見**，沒撞限額時也會顯示，讓人一眼知道剩幾次。

```text
┌──────────────────────────────────────────┐
│  Pro · 本月 AI 健檢                  3 / 22 │
│  ████████░░░░░░░░░░░░░░░░░░░ 14%        │
│  距離重置：6 天 14 小時（5/01 00:00 重置）  │
│  截圖解析・收盤分析・新聞彙整・事件預測共用 │
└──────────────────────────────────────────┘
```

- **進度條**：`used / limit`，顏色用 `C.teal`；剩餘 ≤ 20% 變 `C.amber`；= 0 變 `C.down`。
- **倒數**：以 `quota.resets_at` 算「天/小時」（自然週/月，UTC+8），每 60 秒重算。
- **層級徽章**：Free / Basic / Pro，沿用 `tierLabel`。
- **CTA**：Free / Basic 右上角放小字「升級 →」，連到 `/checkup-checkout`。Pro 不顯示。
- 採守舊極簡風（off-white #F5F3EF、無陰影、字級 ≤ 22px）。

---

## 二、配額用盡時的清楚提示

改寫現有 `hasReachedDailyLimit && !isDemo` 區塊（約 5283 行），讓三層分流訊息更明確：

| Tier | 標題 | 副標 | CTA |
|---|---|---|---|
| Free | 本月 1 次 AI 健檢已用完 | `MM/DD HH:mm` 重置・想立即繼續？升級 Basic（每週 1 次）或 Pro（每月 22 次） | `升級方案`（藍）/ `查看方案`（次） |
| Basic | 本週 1 次 AI 健檢已用完 | 下週一 00:00 重置・升級 Pro 即可每月 22 次 | `升級 Pro`（藍） |
| Pro | 本月 22 次 AI 健檢已用完 | `MM/DD 00:00` 重置 | （無 CTA，僅倒數） |

副標的「重置時間」直接讀 `quota.resets_at` 並用 `YYYY/MM/DD HH:mm` 格式（依專案日期規範）。

---

## 三、429 攔截：把所有 AI 入口的失敗轉譯

目前收盤分析（line 1980）等 AI 呼叫只把 429 標成 `AI_RATE_LIMITED`，沒區分「平台限流」和「個人配額用完」。後端 RPC `consume_checkup_quota` 拋 `QUOTA_EXCEEDED` 會回 429 + `code: 'QUOTA_EXCEEDED'`。

新增 helper `handleQuotaError(res, body)`：
- 若 `body.code === 'QUOTA_EXCEEDED'` 或 `body.error?.includes('QUOTA_EXCEEDED')`：
  1. 呼叫 `refreshQuota()` 同步最新狀態。
  2. 直接彈出**配額不足 Modal**（不是 toast）：標題「本{週/月} AI 健檢配額已用完」、層級、`used/limit`、重置倒數、升級 CTA、「我知道了」。
  3. 不寫進 `dailyLastError`（因為這不是錯誤，是設計）。
- 其他 429 沿用既有平台限流邏輯（顯示 `AI_RATE_LIMITED`）。

接入點（4 個 AI 入口都要包）：
- `runDailyAnalysis`（收盤分析，line ~1980）
- `parseShot`（截圖解析，搜 `parseShot` / `checkup-parse` 呼叫處）
- 事件預測（搜 `checkup-predict-events`）
- 系統審視 / 深度研究（搜 `checkup-research`）

按鈕點擊前的本地預檢已有 `hasReachedDailyLimit`，這層是「本地以為有配額但伺服器拒絕」的兜底。

---

## 四、按鈕狀態同步

- 收盤分析按鈕（line 4711–4723）：
  - `hasReachedDailyLimit` 時除了「🔒 今日配額已用完」改成 `🔒 本{週/月}配額已用完`，副標補一行「{倒數} 後重置」並加上 `升級` 連結（Pro 略過）。
- 手動刷新按鈕：Free 點擊時除了現有訊息，加「升級 Basic 解鎖手動刷新」連結。

---

## 技術細節

### 檔案
- `src/pages/FreeCheckup.jsx`
  - 新增 `<QuotaMeter />` inline 區塊（遵守[inline rendering 限制](mem://architecture/checkup/inline-rendering-audit)，不抽 component）
  - 新增 `<QuotaModal />` inline 區塊（撞限額 modal）
  - 新增 helper：`formatResetCountdown(resetsAt)`、`handleQuotaError(res)` 
  - 改寫 5283 區塊與按鈕文案
- `src/checkup/contexts/CheckupModeContext.jsx`
  - 既有的 `quota.resets_at`、`refreshQuota`、`applyQuotaFromResponse` 已足夠，無需改 schema

### RWD（強制依 [手機回歸清單](mem://qa/checkup/freecheckup-mobile-regression-checklist)）
- QuotaMeter：560/390/380px 三斷點要驗 — 進度條與「3/22」字數不換行；CTA 不被切。
- 任何 inline `fontSize` ≥ 32 都要附 className + `<style>` media query；本次預期最大 22px，安全。
- 新增的 className 需加入既有的 `.wb-card` 等樣式表，不另開 stylesheet。

### 不會動的東西
- 不改 RPC 邏輯、不改 edge function、不改資料表。
- 不抽 component（FreeCheckup inline 限制）。
- 顏色不違反[損益顏色憲法](mem://style/holdings/monochrome-orange-pnl)（QuotaMeter 不是損益，可用 teal/amber/down）。

---

## 驗收

1. 持倉看板頂部任何時刻看得到「Tier · used/limit · 倒數」。
2. 撞 429 + `QUOTA_EXCEEDED` 會跳 Modal 而不是丟錯誤碼。
3. Free / Basic 都看得到「升級」按鈕直達 `/checkup-checkout`。
4. 三斷點（560/390/380）截圖無 overflow。
