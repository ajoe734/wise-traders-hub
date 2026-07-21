# 計畫：Signal「安全跳過」的日誌與 UI 回饋

## 背景
`handle_signal_trade` trigger 在 `buy` / `add` 時會檢查 `EXISTS (trade_records WHERE signal_id = NEW.id)`，若已存在就 `RETURN NEW` 靜默跳過。這是防重複的正確設計，但目前**完全沒留痕跡**——老師 / 管理員看不到「本次觸發被略過」，也無從辨別是 trigger 保護、還是根本沒跑。

要做的三件事：
1. Trigger 端寫入結構化 log
2. 管理後台可查詢「最近安全跳過」清單
3. 前台（`SignalCreateDialog`）在偵測到 skip 時給明確 toast

## 交付項

### 1. Migration — trigger 內寫 log

改寫 `public.handle_signal_trade()`，在每個 `IF v_exists THEN RETURN NEW;` 之前先插一筆：

```sql
INSERT INTO public.function_run_logs
  (fn, run_id, level, stage, msg, signal_id, expert_id, payload)
VALUES
  ('handle_signal_trade', gen_random_uuid()::text, 'info',
   'skipped_existing_trade',
   format('signal %s 已對應 trade_record，%s 動作跳過', NEW.id, NEW.action),
   NEW.id, NEW.expert_id,
   jsonb_build_object(
     'action', NEW.action,
     'instrument', NEW.instrument,
     'tg_op', TG_OP,
     'existing_trade_id', (SELECT id FROM public.trade_records WHERE signal_id = NEW.id LIMIT 1)
   ));
```

覆蓋 `buy` 與 `add` 兩個分支（其它 action 分支目前無此檢查，維持不動）。

### 2. 前台回饋 — `SignalCreateDialog.tsx`

新訊號送出後（`inserted.id` 拿到），檢查最近 3 秒內是否有相符的 skip log：

```ts
const { data: skipLog } = await supabase
  .from('function_run_logs')
  .select('id, stage, msg')
  .eq('fn', 'handle_signal_trade')
  .eq('stage', 'skipped_existing_trade')
  .eq('signal_id', inserted.id)
  .gte('created_at', new Date(Date.now() - 5000).toISOString())
  .limit(1)
  .maybeSingle();

if (skipLog) {
  toast.info('偵測到既有 trade_record，本次觸發已被安全略過（不會造成重複）', { duration: 6000 });
}
```

放在既有 `toast.success('訊號已發布')` 之前；skip 時取代 success toast。

補一段 RLS：`function_run_logs` 目前只有 admin/service 可讀（詳查後補），若 mentor 也需讀，加一條「作者可讀自己 signal 的 log」policy。

### 3. 管理後台 — `/company/signal-dupe-audit` 追加區塊

在既有頁面「自動去重排程」條下方，加一個小卡：**「最近 24h Trigger 安全跳過」**
- 資料：`function_run_logs where fn='handle_signal_trade' and stage='skipped_existing_trade' order by created_at desc limit 20`
- 顯示：時間、老師（join experts）、標的、action、既有 trade_id
- 空狀態顯示綠色「無跳過紀錄」
- 提示：「這些是 trigger 主動防重複的成功攔截，不代表錯誤」

## 不做
- 不改 trigger 的實際邏輯（既有存在性檢查已正確）
- 不對 sell/trim/exit/cover 加新的 skip log（那些分支沒有 skip 路徑）
- 不動 `admin_signal_dupe_trades_audit` 或 sweep（不同用途：sweep 修髒資料，這裡追蹤「被成功防禦」）

## 驗證
- 手動 `UPDATE expert_signals SET status='pending' WHERE id=<x>; UPDATE ... SET status='published';` 二次翻轉，`function_run_logs` 應出現一筆 `skipped_existing_trade`。
- 前台重送同 signal，toast 顯示「已被安全略過」。
- `/company/signal-dupe-audit` 追加區塊列出剛才那筆。
