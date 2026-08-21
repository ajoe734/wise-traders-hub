# IG → 老師 → 週五交付 → 證據 → 方案 的漏斗改造（/experts、/pricing 為主）

只做前台資訊架構、文案與共享視覺；不碰老師原文、訂閱權限、RLS、週記發布排程與 production data。

---

## A. 現況稽核（已讀，含 exact 位置）

### 路由與元件

| 路由 | 檔案 | 目前 section 順序 |
|---|---|---|
| `/experts` | `src/pages/Experts.tsx`（150 行）+ `src/components/ExpertCard.tsx` | 法規分類方塊 → 搜尋 → 角色鈕 → 市場鈕 → 卡片 grid → 免責 |
| `/pricing` | `src/pages/Pricing.tsx`（302 行）+ `src/pages/_pricing/{PricingPlanCard,PricingExampleModal,PricingComparisonSection,CheckupPlansSection,PricingFaq}.tsx` | 標題 → 快速對照兩顆 pill → 手機 3D carousel／桌機兩卡 → 比較表 → 健檢方案 → FAQ |
| `/expert/:slug` | `src/pages/ExpertProfile.tsx`（427 行） | Hero → 策略簡介 → 績效總覽（lazy `PerformanceOverviewPanel`）→ 訂閱方案 → 免責 |
| `/`（首頁） | `src/pages/Index.tsx` + `src/pages/_index/{HeroSection,WarRoomSection,ThreeMovesSection,JianghuFactionsSection,LeaderboardSection,StockDashboardSection,HowItWorksSection,FinalCtaSection}.tsx` | 武俠語彙 |
| `/holding-checkup` | `src/pages/FreeCheckup.jsx` + `src/checkup/**`、`src/checkup/theme.js` | 米白資料儀表板 |

### 資料來源

- 名師清單：`useExperts()`（`src/hooks/useExpert.ts:153`）→ RPC `get_public_experts_list`。
- 名師詳情：`useExpertDetailBundle`（`src/hooks/useExpert.ts:251`）→ RPC `get_expert_detail_bundle(_slug)`，回 expert + plans + subscriberCount + mySubscribedPlanIds。
- 價格：`usePricingBundle()`（minAdvisorPrice / minMentorPrice）。
- 績效：`PerformanceOverviewPanel` + `src/contracts/publicProjection.ts`（fail-closed，`UNAVAILABLE_LABEL='資料暫時無法取得'`、`REVIEW_BADGE='資料檢核中'`）。

### 可重用 vs 目前根本不存在（重要）

可直接重用：`ExpertCard`、`JournalCard`（週次卡語彙已存在）、`RoleBadge`、`AssetBadge`、`PricingPlanCard`、`SEO`、`publicProjection` 遮蔽契約、`taipeiWeek`（週界線）、`publishingWindow`（`nextPublishMomentLabel()`）、`analytics/events.ts`、`trafficTracker`（UTM first-touch，`src/lib/trafficTracker.ts:171-175`）。

**目前不存在、不得發明：**

1. **匿名可讀的週記樣本**。`expert_signals` RLS 只有「訂閱者可讀」與「作者／company_admin」（`pg_policies` 查證），**沒有任何 anon SELECT policy**。所以「可公開週記節錄」現在無法從前端讀到，只有兩條合法路徑：
   - (a) 只用**已公開的 metadata**：`trade_records` 有 anon policy（active 老師的 open/closed 皆可讀）→ 可導出「最近更新週次、本週筆數、涵蓋標的、市場」等節奏證據，**不含老師文字**。
   - (b) 若要露出「老師原文的遮蔽節錄」，必須新增一支 SECURITY DEFINER 的 teaser RPC（回傳截斷後純文字 + 遮蔽標記），**這是 DB 變更，需要你另行核准**；本計畫預設**不做**，Phase 4 才以可選項提出。
2. **「下週觀察框架」欄位**。`expert_signals` 只有 `reason_summary / reason_detail / risk_notes / learning_points / teaching_topic / overall_summary`，全部是「已發生操作」語意，**沒有前瞻欄位**。前台可以先用「章節標題＋說明」把前瞻價值講清楚，但要真的呈現老師寫的前瞻內容，需要新增欄位（Phase 5，可選、需你核准）。
3. **老師績效／會員數的行銷數字**：`subscriberCount` 已存在可用；其餘一律走 `publicProjection` 遮蔽，不得自行編造。

