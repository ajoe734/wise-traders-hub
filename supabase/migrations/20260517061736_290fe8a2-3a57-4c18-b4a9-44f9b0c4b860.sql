create or replace function public.get_expert_detail_bundle(_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _is_tester boolean := coalesce(public.is_tester(_uid), false);
  _expert record;
  _plans jsonb;
  _plan_ids uuid[];
  _mine jsonb;
  _count integer := 0;
begin
  select * into _expert
  from public.experts e
  where e.slug = _slug
    and (
      e.status = 'active'
      or (e.status = 'draft' and _is_tester)
    )
  limit 1;

  if not found then
    return null;
  end if;

  select
    coalesce(jsonb_agg(to_jsonb(p.*) order by p.price_monthly), '[]'::jsonb),
    coalesce(array_agg(p.id), array[]::uuid[])
  into _plans, _plan_ids
  from public.expert_plans p
  where p.expert_id = _expert.id
    and p.is_active = true
    and p.review_status = 'approved';

  if array_length(_plan_ids, 1) is null then
    _plan_ids := array[]::uuid[];
  end if;

  if array_length(_plan_ids, 1) > 0 then
    select count(*) into _count
    from public.member_subscriptions ms
    where ms.plan_id = any(_plan_ids)
      and ms.status = 'active';
  end if;

  if _uid is not null and array_length(_plan_ids, 1) > 0 then
    select coalesce(jsonb_agg(ms.plan_id), '[]'::jsonb) into _mine
    from public.member_subscriptions ms
    where ms.user_id = _uid
      and ms.status = 'active'
      and ms.plan_id = any(_plan_ids);
  else
    _mine := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'expert', to_jsonb(_expert),
    'plans', _plans,
    'my_subscribed_plan_ids', _mine,
    'subscriber_count', _count
  );
end;
$$;

grant execute on function public.get_expert_detail_bundle(text) to anon, authenticated;