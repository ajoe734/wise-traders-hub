# /expert/:slug 改版：對齊設計圖

## 目標
讓 `/expert/:slug`（公開專家頁）符合設計圖：在 Hero 之下、績效之上，新增「策略簡介」區段，內含**投資風格**與**交易系統**兩張並排卡片。

## 改動概覽

### 1. 資料層（DB migration）
`experts` 表新增 3 個欄位（皆 nullable，不破壞現有資料）：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `risk_preference` | text | 風險偏好（保守 / 穩健 / 積極） |
| `operation_cycle` | text | 操作週期（短線 / 波段 / 長線） |
| `strategy_name` | text | 交易系統名稱（例：「價值持有 — 高股息選股」） |

`strategy_summary` 既有欄位繼續使用，當作交易系統卡的「一句話描述」。

### 2. 編輯介面
兩處後台表單同步加入欄位：
- `src/pages/admin/Profile.tsx`（分析師自編）
- 公司管理端對應 experts 編輯入口（若有）

UI：兩個 select（風險、週期）+ 一個 input（strategy_name）。

### 3. 公開頁版面 `src/pages/ExpertProfile.tsx`

```text
┌─────────────────── Hero（保留）──────────────────┐
│  Avatar  Name + RoleBadge                       │
│         bio / 社群佐證                           │
└──────────────────────────────────────────────────┘

── 策略簡介 ─────────────────────────────────────
┌──────────────────┐  ┌──────────────────┐
│ 投資風格          │  │ 交易系統          │
│ • 風格標籤        │  │  strategy_name    │
│ • 主要市場        │  │  strategy_summary │
│ • 風險偏好        │  │                   │
│ • 操作週期        │  │                   │
└──────────────────┘  └──────────────────┘

── 績效總覽（保留現有 PerformanceOverviewPanel）──
── 訂閱方案（保留）──────────────────────────────
```

- 桌機 `md:` 兩欄並排，手機單欄堆疊
- 卡片採極簡 Kore-eda 風（off-white、無陰影、border 0.06）
- 標題 `策略簡介` 用既有 `SectionHeader`

### 4. 型別與 hook
- `src/types/index.ts`：`PersonWithPlans` 加 `riskPreference`、`operationCycle`、`strategyName`
- `src/hooks/useExpert.ts`：`mapToPersonWithPlans` 新增三欄映射
- `src/integrations/supabase/types.ts` 自動更新

### 不動
- Hero、績效面板、訂閱方案區塊內容邏輯
- `/app/expert/:slug`（會員端）暫不改，避免一次動太多
- 既有 `style_tags` / `markets` 仍以 badge 呈現於投資風格卡

## 驗證
1. Migration 後 admin 編輯 → 公開頁顯示新欄位
2. 舊資料（無 risk_preference）卡片需有 fallback「—」或隱藏該列
3. 手機 390/560px 不溢出
4. `bun run build` 通過
