## 為什麼流量頁看起來「沒資料」

我直接查了資料庫，事實如下：

- `traffic_visits` 全表只有 **1 筆**（2026-05-28，channel=direct，landing=`/`）
- `traffic_events` 全表只有 **2 筆**

這不是頁面壞掉，是 **資料根本沒被收進來**。原因有三個，全部是設計時就埋的：

1. **Tracker 主動忽略 `/company` 與 `/admin`**（見 `src/lib/trafficTracker.ts` L36-38 `isInternalRoute`）。
   你（公司端）平常開的就是這兩個前綴，所以你自己怎麼點都不會留下紀錄。
2. **訪客級節流 24 小時**（`VISIT_TTL_MS`）。一個 visitor 一天最多寫一次 visit row。
3. **正式站流量極低**：站上實際公開流量本來就少，加上前兩條過濾後，幾乎不會寫進來。

加上更嚴重的一點：**目前只追頁面瀏覽，完全沒有「功能使用 / 按鈕點擊 / 轉換漏斗」事件**。
你說「沒有流量監控的感覺」是對的——現在這頁就是個只看 PV / UTM 的雛形，不是產品分析。

---

## 建議要做的事（一次補齊，分三塊）

### A. 讓資料先進得來（5 分鐘層級）

1. **新增「Internal 模式」開關**：`/company/traffic` 右上加一個 toggle，預設關閉外部流量過濾，讓 company_admin 看到自己（與其他內部使用者）的真實點擊路徑。底層改 `trafficTracker.ts`：允許用 `localStorage.lf_track_internal=1` 強制把 `/company`、`/admin` 也送出。
2. **降低 visit 節流到 30 分鐘**（從 24h），與一般分析工具對齊。
3. **頁面顯示「目前時間區間」與「總筆數 / 上次寫入時間」的健康燈號**——讓你一眼知道是「沒人來」還是「tracker 壞了」。

### B. 補上「功能使用量」事件追蹤（核心缺口）

新增一張 `feature_events`（或沿用 `traffic_events`，加 `event_name` / `event_props jsonb` 兩個欄位），並提供一個全站 helper：

```ts
trackEvent('signal_view', { signal_id, mentor_id });
trackEvent('expert_subscribe_click', { plan_id, price });
trackEvent('checkup_tab_change', { tab });
trackEvent('checkout_step', { step: 'consent' | 'pay' | 'success' });
```

第一波要埋的關鍵點（高訊號、低成本）：
- 訂閱漏斗：`pricing_view` → `plan_select` → `checkout_open` → `checkout_pay_click` → `checkout_success`
- 專家頁：`expert_profile_view` → `expert_subscribe_click`
- 戰報榜：`leaderboard_view` → `leaderboard_card_click`
- FreeCheckup：`checkup_tab_view`（六個 tab 分別計）、`checkup_demo_click`
- 江湖首頁：`hero_cta_click`、`brand_section_view`

### C. 把分析頁從 KPI Dashboard 升級成「漏斗 + 功能熱度」

在 `Traffic.tsx` 既有的三個 Tab 之外，新增：

- **轉換漏斗 Tab**：以 `feature_events` + `conversions` 算出
  `訪客 → pricing_view → checkout_open → checkout_success` 的每一步留存率與 drop-off
- **功能熱度 Tab**：依 `event_name` 群組，列出近 7／30 天事件次數、unique users、人均次數，並支援 source breakdown
- **頁面轉換 Tab**：每條路徑的 `entries / exits / next_route / 到 checkout_success 的轉換率`
- **使用者旅程**：以 visitor_id 為單位，倒敘 timeline（前 50 筆事件）

### D. 收尾與限制

- 不動既有 `traffic_visits` / `traffic_events` 寫入欄位，只新增欄位或新表，避免破壞舊資料
- 不動側欄、路由結構、其他頁面
- 不打開公開可讀；所有新表維持 `company_admin` only
- 不引入第三方分析（GA4、PostHog 等）——保持自家後端

---

## 技術細節

**Schema 變更**
```sql
ALTER TABLE traffic_events
  ADD COLUMN event_name text,        -- null = 純 page view（向下相容）
  ADD COLUMN event_props jsonb;
CREATE INDEX traffic_events_event_name_idx ON traffic_events(event_name, occurred_at DESC);
```
（GRANT / RLS 沿用現有 traffic_events 的設定，不變。）

**Edge function**：擴充 `traffic-ingest` 支援 `kind=event` 時帶入 `event_name` / `event_props`，沿用 sendBeacon 路徑。

**前端 helper**：在 `src/lib/trafficTracker.ts` export `trackEvent(name, props?)`，batched flush 共用既有 queue。

**新 RPC**：
- `get_funnel_overview(_from, _to, _steps text[])` → 回傳每步 count / drop
- `get_event_heatmap(_from, _to)` → event_name 群組

**Internal 模式**：`trafficTracker.ts` 初始化時若偵測 `localStorage.lf_track_internal === '1'`，跳過 `isInternalRoute` 過濾；`/company/traffic` 提供切換按鈕設定該 flag。

---

## 不會做的事

- 不重做戰報榜、持股、結帳等 UI
- 不改文案、不改首頁區塊順序
- 不接 GA4 / PostHog / Mixpanel
- 不對既有 RLS / GRANT 動手腳

---

## 給你的決策點

如果你 OK，我會一次做 **A + B 第一波（訂閱漏斗 + 專家頁 + 戰報榜共 8 個事件）+ C 的「漏斗」與「功能熱度」兩個 Tab**。FreeCheckup 與更細的旅程 Tab 留下一輪，避免一次改太多文件。

要不要照這個範圍進？或你只想先做 A（讓自己看得到資料）？