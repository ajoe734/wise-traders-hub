# IG → 老師 → 每週交付 → 證據 → 方案 漏斗改造（修訂版 v2）

**本次 Schema 變更 = 0。RLS = 0。RPC/view/table/field/migration = 0。deploy = 0。Publish = 0。**

## 相對 v1 已刪除的項目（明列）

| 已刪除 | 原因 |
|---|---|
| `useExpertPublicRhythm.ts`：前端 direct SELECT `trade_records` 算最近週次／筆數 | 擴大匿名資料面，且 policy 需再驗。**整條刪除**，不以任何形式保留 |
| Phase 4 公開 teaser 資料介面（原寫死 SECURITY DEFINER RPC） | 移出本次實作；改列 Future 且**不預設實作形式**，須另案 security design |
| Phase 5 `expert_signals.forward_watchlist` / `forward_conditions` 欄位 | 移出本次實作，列 Future / Not approved |
| `checkout?plan=…` 假路徑 | 實際路徑為 `/checkout/:slug/:planId`（`src/App.tsx:280`） |
| 新事件 `select_plan` / `checkout_start` | 與既有 `expert_subscribe_click` / `checkout_open` 重複，改為擴充 props |
| 「因法規所以週五公開」式敘述 | 屬法律結論，禁用 |
| 未 scope 的全域 `--ev-*` token | 改為 `.evidence-surface` 作用域 |

---

## A. 資料真相（已用唯讀查詢／live network 佐證）

### 只准使用的資料來源（Phase 1-3 白名單）

| 來源 | exact call | 提供什麼 |
|---|---|---|
| 名師清單 | `useExperts()` → RPC `get_public_experts_list`（`src/hooks/useExpert.ts:153`） | id / name / slug / role / bio / description / markets / style_tags / avatar_url / starting_capital / strategy_summary / expert_plans[]。**payload 實測不含 `asset_class`** |
| 名師詳情 | `useExpertDetailBundle(slug)` → RPC `get_expert_detail_bundle`（`src/hooks/useExpert.ts:251`） | `to_jsonb(experts.*)` 整列 → **含 `asset_class`** + plans + subscriber_count + my_subscribed_plan_ids |
| 績效 | 既有 `PerformanceOverviewPanel` + `src/contracts/publicProjection.ts` | fail-closed 遮蔽，`UNAVAILABLE_LABEL`／`REVIEW_BADGE` |
| 公開時程 | `src/lib/publishingWindow.ts` 的 `nextPublishMomentLabel(assetClass)` / `marketOfAssetClass()` | TW → 「週五 20:00」；US → 「週六 08:00」 |
| 週界線 | `src/lib/taipeiWeek.ts` | 顯示用日期格式 |

**禁止**：任何新的 `supabase.from('trade_records' | 'expert_signals' | …)` 匿名查詢；任何新的 RPC/view。

### 目前不存在的資料（不得發明）

1. 匿名可讀的週記節錄 — `expert_signals` 無 anon policy（已查 `pg_policies`）。→ 只做**結構樣本**（欄位骨架 + 「訂閱後可見」），不是假 sample、不含任何老師原文。
2. 最近公開週次／本週筆數 — 既有兩支 RPC 都不回傳。→ 顯示「每週固定更新」文字，**不顯示任何數字**。
3. 前瞻欄位 — `expert_signals` 只有復盤語意欄位。→ 前台只描述「會員每週會拿到的結構」。

### 每位老師的 cadence 真相（point 5）

`experts.asset_class` 實測值：sharkgu / master-brcto / master-brian = `tw_stock`；master-zhou / benny = `us_stock`；master-lever = `us_option`。

規則：
- `/expert/:slug`：bundle 已含 `asset_class` → 呼叫 `nextPublishMomentLabel(expert.assetClass)`，US 老師顯示「每週六 08:00」，TW 顯示「每週五 20:00」。**需在 `mapToPersonWithPlans` 補 `assetClass` 欄位（前端 mapper only，無 DB 變更）**。
- `/experts` 卡片：list RPC 無 `asset_class` → 一律顯示「每週固定更新」，**不得硬寫週五 20:00**。
- 首頁：無 teacher context → 「每週固定更新」。

---

