## 範圍

優化「行事曆 + 事件分析」整條鏈路，**不修改** `fetchCalendarEvents` 的 5 分鐘 timeout（依用戶指示）。共 6 項變更。

---

## 1. `_shared/jsonRepair.ts` 共用 JSON 修復

新檔 `supabase/functions/_shared/jsonRepair.ts`，導出 `parseJsonArray(text): any[] | null`：
- 合併 `extractJsonArray / tryRepairTruncatedArray / tryParseEvents / extractJsonArrayStr` 四套重複實作
- 邏輯：直接 parse → 去 markdown fence + 平衡 `[]` 擷取 → 修復截斷陣列（最後完整 `}` 重組 + 物件級 walk）

`checkup-calendar/index.ts` 移除 `extractJsonArray / tryRepairTruncatedArray / tryParseEvents`，改用 `parseJsonArray`。
`checkup-predict-events/index.ts` 移除 `extractJsonArrayStr`，改用 `parseJsonArray`，並把錯誤分支從 try/catch 改成 null 檢查。

---

## 2. 行事曆 stableId + upsert sync（最高優先 — 真 bug）

**問題**：
- `syncCalendarToNews` 每次砍掉所有 `source: "calendar"` 重建 → tracking/closed 事件被誤殺
- `id = Date.now() + Math.random()` 每次不同 → `prediction-cache-{eventId}` 永遠 miss

**修法**：

`checkup-calendar/index.ts` 在 `Deno.serve` 回傳前對每筆 event 補 `stableId`：
```ts
function makeStableId(label: string, date: string, type: string): string {
  const code = (label || '').match(/\d{4,6}/)?.[0] || 'na';
  const t = (type || 'event').replace(/[^\w\u4e00-\u9fa5]/g, '');
  const d = String(date || '').trim();
  let dn = 'tba';
  const ymd = d.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  const ym  = d.match(/(\d{4})\/(\d{1,2})月/);
  const yq  = d.match(/(\d{4})\s*Q([1-4])/i);
  if (ymd) dn = `${ymd[1]}${ymd[2].padStart(2,'0')}${ymd[3].padStart(2,'0')}`;
  else if (ym) dn = `${ym[1]}${ym[2].padStart(2,'0')}MM`;
  else if (yq) dn = `${yq[1]}Q${yq[2]}`;
  return `cal-${code}-${t}-${dn}`;
}
```
寫入每個 event 物件的 `stableId` 欄位後再回傳。

`FreeCheckup.jsx` `syncCalendarToNews` 改寫（line 1001-1052）：
- 用 `stableId`（fallback 到本地計算）當合併 key
- 既存事件保留：`id`、`status`、`pred`、`predReason`、`actual`、`actualNote`、`correct`、`lessons`、`trackingStart`、`priceAtEvent`、`priceAtExit`、`priceHistory`、`exitDate`、`reviewDate`
- AI 只覆蓋：`title`、`detail`、`date`、`stocks`
- 用戶已 review（`actual` 非 null 或 `lessons` 非空）→ AI 的 `pred / predReason` 也不覆蓋
- 已 `tracking / verifying / closed / past` 狀態不被降級回 `pending`
- AI 已不再列出但 status 仍是 `pending` 的 calendar 事件 → 移除；其他狀態保留
- `id` 改用 `stableId`（穩定字串 PK），predict-cache 自然命中

同步調整 `addEvent`（手動加入）也產生 `stableId`，並避免與 calendar 撞 key（前綴 `manual-`）。

---

## 3. 權證到期日改走 DB（不再丟給 LLM）

**Schema migration**（要建 SQL 給用戶執行）：
```sql
CREATE TABLE IF NOT EXISTS public.warrant_expiry (
  symbol      text PRIMARY KEY,
  name        text,
  parent_code text,
  expire_date date,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warrant_expiry_parent ON public.warrant_expiry(parent_code);
ALTER TABLE public.warrant_expiry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read warrant expiry"
  ON public.warrant_expiry FOR SELECT TO public USING (true);
CREATE POLICY "Admins manage warrant expiry"
  ON public.warrant_expiry FOR ALL TO authenticated
  USING (has_role(auth.uid(),'company_admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'company_admin'::app_role));
```

**新 edge function `checkup-warrant-sync`**（`supabase/functions/checkup-warrant-sync/index.ts`）：
- 抓 TWSE 上市權證每日成交資訊 CSV（`https://www.twse.com.tw/rwd/zh/warrant/dailyResult?response=csv`）
- 解析 symbol / name / 標的證券代號（parent_code）/ 到期日
- `upsert` 到 `warrant_expiry`
- 失敗就 log 不丟

