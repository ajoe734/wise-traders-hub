## 修正：知識庫產業趨勢仍是舊資料

### 根因
`knowledge-sync` 的 `isStale()` 只認得 `tags 含 '2024'` 的條目；但 93 條 `ai-ind-XXXX` 舊草稿的 tags 沒有年份字串，所以從未被歸檔，導致新資料被淹沒。

### 改法（單一邊緣函式 + 一次性 SQL）

**1. `supabase/functions/knowledge-sync/index.ts`**
- 重寫 `isStale()`：對 `industry_trends` 類別，**任何 cloud item_id 不在本地 LOCAL_KB 白名單內者** → 一律標記下架（`is_active=false`、`lifecycle_status=archived`、`archived_reason='replaced_by_2025_2026_refresh'`）。
- 保留現有 5 條 `ind-01~ind-05` 為唯一 active 來源；之後要新增條目，就擴 `LOCAL_KB.industry_trends.items`。
- 其他類別（chip_analysis / technical_analysis / strategy_cases / news_correlation）行為不變。

**2. 一次性 migration**
- 直接 `UPDATE checkup_knowledge_items SET is_active=false, lifecycle_status='archived', archived_at=now(), archived_reason='replaced_by_2025_2026_refresh' WHERE category='industry_trends' AND item_id LIKE 'ai-ind-%' AND is_active=true;`
- 不刪除（保留審計軌跡），僅軟下架。

**3. 重跑 sync 驗證**
- 部署後 invoke `knowledge-sync { dryRun: false }`，確認結果：active = 5、archived = 93。
- 同時 SQL 抽查 `SELECT count(*) FILTER (WHERE is_active) FROM checkup_knowledge_items WHERE category='industry_trends'` 應 = 5。

### 不在本次處理
- 其餘四類知識庫的內容更新（這次只解產業趨勢殘留問題）。
- KnowledgeBase 管理頁 UI（已能正常 CRUD，本次無需動）。

### 預期結果
前台 / `checkup-predict-events` / 任何讀 `is_active=true` 的呼叫者，產業趨勢只會看到 5 條 2025-2026 主題（CoWoS、HBM、Hybrid、AI PC、矽光子）。