## G. Phase 0 文案契約（不擋案，可執行）

新增 `src/lib/complianceCopy.ts`（純字串 + 依 `assetClass` 取 cadence 句，無 DB）。Phase 1-3 直接使用下列 code-truth 可支持的中性文案：

- `當週操作復盤`
- `下週觀察框架：研究清單、觀察條件、風險情境`
- `內容依平台固定週次公開；教學研究用途，非買賣建議`
- cadence 句一律由 `nextPublishMomentLabel()` 產生，或退回「每週固定更新」

**禁用字**：推薦、跟單（mentor 文案內）、保證、目標價、下週出手、以及任何「因法規所以…」的法律結論；不得把 `published_at` 或週界線說成逐筆 T+7。

同時產 `docs/compliance/copy-diff.md`，只作**記錄與待人工確認清單**，不阻擋 Phase 1-3：
- `Experts.tsx:85`、`ExpertProfile.tsx:130/139/143`、`JournalCard.tsx:84` 的「T+7 / 延遲 7 天以上」與 `publishingWindow.ts` 的「週五 20:00 / 週六 08:00 統一發布」語意不一致 → 標為 **需人工法遵確認**。
- 訂閱後內容區（`JournalCard`、訂閱頁）本次**不動文案**，避免在未確認前改動已上線合約語句。
- 既有免責「教學研究用途／不構成投資建議」保留，集中到 `complianceCopy.ts` 供 marketing 頁引用。

---

## B. IG 漏斗（exact routes）

```text
IG link  ?utm_source=ig&utm_medium=bio&utm_campaign=<slug>
   ├─ /s/:slug  (App.tsx:278 inline redirect)  → 必須把整串 query 原封帶到 /expert/:slug
   └─ /expert/:slug   ← 主承接頁（單一主 CTA）
          │ Delivery 三卡 → 公開時程 → 結構樣本 → Evidence(既有 panel) → 適合/不適合 → 方案
          ▼
      /checkout/:slug/:planId?utm_source=…&utm_campaign=…   ← exact route (App.tsx:280)
   /experts  = 比較頁（CTA 單一：進老師頁）
   /pricing  = 理解頁（outcome → 機制 → 價格 → 健檢次級 CTA）
   /holding-checkup = 第二步工具（核心不改，僅接受次級 CTA 進入）
```

UTM 保留由新增純函式 `src/lib/preserveUtm.ts`（whitelist：utm_source/medium/campaign/content/term）負責，套用在 `/s/:slug` 轉址、`/experts` 卡片連結、`/expert/:slug` 的 plan CTA。first-touch 落地維持既有 `trafficTracker.ts:171-175`，不改。

---

## C. 頁面 wireframe

### /expert/:slug（分層：主張 vs 真資料 — point 11）

1. **首屏價值條**：名字 + RoleBadge + 一句交付 + cadence 句（來自 `nextPublishMomentLabel(assetClass)`）。
2. **Delivery 三卡**（標示為「會員每週會得到的結構」，非 sample）：`當週操作復盤`／`下週觀察框架`／`風險與部位條件`。
3. **結構樣本**：欄位骨架 + 遮蔽塊 + 「訂閱後可見」。無任何老師原文、無匿名查詢。
4. **Evidence 區**（只用既有 vetted source）：`PerformanceOverviewPanel`，四狀態明確化（point 6）
   - loading → skeleton；error → 既有 `ExpertFetchError` inline；
   - empty → **整個「績效總覽」section 不渲染**（連標題一起隱藏），改在 Delivery 區下方一行「尚無可公開紀錄」；
   - ready → 現行畫面。**永不顯示假 0**（沿用 `publicProjection` 遮蔽字串）。
   **exact API 查證結果**：`src/components/strategy/PerformanceOverviewPanel.tsx`，現有 props 僅 `{ expertId, startingCapital?, variant? }`（L26-32），**grep 確認無 `onStateChange` / `isError` / `isEmpty` 任何回呼**，內部只有 `usePeriodPerformance` 的 `isLoading` 與 `useProjectionStatus`。故無既有回呼可重用 → 必須改本體：新增 optional prop `onStateChange?: (s: 'loading'|'error'|'empty'|'ready') => void`，以 `useEffect` 上拋，**不改任何現有 props、query 與渲染路徑**（未傳入時行為逐字不變）。
   - 該 exact 檔 `src/components/strategy/PerformanceOverviewPanel.tsx` **已加入 allowlist**（見下）。
   - 新增 unit regression `src/test/unit/performanceOverviewPanel.state.test.tsx`：斷言四狀態各觸發一次、未傳 `onStateChange` 時不 throw、既有兩個 caller（`ExpertProfile.tsx`、`src/pages/app/ExpertDetail.tsx`）render baseline 不變。
   - **不得出現 allowlist 外的隱性改檔**：`usePeriodPerformance` / `useProjectionStatus` / `publicProjection.ts` / `PerformanceReviewNotice.tsx` 全部 no-touch。