**Cron**（用戶於 Cloud 設定，或下發 SQL）：每週日 03:00 (UTC+8) = 19:00 UTC Sat：
```sql
select cron.schedule(
  'warrant-sync-weekly',
  '0 19 * * 6',
  $$ select net.http_post(
       url:='https://yqacmrgdjlenbijclngi.supabase.co/functions/v1/checkup-warrant-sync',
       headers:='{"Content-Type":"application/json","apikey":"<ANON_KEY>"}'::jsonb,
       body:='{}'::jsonb
     ); $$
);
```

**`checkup-calendar/index.ts` 改造**：
- `classifyHoldings` 偵測權證 (6 碼或名稱含「購售牛熊」) → 抓代號清單
- 主流程 query `warrant_expiry where symbol in (...)`，把命中的權證直接組事件物件（type=`權證`，date=`expire_date`），不送進 prompt
- prompt 的「權證持倉」section 改成只列母股（parent_code），且明確寫「到期日已由系統補齊，無需你列出權證類事件」
- DB miss 的權證才 fallback 給 LLM 列（保底）

---

## 4. Accuracy stats 索引 + 15 分鐘 cache

**Schema migration**：
```sql
CREATE INDEX IF NOT EXISTS idx_pred_accuracy_reviewed_at
  ON public.checkup_prediction_accuracy(reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pred_accuracy_event_type
  ON public.checkup_prediction_accuracy(event_type);
```

`checkup-predict-events/index.ts` `fetchAccuracyStats`：
- 讀 `checkup_storage` system UID, key `accuracy-stats-cache-v1`
- TTL 15 分鐘，命中直接回 `data.text`
- miss 才查表，計算後寫回 cache（`data: { text }`）
- cache 寫入 fire-and-forget

---

## 5. Realtime quotes DB 優先

`checkup-predict-events/index.ts` `fetchRealtimeQuotes(codes)` 重寫：
1. 先 `select symbol, price, yesterday_close, change_percent, volume, high_price, low_price, open_price, pushed_at from current_prices where symbol = ANY(codes)`
2. `pushed_at` 在 5 分鐘內者直接組 quote 物件，加入 result map
3. 收集仍未命中的 codes，才打 TWSE MIS
4. TWSE 失敗也不丟 — 已有 DB 結果（雖舊）總比沒有好

shape 與既有相同（code/name/price/yesterdayClose/changePercent/volume/high/low/open）。

---

## 6. 今日警示日期格式對齊

問題：`urgentCount / todayAlertSummary` 用 ISO `2026-05-02` 比 `e.eventDate`，但 calendar 同步進來的事件存的是 `e.date = '2026/05/02'`，永遠 0。

`src/checkup/hooks/useEvents.js` 修兩個 useMemo：
- `today` 用 `new Date().toLocaleDateString('zh-TW').replace(/-/g,'/')`（保證 `YYYY/MM/DD`）
- 比對欄位優先 `e.date`，fallback `e.eventDate`，並把 ISO `-` 轉成 `/` 一視同仁

`src/checkup/stores/eventStore.js` `getUrgentCount / getTodayAlertSummary` 同樣修法。

新增 vitest：`src/test/unit/event-today-alert.test.ts`：
- 給 `[{ date:'2026/05/02', status:'pending' }]` 在 mock today=2026/05/02 → urgentCount=1
- 給 `eventDate:'2026-05-02'` 也要算到（向後相容）

---

## 不動的部分

- `fetchCalendarEvents` 5 分鐘 timeout（line 915）
- 行事曆 1 年抓取範圍 / 8 大類 prompt 結構
- `pred` 預設值 `'up'`
- FreeCheckup.jsx 不抽元件（所有改動 inline）
- demo mode 流程（DEMO_CALENDAR 仍走原路徑，stableId 在 demo 資料也需補上）

---

## 部署順序

1. Schema migration（warrant_expiry 表 + 兩個 accuracy index）
2. 新增 `_shared/jsonRepair.ts`
3. 新增 `checkup-warrant-sync` 並手動觸發一次灌資料
4. 改 `checkup-calendar`、`checkup-predict-events`，deploy
5. 改 FreeCheckup.jsx `syncCalendarToNews` + `addEvent`
6. 改 `useEvents.js`、`eventStore.js` 日期對齊 + 加 vitest
7. Cron SQL（warrant-sync 每週日）

## 風險

- **行為變更**：第一次部署後，舊 calendar 事件因 stableId 不同會被視為新事件重建一次（一次性）。之後穩定。
- **TWSE 權證 CSV 格式**：需先 curl 一次確認欄位順序，若格式變動 sync 失敗仍 fallback 到 LLM 模式不影響使用者。
- **FreeCheckup RWD QA**：本次改動不碰 Hero 與 `.wb-card`，不需跑 560/390/380 三斷點視覺回歸。
- **i18n**：本次無新增可見英文文案，不需跑 i18n scanner。

按 Approve 後我會依序 1→7 落地，過程中跑 vitest + curl 驗 edge function。
