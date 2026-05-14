## 真正的問題：DB trigger 引用了不存在的 enum 值

5/8 cron **有跑**，而且找到 6 筆 pending signals，但 batch update `status='published'` 直接被資料庫擋下，整批 rollback：

```
2026-05-08 12:00:03 ERROR mark_published
invalid input value for enum signal_status: "taken_down"
signalIds: [fb6cdfd4..., 1a3a1505..., 47aba5f5..., d577560c..., d9cc216c..., d5b50afe...]
```

（這 6 筆就是 5/4、5/7、5/8 的訊號，到現在還是 `pending` + `published_at` 已填，所以 UI 看得到舊的 5/4，但永遠卡在 pending、不會 push、不會 trigger trade。5/13、5/14 的也是同樣狀況。）

### 為什麼會噴 enum 錯誤

歷史脈絡：
- 最早 `signal_status enum = ('published','taken_down')`
- 後來改成 `('pending','published')`，把「收回」改用 DELETE 路徑
- **但 BEFORE UPDATE trigger `enforce_signal_recall_same_day` 沒改乾淨**，裡面還留著：
  ```sql
  IF OLD.status = 'published' AND NEW.status = 'taken_down' THEN ...
  ```
- Postgres 在執行 trigger 時要把字串 `'taken_down'` cast 成 `signal_status` enum，enum 裡沒這個值 → 整個 UPDATE 失敗

→ 結果：**任何 UPDATE expert_signals 都會炸**。publish cron、編輯訊號、`handle_signal_trade` 在 UPDATE 路徑全部受影響。週五 cron 從這個 trigger 部署後就一直靜默失敗。

### 修復方案

寫一個 migration，重建 `enforce_signal_recall_same_day()`，把 UPDATE 分支移除（recall 已改走 DELETE，那段是 dead code），只保留 DELETE 分支：

```sql
CREATE OR REPLACE FUNCTION public.enforce_signal_recall_same_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pub_day date; today_tw date;
BEGIN
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'company_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' AND OLD.published_at IS NOT NULL THEN
      pub_day  := (OLD.published_at AT TIME ZONE 'Asia/Taipei')::date;
      today_tw := (now()           AT TIME ZONE 'Asia/Taipei')::date;
      IF pub_day <> today_tw THEN
        RAISE EXCEPTION 'RECALL_EXPIRED: 已過發布當日（台灣時間），不可刪除已發布訊號'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;  -- UPDATE: no restriction needed (recall is DELETE-only)
END $$;
```

順便把 `trg_enforce_signal_recall_same_day_upd` trigger 砍掉（function 留著給 DELETE trigger 用），這樣以後改 function 不會再有同樣問題。

### 補發 5/8、5/13、5/14 的訊號

migration 跑完之後，手動觸發一次 `publish-weekly-journals`（或直接一條 SQL 把這 6 筆 + 5/13、5/14 共 9 筆的 status 設成 `published`，由 `handle_signal_trade` trigger 帶動 trade_records 平倉）。

我建議走 edge function 那條路，因為它同時會：
- update status → published
- 同步 trade_records / user_performances
- push LINE 給訂閱者（雖然訊息延遲了，但至少資料一致）

如果你不想補 push，那就只跑 SQL update。

### 要你決定

1. **Migration 寫法**：直接砍掉 UPDATE trigger + 重建 function（建議），或保守一點把字串改 `::text` 比對讓 dead code 變安全
2. **補發方式**：(a) 重跑 cron edge function（會補 push LINE）／ (b) 只 SQL update status，不補 push
3. **cron 時間**：要不要順便從週五 20:00 改成 23:00？（你之前提到的期望）