5. **適合／不適合**：只由 `riskPreference` / `operationCycle` / `styleTags` 生成，缺值不渲染該行。
6. **方案 + sticky CTA** → `/checkout/:slug/:planId` + preserved UTM；`#plans` anchor 保留。

### /experts

- 首屏：H1 + 一句交付 +（可展開）角色法規說明（預設收合）。
- 篩選單列 chips。
- `ExpertCard` 新增 `variant="funnel"`（**預設 variant 行為不變**，`/app/explore`、`company/UserJourney` 不受影響）：頭像/名字/RoleBadge｜市場 + 風格 chips（真實 metadata，null 不渲染）｜「每週固定更新」｜**單一 CTA「看他每週給什麼」→ `/expert/:slug`**。
- master-brian（無 bio/markets/style_tags）→ 只顯示名字 + RoleBadge + cadence + CTA，不補假標籤。

### /pricing

- 手機取消 3D carousel → 兩方案單欄依序，第一個方案 CTA 首屏可達；底部 sticky CTA，並在頁尾補等高 spacer 讓 FAQ/免責完全可見。
- 修煉派敘述改為「當週操作復盤 ＋ 下週觀察框架（研究用）」。
- 新增「公開機制」段：用 `complianceCopy` 中性句，不下法律結論。
- 健檢改為次級 CTA「把觀察帶回我的持倉」→ `/holding-checkup`。

### 首頁最小橋接（point 7，納入 Phase 3）

只改兩處：`src/pages/_index/JianghuFactionsSection.tsx` 的修煉派價值段、`src/pages/_index/FinalCtaSection.tsx`；語彙統一為「當週復盤 ＋ 下週觀察框架 ＋ 帶回自己的持倉」，並在其中重用 `EvidenceCard` / `StatusChip`。武俠 hero、`--jh-*` 色票、其餘 section **不動**。

---

## D. Design system（scoped — point 8）

- 新增 CSS 作用域 `.evidence-surface { --ev-paper:…; --ev-card:…; --ev-line:…; --ev-text:…; --ev-text-sec:…; --ev-text-mute:…; --ev-up:…; --ev-down:…; }`，值取自 `src/checkup/theme.js` 的 L palette。**token 只在 `.evidence-surface` 內宣告**，不進 `:root`、不進 `.dark`，因此不汙染 `/holding-checkup` 與 dark mode。
- marketing shell 維持既有深色／品牌橘；米白只出現在證據模組，形成「深色敘事 → 米白證據」的視覺橋接。
- 「無漸層／無陰影／細線／數字層級」規則**只適用 `.evidence-surface` 內**，既有品牌 hero 的 gradient 不動。
- 新元件：`src/components/evidence/{EvidenceCard,WeekTimelineItem,StatusChip}.tsx`（root 元素自帶 `evidence-surface` class）。

---

## E. Mobile acceptance

**/experts @390x844**：首屏內同時看到 H1 + 一句交付 + 第一位老師的名字/角色/市場 + 該卡單一 CTA；角色法規說明為收合狀態。
**/pricing @390x844**：無 carousel；第一個方案的 CTA 首屏可達；sticky CTA 不遮 FAQ 與底部免責。
**/expert/:slug @390x844**：首屏可見價值句 + cadence + 主 CTA。
共同：`document.scrollWidth <= document.documentElement.clientWidth`（390 / 380 / 560）；桌機 1280x800 語彙一致。

---

## F. Analytics（point 9）

