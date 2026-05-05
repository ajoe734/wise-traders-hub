## 目標
讓你不用每天進後台盯著看：知識庫條目自動分流到三個池子，由排程器自動觸發回測／網格救援／升降級，後台只在「需要你決策」時通知你。

---

## 一、生命週期：三段式 `lifecycle_status`

新增欄位 `lifecycle_status`（取代純 `is_active` 的二元觀念，`is_active` 仍保留給對外 prompt 使用）：

| 狀態 | 中文 | 是否進 AI prompt | 說明 |
|---|---|---|---|
| `active` | 使用中 | ✅ 是 | 已驗證或編輯認可，正常餵給 Free Checkup |
| `candidate` | 備選 | ❌ 否 | 新建 / 網格搜尋產出的新版，等樣本累積到門檻才升 active |
| `rescue` | 救援中 | ⚠️ 降權（confidence × 0.5） | 表現掉到救援線，正在跑網格找新參數，找到就升 candidate |
| `archived` | 已歸檔 | ❌ 否 | 救援失敗或被新版取代 |

預設遷移：現有 `is_active=true` → `active`；`is_active=false`（已被 archive_and_promote 換掉的）→ `archived`。

---

## 二、自動排程（不用人盯）

延伸現有 `knowledge_auto_rules`（已經有「每週日 03:00」的框架），改成 **每日 03:00**，分階段做事：

```text
每日 03:00 (Asia/Taipei)
 ├─ Step 1: 全量回測（只跑樣本 < 30 或 last_run > 7 天的條目，省成本）
 ├─ Step 2: 套用門檻 → 自動分流
 │    win_rate ≥ promote_above_win_rate (預設 70%) 且 n ≥ 30  → 升信心、保持 active
 │    win_rate ≤ archive_below_win_rate    (預設 40%) 且 n ≥ 30  → 進 rescue（不直接歸檔！）
 │    archive_below < win_rate < auto_grid_search_below (55%)    → 進 rescue
 │    其他                                                          → 維持 active
 ├─ Step 3: 對 rescue 池條目自動跑網格搜尋（每天最多 N 個，避免炸 API）
 │    找到改善 ≥ promote_min_improvement_pct (5%) 的參數 → 建立 candidate（新版）
 │    找不到 → 留在 rescue，連續 3 週救不起來 → archived + 通知你
 └─ Step 4: 對 candidate 池條目觀察 14 天實戰命中
       n ≥ 30 且 win_rate 不低於原版 → 自動升 active，原版降 archived
       n < 30 → 繼續觀察
       win_rate 反而更差 → archived
```

**所有自動動作寫 audit_logs**，後台首頁顯示「過去 7 天自動處理摘要」。

---

## 三、後台 UI 改動

`KnowledgeBase.tsx` 列表加 **狀態 Tab**：

```text
[使用中 142] [備選 8] [救援中 3] [已歸檔 27]
```

- **使用中**：和現在一樣
- **備選**：顯示「觀察天數 / 累積樣本 / vs 原版勝率」，可手動「立即升級」或「直接淘汰」
- **救援中**：顯示「進入救援日期 / 已嘗試網格次數 / 最佳改善%」，可手動「強制歸檔」或「重跑網格」
- **已歸檔**：顯示「歸檔原因」（救援失敗 / 被 v2 取代 / 手動）

頂部加 **🔔 待決策清單**：只有「救援 3 週仍無解」「candidate 觀察期滿」這類需要你拍板的項目會冒泡，其他全自動走完。

---

## 四、技術改動範圍

### Schema（migration）
1. `checkup_knowledge_items` 加 `lifecycle_status text default 'active'`、`rescue_started_at`、`rescue_attempts int default 0`、`candidate_observed_since`
2. `knowledge_auto_rules` 加 `daily_grid_search_quota int default 5`、`rescue_max_weeks int default 3`、`candidate_observe_days int default 14`
3. `getRelevantKnowledge` 的查詢從 `is_active=true` 改成 `lifecycle_status IN ('active','rescue')`，rescue 的 effectiveScore 自動 ×0.5

### Edge Functions
- 新增 `knowledge-daily-scheduler`（cron 03:00）：跑 Step 1–4
- 沿用現有 `knowledge-grid-search`，被 scheduler 呼叫
- 沿用現有 `knowledge-backtest-batch`

### Frontend
- `KnowledgeBase.tsx`：加狀態 tab + 待決策卡片
- `AutoRulesPanel.tsx`：加 daily_grid_search_quota / rescue_max_weeks / candidate_observe_days 三個欄位

---

## 五、為什麼這樣設計能兼顧「不用盯」與「準確度」

1. **rescue 不直接砍**：勝率掉了先降權（×0.5）但仍在線，避免知識庫突然斷層；網格搶救成功率歷史經驗約 30–50%。
2. **candidate 觀察期**：新版本不直接上線，先用 14 天 / 30 樣本驗證，避免「網格 overfit」污染主庫。
3. **每日小步快跑**：每天最多 5 條跑網格，API 成本可預期；7 天內全庫輪一遍。
4. **只在僵局通知你**：90% 的條目自動走完生命週期，你只看「救 3 週仍救不起來」「candidate 該不該升」這類真正需要人判斷的。

---

## 驗證
- 手動把某條目 win_rate 調到 30% → 隔天應變 rescue
- rescue 條目跑網格找到 +8% → 自動建 candidate（新 item_id 帶 `-v2`）
- 連續 3 週 rescue 無解 → 自動 archived 並進「待決策」清單通知

要我就照這個動工嗎？或你想先調哪個門檻（例如 rescue_max_weeks 想設 4 週、candidate_observe_days 想設 7 天）？