ALTER TABLE public.revenue_splits DROP CONSTRAINT revenue_splits_rule_source_check;
ALTER TABLE public.revenue_splits ADD CONSTRAINT revenue_splits_rule_source_check CHECK (rule_source = ANY (ARRAY['plan_override','expert_override','standard_default','checkup_default','first20_free']));
ALTER TABLE public.revenue_splits ADD COLUMN IF NOT EXISTS base_rule_source text;

CREATE OR REPLACE FUNCTION public.recompute_expert_promo(_expert_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; changed int := 0; new_plat numeric; new_exp numeric; new_src text; locked_months text[];
BEGIN
  IF _expert_id IS NULL THEN RETURN 0; END IF;
  SELECT coalesce(array_agg(period_month), '{}') INTO locked_months FROM expert_payouts WHERE expert_id=_expert_id AND status='paid';
  FOR r IN
    WITH base AS (
      SELECT rs.*, coalesce(pt.paid_at, pt.created_at) AS pay_at,
        (coalesce(pt.paid_at, pt.created_at) AT TIME ZONE 'Asia/Taipei')::date AS pay_day,
        (pt.status='paid'
          AND NOT coalesce((SELECT is_tester FROM profiles p WHERE p.user_id=ms.user_id), false)
          AND coalesce((SELECT -sum(x.amount) FROM payment_transactions x WHERE x.subscription_id=pt.subscription_id AND x.status='refunded'),0) < pt.amount
        ) AS eligible
      FROM revenue_splits rs JOIN payment_transactions pt ON pt.id=rs.transaction_id
      LEFT JOIN member_subscriptions ms ON ms.id=pt.subscription_id
      WHERE rs.expert_id=_expert_id AND rs.rule_source <> 'checkup_default'
    ), ranked AS (
      SELECT b.*, CASE WHEN eligible THEN row_number() OVER (PARTITION BY eligible ORDER BY pay_at, transaction_id) END AS rnk FROM base b
    ) SELECT * FROM ranked
  LOOP
    IF r.rnk IS NOT NULL AND r.rnk <= 20 THEN
      new_plat := 0; new_exp := r.net; new_src := 'first20_free';
    ELSE
      new_plat := round(r.net * coalesce((r.rule_snapshot->>'pct_platform')::numeric, 55) / 100);
      new_exp := r.net - new_plat;
      new_src := coalesce(r.base_rule_source, CASE WHEN r.rule_source='first20_free' THEN 'standard_default' ELSE r.rule_source END);
    END IF;
    IF new_plat IS DISTINCT FROM r.platform_amount OR new_exp IS DISTINCT FROM r.expert_amount OR new_src IS DISTINCT FROM r.rule_source THEN
      UPDATE revenue_splits SET platform_amount=new_plat, expert_amount=new_exp, rule_source=new_src,
        base_rule_source=coalesce(r.base_rule_source, CASE WHEN r.rule_source='first20_free' THEN 'standard_default' ELSE r.rule_source END)
      WHERE id=r.id;
      INSERT INTO audit_logs(action,target_type,target_id,detail) VALUES ('first20_promo_recompute','revenue_split',r.id,
        jsonb_build_object('expert_id',_expert_id,'rank',r.rnk,'before',jsonb_build_object('platform',r.platform_amount,'expert',r.expert_amount,'rule_source',r.rule_source),
          'after',jsonb_build_object('platform',new_plat,'expert',new_exp,'rule_source',new_src),'pay_month',to_char(r.pay_day,'YYYY-MM'),'locked_months',to_jsonb(locked_months)));
      changed := changed + 1;
    END IF;
  END LOOP;
  RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.recompute_expert_promo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_expert_promo(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_split_promo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.recompute_expert_promo(NEW.expert_id); RETURN NULL; END $$;
CREATE TRIGGER revenue_splits_first20 AFTER INSERT ON public.revenue_splits FOR EACH ROW EXECUTE FUNCTION public.trg_split_promo();

CREATE OR REPLACE FUNCTION public.trg_tx_promo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e uuid;
BEGIN
  SELECT ep.expert_id INTO e FROM member_subscriptions ms JOIN expert_plans ep ON ep.id=ms.plan_id WHERE ms.id=NEW.subscription_id;
  IF e IS NOT NULL THEN PERFORM public.recompute_expert_promo(e); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER payment_tx_first20 AFTER INSERT OR UPDATE OF status ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.trg_tx_promo();
REVOKE ALL ON FUNCTION public.trg_split_promo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_tx_promo() FROM PUBLIC, anon, authenticated;