### 法規文案來源（全部硬編碼在前端，無 DB 單一資料源）

- `Experts.tsx:85`「T+7 延遲修煉派週記，純教學用途，非投資建議」
- `Experts.tsx:143` 底部免責
- `ExpertProfile.tsx:130/139/143`「T+7 延遲實戰週記」「所有內容均延遲 7 天以上（T+7）」
- `JournalCard.tsx:84`「已解鎖（T+7 歷史）」
- `src/lib/subscriptionVisibility.ts`、`src/lib/publishingWindow.ts`、`src/pages/Legal.tsx`、`_pricing/PricingComparisonSection.tsx`、`_pricing/PricingExampleModal.tsx`、`src/pages/_index/WarRoomSection.tsx`

---

## G. compliance gate：已發現的矛盾（先修文案，不下法律結論）

真相是：`src/lib/publishingWindow.ts` 實作的是**撰寫／發布視窗**——台股週一 08:00～週五 20:00，超出即鎖定，文案為「週五 20:00 統一開放發布」；美股為「週六 08:00」。`subscriptionVisibility.ts` 另有 T+7 可見性判斷。

矛盾清單（Phase 0 產出報告，不自行改判）：

1. UI 同時宣稱「T+7 延遲」與「週五 20:00 統一公開」，兩者是不同機制，使用者讀到會誤解。
2. `ExpertProfile.tsx:143`「延遲 7 天以上」是**絕對化陳述**，但排程實際是週界線對齊，非逐筆 +7 天。
3. 美股老師在 `/experts` 仍看到台股語境的 T+7 文案（`nextPublishMomentLabel` 已能分市場，但 marketing 頁沒用）。

處理方式：文案統一由**單一常數檔**輸出（`src/lib/complianceCopy.ts`，純字串，無 DB），依 `asset_class` 取市場對應句；所有 marketing 頁改引用。**新舊文案並列成 diff 表交你＋法遵人工確認後才落地**，我不宣稱任何法律結論。前瞻內容一律用「觀察／研究清單／風險條件／情境假設」，禁用「推薦／跟單／保證／目標價」。

---

## B. mobile-first IG 漏斗

```text
IG bio / story link
  ?utm_source=ig&utm_medium=bio&utm_campaign=<teacher>
        │  (UTM first-touch 已由 trafficTracker 落地，跨頁不遺失)
        ▼
/expert/:slug            ← 主要承接頁（IG 流量 80% 直接落這）
  首屏：你每週五會拿到什麼（3 件事）
  ↓ 節奏證據（最近更新週次／本週筆數／涵蓋市場，全部來自已公開資料）
  ↓ 「當週操作復盤」與「下週觀察框架」分區說明 + 遮蔽樣本
  ↓ 績效／持倉證據（publicProjection 遮蔽）
  ↓ 適合／不適合
  ↓ sticky CTA → /checkout?plan=…（保留 utm + slug）
        │
        ├─ 想比較別的老師 → /experts（比較器角色）
        └─ 不確定買哪種 → /pricing（門派/機制/價格解說角色）
```

角色分工，避免重複：

- `/expert/:slug` = **轉換頁**（單一 CTA：訂閱此老師）。
- `/experts` = **比較頁**（市場／風格／更新節奏／是否有公開證據；CTA 單一＝進老師頁）。
- `/pricing` = **理解頁**（outcome → 機制／法規 → 價格 → 健檢加購；CTA 導回 /experts 或指定老師）。
- `/holding-checkup` = **第二步工具**（把老師的觀察帶回自己的部位），不搶主 CTA。

---

## C. wireframe / section order 與文案方向

### /expert/:slug（新增在既有 section 之前，不刪既有）

