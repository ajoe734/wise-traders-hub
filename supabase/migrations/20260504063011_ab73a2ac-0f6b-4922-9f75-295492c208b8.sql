-- payment_settings_safe: SECURITY INVOKER masked view
-- 目的：避免 UI/console 任何情況下曝露 ECPay HashKey / HashIV 等敏感字串。
-- - 非敏感 key（remittance_account / split_standard / cross_discounts ...）原樣回傳
-- - ecpay_credentials：移除 hash_key / hash_iv 原值，僅保留 has_hash_key / has_hash_iv 與末四碼
-- RLS 仍由底層 payment_settings 控制（security_invoker = true）。

CREATE OR REPLACE VIEW public.payment_settings_safe
WITH (security_invoker = true) AS
SELECT
  ps.id,
  ps.key,
  ps.updated_by,
  ps.updated_at,
  CASE
    WHEN ps.key = 'ecpay_credentials' THEN
      jsonb_strip_nulls(jsonb_build_object(
        'merchant_id',       ps.value->>'merchant_id',
        'api_url',           ps.value->>'api_url',
        'credit_action_url', ps.value->>'credit_action_url',
        'env',               ps.value->>'env',
        'has_hash_key', ((ps.value ? 'hash_key')
                          AND length(coalesce(ps.value->>'hash_key','')) > 0),
        'has_hash_iv',  ((ps.value ? 'hash_iv')
                          AND length(coalesce(ps.value->>'hash_iv','')) > 0),
        'hash_key_last4',
          CASE WHEN length(coalesce(ps.value->>'hash_key','')) >= 4
               THEN '***' || right(ps.value->>'hash_key', 4) END,
        'hash_iv_last4',
          CASE WHEN length(coalesce(ps.value->>'hash_iv','')) >= 4
               THEN '***' || right(ps.value->>'hash_iv', 4) END
      ))
    ELSE ps.value
  END AS value
FROM public.payment_settings ps;

GRANT SELECT ON public.payment_settings_safe TO authenticated, anon;

COMMENT ON VIEW public.payment_settings_safe IS
  'Masked view of payment_settings. ecpay_credentials hash_key/hash_iv are stripped to ***last4 + has_* flags. RLS inherited from base table via security_invoker.';