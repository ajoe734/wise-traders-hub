## 「確認入帳並啟用訂閱」失敗根因

**Edge function 回 500，被 DB trigger 擋掉。**

### 追查

1. 訂單 `ee11d930…` 是 pending 狀態、`expert_plan`、plan `ab1d8e55…`、user `d877ab36…`（彥凱）。
2. 彥凱在 `member_subscriptions` 已有一筆 `status='active'`、同 `plan_id`、`expires_at=2026-06-22`（就是前一輪那筆過期沒 flip 的）。
3. `confirm-remittance/index.ts` L39-51 走 `existing` 分支，用 service_role 執行 `UPDATE member_subscriptions SET expires_at=...`。
4. `member_subscriptions` 上掛了 `trg_protect_subscription_fields` BEFORE UPDATE trigger：

   ```sql
   IF has_role(auth.uid(), 'company_admin') THEN RETURN NEW; END IF;
   IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
     RAISE EXCEPTION 'You cannot modify subscription expiry';
   END IF;
   ```

   service_role 呼叫時 `auth.uid()` 是 NULL → `has_role` 回 false → trigger 直接丟例外 → edge function 500。

註解說「Allow service_role to update anything」，但**判斷式漏了 service_role**，只擋一半實作出來。**這是我當初留下的 bug**，跟你講聲對不起。

---

## 修法

### 1. 修 trigger — 讓 service_role 真的能繞過

新增 migration，改寫 `public.protect_subscription_fields()`：在 `has_role` 檢查前先放行 service_role。

```sql
CREATE OR REPLACE FUNCTION public.protect_subscription_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- Edge functions run as service_role and must bypass all field protection
  IF current_user = 'service_role'
     OR (current_setting('request.jwt.claim.role', true) = 'service_role')
  THEN
    RETURN NEW;
  END IF;

  IF has_role(auth.uid(), 'company_admin') THEN
    RETURN NEW;
  END IF;

  -- （下方原本的 status / expires_at / started_at / plan_id / provider_id 檢查照舊）
  ...
END;
$$;
```

同時檢查 `checkup_subscriptions` 是否也有同名 trigger，有就一併修（`confirm-remittance` 也會走 checkup 分支）。

### 2. 同步 flip 過期訂閱 status

順手把彥凱這筆 `expires_at < now()` 但 `status='active'` 的資料 flip 成 `expired`：

- 一次性 SQL：`UPDATE member_subscriptions SET status='expired' WHERE status='active' AND expires_at < now();`
- 若沒有排程 job 做這件事，另建一支或加到既有的 daily cron（`expire-stale-*` 系列已有 `expire-stale-remittance`，可能還缺 `expire-stale-subscriptions`）。這條**先問你要不要一起做**，或等你之後再排。

### 3. 驗證

- 修完 trigger 後，重新按「確認入帳並啟用訂閱」→ 應該 200、訂單 status → confirmed、`member_subscriptions.expires_at` 從 2026-06-22 延到 2026-08-04 附近（now + 30 天）。
- 跑 `bunx vitest run src/test/integration/1.13-field-protection-triggers.test.ts`（既有欄位保護整合測試，確認一般使用者仍被擋）。
- 手動再測一筆 checkup 匯款單，確認 checkup 路徑不炸。

---

## 要你決定

- **A**：只修 trigger（最小修法），過期訂閱 status flip 之後找機會做
- **B**：一起處理，這輪同時加「一次性 flip + daily cron」

我建議 **A**，先把眼前 500 解掉，flip 排程另開一輪好好設計（要不要通知使用者、cron 頻率、跟續訂窗的關係）。