1. **首屏價值條**：`{老師名}｜{市場}｜每週五 20:00 更新` + 一句「你會拿到什麼」。
2. **每週交付三件事**（固定三卡）：`當週操作復盤`／`下週觀察框架`／`風險與部位條件`。
3. **最新週次節奏卡**：最近更新週次、本週筆數、涵蓋標的數（來源：`trade_records` 公開列＋`taipeiWeek` 分組）。無資料老師顯示「尚未有公開紀錄」，**不捏造**。
4. **樣本區**：預設顯示「結構樣本」（欄位骨架 + 遮蔽區塊 + 「訂閱後可見」），不顯示未經授權的老師原文。
5. **證據區**：既有 `PerformanceOverviewPanel`（遮蔽契約不動）。
6. **適合／不適合**：由 `riskPreference`、`operationCycle`、`styleTags` 生成，缺值不顯示該行。
7. **方案 + sticky CTA**。

文案分區用語：復盤區＝「當週已發生操作復盤（依規定於週五統一公開）」；前瞻區＝「下週觀察框架：研究清單、觀察條件、風險情境（教育研究用途，非買賣建議）」。

### /experts

- 首屏收斂成 **1 行標題 + 1 句交付**：「訂閱一位老師，每週五拿到他的當週復盤與下週觀察框架。」角色法規說明改為可展開的一行 `了解投顧分析師／實戰導師差異`（手機不再吃掉首屏）。
- 篩選改成單列 chips（角色 + 市場合併，搜尋收進 icon 展開），第一張老師卡在 390px 折線內。
- 卡片改版（`ExpertCard`）：頭像 + 名字 + RoleBadge｜市場／風格 2 個 chip｜**更新節奏行**（每週五 20:00／美股週六 08:00）｜**證據行**（最近公開週次 or 「尚未有公開紀錄」）｜**單一 CTA「看他每週給什麼」→ /expert/:slug**（移除雙 CTA）。

### /pricing

- 先 outcome：「你要的是每週省時間的訊號，還是每週練一次決策的復盤？」
- 修煉派敘述改寫：不再只講「上週交易紀錄」，改為「當週操作復盤 **＋** 下週觀察框架（研究用）」。
- 手機移除 3D carousel，改**單欄依序兩張卡** + 底部 sticky CTA。
- 機制／法規段獨立一節（T+7 vs 週五統一公開，用 Phase 0 收斂後的文案）。
- 健檢：改成「第二步：把老師的觀察帶回自己的部位」，次級樣式，不搶主 CTA。

---

## D. 統一 design system（只抽，不重做）

保留品牌深色底 + `--primary` 橘（`18 84% 55%`）。新增一組共享「資料證據」token，值來自 `src/checkup/theme.js` 的 L palette，寫進 `src/index.css`：

`--ev-paper #F5F3EF`、`--ev-card #FFFFFF`、`--ev-line`（細線 8% 墨）、`--ev-text #4A4640`、`--ev-text-sec`、`--ev-text-mute`、`--ev-up #9E4050`、`--ev-down #3A7A5A`。

新增 3 個共享元件（`src/components/evidence/`）：`EvidenceCard`、`WeekTimelineItem`、`StatusChip`。規則：細線、無陰影、無漸層、數字層級（主數字 20-22px/500，標籤 11px/400）、狀態色只用在狀態 chip。

首頁**只抽 `StatusChip` 與 `EvidenceCard` 用在排行榜／戰情數字區**，`--jh-*` 江湖色票與武俠版面保留不動。

---

## E. mobile acceptance（390px）

- 首屏同時看得到：價值句 + 第一位老師/第一個方案 + 主 CTA。
- 無水平溢出（`document.scrollWidth <= clientWidth`）於 390/380/560px。
- 不需滑 carousel 才能理解（/pricing 手機改單欄）。
- sticky CTA 高度 ≤64px，頁面底部補等高 padding，不遮末段內容與免責。
- 桌機 1280px 版面一致、CTA 語彙相同。

## F. conversion instrumentation

可重用（`src/lib/analytics/events.ts`）：`experts_list_view`、`expert_card_click`、`expert_profile_view`、`pricing_view`、`expert_subscribe_click`、`checkout_open/submit/success/failure`、`checkup_upgrade_click`；UTM first-touch 由 `trafficTracker.ts:171-175` 落 `traffic_events`。

新增（只加 union 型別 + 呼叫點，無後端變更）：`view_weekly_sample`（expert_slug, sample_kind）、`expert_delivery_section_view`（section）、`select_plan`（plan_id, plan_type, expert_slug, source）、`checkout_start`（對齊既有 `checkout_open`，以 props 補 `source`、`utm_campaign`）、`experts_filter_change`、`pricing_mechanism_expand`。

