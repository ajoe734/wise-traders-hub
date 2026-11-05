CREATE OR REPLACE FUNCTION public.recompute_expert_promo(_expert_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
-- 前 20 筆不抽成改為「每月薪資前 20 筆」，由月結薪資計算（src/lib/expertPayroll.ts）套用；
-- 分潤紀錄一律回到原比例，此函式只負責把舊的 first20_free 還原。
DECLARE r record; changed int := 0; new_plat numeric; new_exp numeric; new_src text;
BEGIN
  IF _expert_id IS NULL THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM revenue_splits WHERE expert_id=_expert_id AND rule_source='first20_free' LOOP
    new_plat := round(r.net * coalesce((r.rule_snapshot->>'pct_platform')::numeric, 55) / 100);
    new_exp := r.net - new_plat;
    new_src := coalesce(r.base_rule_source, 'standard_default');
    UPDATE revenue_splits SET platform_amount=new_plat, expert_amount=new_exp, rule_source=new_src WHERE id=r.id;
    INSERT INTO audit_logs(action,target_type,target_id,detail) VALUES ('first20_promo_revert','revenue_split',r.id,
      jsonb_build_object('expert_id',_expert_id,'reason','改為每月薪資前20筆',
        'before',jsonb_build_object('platform',r.platform_amount,'expert',r.expert_amount,'rule_source',r.rule_source),
        'after',jsonb_build_object('platform',new_plat,'expert',new_exp,'rule_source',new_src)));
    changed := changed + 1;
  END LOOP;
  RETURN changed;
END $function$;