**擴充既有事件 props（優先）**：`expert_card_click`、`expert_profile_view`、`expert_subscribe_click`、`checkout_open` 一律補 `{ source, expert_slug, utm_campaign }`。

**只新增 4 個事件**：`view_weekly_sample`、`expert_delivery_section_view`、`experts_filter_change`、`pricing_mechanism_expand`。

**GTM mirror：不動。** `src/lib/analytics/gtm.ts` 的 `GtmEvent` union（`ViewExpert` / `ViewPricing` / `SubscribeExpertClick` / `BeginCheckout` / `Purchase` …）已覆蓋轉換節點，新增的 4 個屬產品內部行為事件，無廣告轉換價值 → 不加 mirror、不改 union。

分析工具現況：自建 `traffic_events` + GTM dataLayer，後台 `/company/funnel`；**無第三方 funnel 工具**。

---

## H. Scope / files / 測試

### changed-files allowlist

```
新增：
  src/lib/complianceCopy.ts
  src/lib/preserveUtm.ts
  src/components/evidence/EvidenceCard.tsx
  src/components/evidence/WeekTimelineItem.tsx
  src/components/evidence/StatusChip.tsx
  src/pages/_expert/DeliveryCards.tsx
  src/pages/_expert/SampleStructureCard.tsx
  src/pages/_expert/FitCard.tsx
  src/pages/_expert/StickyPlanCta.tsx
  docs/compliance/copy-diff.md
  e2e/funnel-ig.spec.ts
  src/test/unit/complianceCopy.test.ts
  src/test/unit/preserveUtm.test.ts
  src/test/unit/performanceOverviewPanel.state.test.tsx
修改：
  src/index.css                       （只新增 .evidence-surface 區塊）
  src/pages/ExpertProfile.tsx
  src/components/strategy/PerformanceOverviewPanel.tsx   （只加 optional onStateChange prop）
  src/hooks/useExpert.ts              （mapper 補 assetClass；查詢不變）
  src/types/index.ts                  （PersonWithPlans 加 assetClass?）
  src/pages/Experts.tsx
  src/components/ExpertCard.tsx       （新增 variant，預設行為不變）
  src/pages/Pricing.tsx
  src/pages/_pricing/CheckupPlansSection.tsx
  src/lib/analytics/events.ts         （4 個新事件 + props 擴充）
  src/App.tsx                         （/s/:slug 轉址保留 query，僅此一行區塊）
  src/pages/_index/JianghuFactionsSection.tsx
  src/pages/_index/FinalCtaSection.tsx
```

### no-touch list

`supabase/**`、任何 migration、RLS、cron、edge functions、`src/checkup/**`、`src/pages/FreeCheckup.jsx`、`JournalCard.tsx`、`src/contracts/**`、`src/lib/publishingWindow.ts`、`src/lib/taipeiWeek.ts`、`src/lib/trafficTracker.ts`、`src/lib/analytics/gtm.ts`、`src/pages/_index/**`（除上列兩檔）、`src/integrations/supabase/**`、production data。

### 測試命令

```bash
tsgo --noEmit
bunx vitest run src/test/unit/complianceCopy.test.ts src/test/unit/preserveUtm.test.ts src/test/unit/performanceOverviewPanel.state.test.tsx
bun scripts/run-tests.mjs                       # full regression
bunx playwright test e2e/funnel-ig.spec.ts
bunx playwright test e2e/freecheckup-card.spec.ts   # holding-checkup 不回歸
node scripts/check-freecheckup-rwd.mjs
node scripts/check-module-boundaries.mjs
```

### E2E 驗收（`e2e/funnel-ig.spec.ts`，Preview only）

老師樣本三位：**sharkgu（tw_stock，有資料）／master-brian（tw_stock，無資料）／master-zhou（us_stock，美股 cadence）**。