所有 CTA 連結一律帶 `expert_slug`，並保留既有 query string（新增 `src/lib/preserveUtm.ts` 純函式）。分析工具現況：自建 `traffic_events` + GTM mirror，**沒有第三方 funnel 工具**，後台看板為 `/company/funnel`。

---

## H. scope / 風險 / 測試

不碰：老師原文、`expert_signals`/`trade_records` 寫入、RLS、發布排程、cron、edge functions、production data、Publish。

風險：(1) 誤把訂閱內容外洩 → 一律不新增任何讀取 `expert_signals` 的匿名路徑；(2) 法規文案改動 → Phase 0 只產 diff 表待人工確認；(3) `ExpertCard` 為共用元件（`/app/explore` 也用）→ 改版走 props 開關，舊用法行為不變。

Preview E2E（`e2e/funnel-ig.spec.ts`，Playwright，只跑 Preview）：

1. desktop 1280 / mobile 390 兩 project。
2. 有資料老師（sharkgu）與無資料老師（master-brian）各一條，後者必須顯示誠實降級文案且無 `0` 假數字。
3. 未登入／已登入各跑一次，未登入不得出現訂閱內容。
4. IG deep link `?utm_source=ig&utm_campaign=x` → /expert/:slug → CTA → checkout URL 仍含 utm 與 slug。
5. 所有 CTA/anchor 可點且目標存在（`#plans` 捲動生效）。
6. console error = 0、4xx/5xx = 0（ready 場景）。
7. a11y：CTA 有 accessible name、對比 ≥4.5、focus ring 可見、sticky CTA 不蓋焦點元素。
8. 無水平溢出斷點檢查 390/380/560。

---

## Phased implementation

**Phase 0 — 法規文案收斂（無 UI 變更）**
檔案：新增 `src/lib/complianceCopy.ts`；產出 `docs/compliance/copy-diff.md`。
驗收：diff 表列出每一句舊文案→新文案＋出處；你＋法遵確認後才進 Phase 1。Rollback：刪檔。

**Phase 1 — 共享 design tokens 與 evidence 元件**
檔案：`src/index.css`（新增 `--ev-*`）、`src/components/evidence/{EvidenceCard,WeekTimelineItem,StatusChip}.tsx` + unit test。
驗收：Storybook 式 harness 頁截圖 + tsgo 乾淨 + 既有測試全綠。Rollback：移除新增檔與 CSS 區塊（無既有樣式被改）。

**Phase 2 — /expert/:slug 承接頁（漏斗核心）**
檔案：`src/pages/ExpertProfile.tsx`、新增 `src/pages/_expert/{DeliverySection,WeekRhythmCard,SampleStructureCard,FitCard,StickyCta}.tsx`、`src/hooks/useExpertPublicRhythm.ts`（只查 `trade_records` 公開列）、`src/lib/preserveUtm.ts`。
Schema：**不需要**。
驗收：E2E 1-8 全綠；無資料老師顯示降級文案。Rollback：還原 `ExpertProfile.tsx`，新增檔為 additive。

**Phase 3 — /experts + /pricing 改版**
檔案：`src/pages/Experts.tsx`、`src/components/ExpertCard.tsx`（新增 props，預設維持舊行為）、`src/pages/Pricing.tsx`、`src/pages/_pricing/*`、`src/lib/analytics/events.ts`（新事件型別）。
Schema：**不需要**。
驗收：390px 首屏 acceptance、carousel 移除、事件觸發表逐項驗證。Rollback：per-file revert。

**Phase 4（可選，需你另行核准）— 公開週記 teaser**
需新增 SECURITY DEFINER RPC（回傳截斷遮蔽文字），屬 DB 變更；在 clone 先驗 RLS 不外洩才談 production。

**Phase 5（可選，需你另行核准）— 前瞻欄位**
`expert_signals` 新增 `forward_watchlist` / `forward_conditions`，含後台編輯與法遵文案；屬 schema 變更。

Phase 1-3 全程 0 schema change、0 deploy、0 Publish。
