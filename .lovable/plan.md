## 持倉看板 付費版本與配額制實作計畫

### 一、版本與配額定義

| 版本 | 條件 | 配額（共用） | 重置週期 |
|---|---|---|---|
| **未登入** | 訪客 | 0（看 Demo 唯讀） | — |
| **Free** | Email/LINE 登入但無訂閱 | **每月 1 次** | 自然月（UTC+8 月初 00:00） |
| **Basic（NT$699/月）** | 已訂閱 `tier=basic` | **每週 1 次** | 自然週（UTC+8 週一 00:00） |
| **Pro（NT$1,299/月）** | 已訂閱 `tier=pro` | **每月 22 次** | 自然月（UTC+8 月初 00:00） |

**「一次」定義**：一次 AI 呼叫即扣 1 次配額。涵蓋：
- 持倉 AI 健檢 / 系統進化（research）
- 事件預測（event prediction）
- 新聞彙整（news summary）
- RAG 問答 / 教練回饋
所有 AI 功能共用同一個配額池。

**手動刷新股價**：Free 不可、Basic / Pro 可。

---

### 二、資料庫變更

1. **`checkup_plans`**
   - 新增欄位 `quota_period text not null default 'month'`（值：`week` | `month`）
   - 更新 basic plan：`quota_period='week'`, `monthly_quota=1`
   - 更新 pro plan：`quota_period='month'`, `monthly_quota=22`

2. **`checkup_usage`**（已存在）
   - 確認索引：`(user_id, used_at desc)` 用於配額查詢

3. **新增 RPC `check_checkup_quota(_user_id uuid)`**（SECURITY DEFINER）
   回傳：
   ```json
   { "tier": "free|basic|pro", "limit": 1, "used": 0, "remaining": 1,
     "period": "week|month", "resets_at": "2026-05-01T00:00:00+08:00" }
   ```
   邏輯：
   - 查 `checkup_subscriptions` 是否有 active + 未過期 → 取對應 plan tier / quota / period
   - 無訂閱 → free（month / 1）
   - 依 period 計算 UTC+8 週一或月初的 `period_start`
   - `count(*) from checkup_usage where user_id=_user_id and used_at >= period_start`

4. **新增 RPC `consume_checkup_quota(_user_id uuid, _kind text)`**（SECURITY DEFINER）
   - 先呼叫 `check_checkup_quota`
   - 若 `remaining <= 0` → `raise exception 'QUOTA_EXCEEDED'`
   - 否則 `insert into checkup_usage(user_id, kind)` 並回傳新的剩餘數

---

### 三、Edge Functions 變更（強制窮舉）

所有會呼叫 AI 的 checkup 系列 function 在執行前必須呼叫 `consume_checkup_quota`，失敗回 `429 { error: 'QUOTA_EXCEEDED', resets_at }`：

- `checkup-analyze`
- `checkup-research`（如有）
- `checkup-event-prediction`
- `checkup-news-summary`
- `checkup-rag` / 知識庫問答
- 其他 `checkup-*` AI 類 function（實作前用 `rg "supabase/functions/checkup-"` 列完整清單再逐一加）

未列入扣配額的：純股價刷新、純讀取雲端資料、institutional T86 等非 AI 端點。

---

### 四、前端變更

1. **`src/checkup/contexts/CheckupModeContext.jsx`**
   - 移除 `demo` mode（保留唯讀 Demo Page 給未登入訪客導頁，但主功能強制登入）
   - 新增 mode：`free` | `basic` | `pro`
   - 啟動時呼叫 `check_checkup_quota` RPC，存 `{tier, remaining, limit, resetsAt}`
   - 暴露 `canRefreshManually = tier !== 'free'`
   - 暴露 `quota: {tier, remaining, limit, resetsAt, period}`
   - 新增 `refreshQuota()` 在每次 AI 呼叫成功後重抓

2. **新增 `src/hooks/useCheckupSubscription.ts`**
   - 包 `check_checkup_quota` RPC + React Query
   - 30 秒 staleTime，AI 呼叫後手動 invalidate

3. **配額顯示 UI**
   - `Header.jsx` 顯示「本{週/月}剩餘 N/M 次 · D 日後重置」
   - 點擊展開：顯示目前方案 + 升級連結

4. **配額耗盡時的 Paywall**
   - 觸發 AI 功能但 `remaining=0` → 彈窗：
     - 標題：「本{週/月}配額已用完」
     - 內容：說明下次重置時間
     - CTA：升級到 Basic / Pro（連到 `/checkup/checkout`）

5. **未登入訪客**
   - `/free-checkup` 顯示 Demo + 「登入以使用」CTA（不再給 1 次免費試用）

---

### 五、Index.tsx 文案校正
首頁「持股健檢」段落補上「免費版每月 1 次・Basic 每週 1 次・Pro 每月 22 次」說明。

---

### 六、技術重點

- **時區**：所有 period_start 計算統一 `now() at time zone 'Asia/Taipei'`
- **原子性**：`consume_checkup_quota` 在單一 SQL transaction 內檢查+寫入，避免並發超扣
- **錯誤處理**：429 在前端轉成統一 toast + 升級彈窗
- **保留現有**：`is_tester` 仍視為 pro（內部測試免限制）

### 七、驗證清單
1. 三個 tier 的配額正確扣減與重置
2. UTC+8 週一 00:00 / 月初 00:00 確實重置
3. 並發呼叫不會超扣
4. 所有 `checkup-*` AI function 都有扣配額（用 `rg` 窮舉確認）
5. 配額耗盡彈窗 → 升級路徑暢通
6. Free 用戶手動刷新股價被擋下