1. 390x844 與 1280x800 兩 project，各頁截圖落盤。
2. `document.scrollWidth <= clientWidth`（390/380/560）。
3. header / 選單可開合，不被 sticky CTA 遮蔽。
4. `#plans` anchor 捲動生效。
5. `/s/:slug?utm_source=ig&utm_campaign=x` → 轉址後 URL 仍含 utm。
6. plan CTA href 逐字比對 `/checkout/<slug>/<planId>` 且帶 utm。
7. 登出狀態：頁面不出現任何訂閱內容；network **對 `trade_records` 與 `expert_signals` 兩表的請求數皆為 0**（含 `/rest/v1/trade_records*`、`/rest/v1/expert_signals*`、以及任何 embed 帶到這兩表的查詢字串）。
8. console error = 0、4xx/5xx = 0（ready 場景）。
9. a11y：CTA accessible name、focus ring 可見、對比 ≥4.5。
10. master-brian 顯示「尚無可公開紀錄」，畫面無 `0` 假數字、無空白 section。
11. master-zhou cadence 顯示「每週六 08:00」，sharkgu 顯示「每週五 20:00」，`/experts` 卡片一律「每週固定更新」。
12. `/app/explore` 與 `/company/user-journey` 的 ExpertCard 視覺／行為 baseline 不變。
13. `/holding-checkup` smoke 通過。

### 風險

`ExpertCard` 為共用元件 → 走 variant prop，舊呼叫端零改動並以 E2E #12 守門。`--ev-*` 汙染風險 → 由 `.evidence-surface` scope + 一條「`:root` 不得出現 `--ev-`」的 lint/grep 檢查守門。

---

## Phased plan

| Phase | 內容 | 驗收 | Rollback |
|---|---|---|---|
| **0 truth/copy contract** | `complianceCopy.ts` + `preserveUtm.ts` + unit tests + `copy-diff.md`（純新增，無 UI 變更） | 兩支 unit test 綠、tsgo 乾淨、copy-diff 列出 T+7 矛盾待人工確認 | 刪新增檔 |
| **1 scoped evidence system** | `.evidence-surface` CSS 區塊 + 三個 evidence 元件 | grep 確認 `:root`/`.dark` 無 `--ev-`；holding-checkup 截圖零 diff | 移除 CSS 區塊與新元件 |
| **2 ExpertProfile 漏斗核心** | Delivery 三卡、結構樣本、cadence、Evidence 四狀態、適合/不適合、sticky CTA、`assetClass` mapper、`/s/:slug` query 保留 | E2E 1-11 綠（三位老師） | 還原 `ExpertProfile.tsx` / `useExpert.ts` / `App.tsx`，其餘為新增檔 |
| **3 Experts + Pricing + 最小首頁橋接** | `/experts` 首屏與卡片 variant、`/pricing` 去 carousel + 機制段 + 健檢次級 CTA、首頁兩個 section 語彙統一 | 390x844 acceptance 全數通過；E2E 12 baseline 不變 | per-file revert |
| **4 full E2E / visual receipts + guard** | 跑完整測試命令表，落盤截圖與 log，並執行下列 static/network guard | 全綠 receipt + guard 兩項皆 0 | 無程式碼變更 |

#### Phase 4 static / network guard（receipt 必列）

1. **Static**：對本次 allowlist 的**所有新增與修改檔**執行
   `rg -n "supabase\.from\(\s*['\"](trade_records|expert_signals)['\"]" <allowlist files>`
   → 命中數必須為 **0**。任一命中即 Phase 4 FAIL，不得以註解或動態字串規避（同時 grep `from(\`` 與變數表名樣式）。
2. **Network**：logged-out E2E（`e2e/funnel-ig.spec.ts` 全部三位老師、`/experts`、`/pricing`、首頁）攔截所有 request，對 `trade_records`、`expert_signals` 的請求計數必須為 **0**，計數與 URL 清單落盤到 receipt。

### Future / Not approved（本次不做，需另案核准）

- 公開週記 teaser / 公開 projection：**不預設任何實作形式**。若日後要做，需另案提出獨立的 privacy-safe security design——預設 `security_invoker`、最小欄位揭露、明確 anon 授權邊界，並完成完整 RLS 驗證與 clone rehearsal；**是否採用 SECURITY DEFINER 屬該案的設計決策，本計畫不預設、不背書**。本次 **Not approved**。
- `expert_signals` 前瞻欄位 `forward_watchlist` / `forward_conditions`（schema 變更）。本次 Not approved。
- 由公開資料導出「最近週次／本週筆數」數字（需新資料介面，同上需另案 security design）。本次 Not approved。
