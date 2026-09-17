create or replace function public.bsr_daily_autoheal()
returns jsonb
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_max_date  date;
  v_today     date := (now() at time zone 'Asia/Taipei')::date;
  v_lag_days  int;
  v_last_heal timestamptz;
  v_circuit   text;
  v_requeued  int := 0;
  v_switches  int := 0;
  v_jobs      int := 0;
  v_actions   jsonb := '[]'::jsonb;
begin
  select max(trade_date) into v_max_date from public.tw_bsr_daily;
  v_lag_days := v_today - coalesce(v_max_date, v_today - 999);

  if v_lag_days < 3 then
    return jsonb_build_object('healed', false, 'reason', 'fresh_enough',
                              'max_date', v_max_date, 'lag_days', v_lag_days);
  end if;

  select max(created_at) into v_last_heal
    from public.tw_bsr_degrade_events
   where api_name = 'finmind' and reason = 'autoheal_bsr_pipeline';

  if v_last_heal is not null and v_last_heal > now() - interval '6 hours' then
    return jsonb_build_object('healed', false, 'reason', 'cooldown',
                              'last_heal', v_last_heal, 'lag_days', v_lag_days);
  end if;

  select circuit_state into v_circuit from public.data_source_health where source = 'finmind_bsr';
  if v_circuit = 'open' then
    update public.data_source_health
       set circuit_state = 'half_open', consecutive_failures = 0,
           fail_count_10m = 0, ok_count_10m = 0, disabled_until = null, updated_at = now()
     where source = 'finmind_bsr'
       and (last_failure_at is null or last_failure_at < now() - interval '2 hours');
    if found then
      v_actions := v_actions || jsonb_build_array('circuit_reset_half_open');
    end if;
  end if;

  update public.system_kill_switches
     set enabled = true, disabled_at = null, disabled_reason = null,
         auto_trigger_metric = 'autoheal_bsr_pipeline', updated_at = now()
   where key in ('chips_all', 'chips_backfill', 'chips_keepwarm', 'chips_interactive')
     and enabled = false;
  get diagnostics v_switches = row_count;
  if v_switches > 0 then
    v_actions := v_actions || jsonb_build_array('switches_reopened:' || v_switches);
  end if;

  with stale as (
    select id, row_number() over (order by priority nulls last, id) rn
      from public.tw_bsr_sync_queue
     where status = 'pending'
       and (next_run_at is null or next_run_at < now() - interval '2 hours')
  )
  update public.tw_bsr_sync_queue q
     set next_run_at = now() + ((s.rn / 30)::int * interval '10 minutes'),
         attempts = 0, updated_at = now()
    from stale s
   where q.id = s.id;
  get diagnostics v_requeued = row_count;
  if v_requeued > 0 then
    v_actions := v_actions || jsonb_build_array('requeued:' || v_requeued);
  end if;

  select count(*) into v_jobs
    from cron.job
   where active = false
     and jobname in ('tw-bsr-worker-hourly', 'tw-bsr-worker-trading', 'tw-bsr-worker-weekend',
                     'tw-bsr-worker-tier1-catchup', 'tw-bsr-enqueue-post-close',
                     'tw-bsr-enqueue-holdings-delta');
  if v_jobs > 0 then
    perform cron.alter_job(jobid, active := true)
       from cron.job
      where active = false
        and jobname in ('tw-bsr-worker-hourly', 'tw-bsr-worker-trading', 'tw-bsr-worker-weekend',
                        'tw-bsr-worker-tier1-catchup', 'tw-bsr-enqueue-post-close',
                        'tw-bsr-enqueue-holdings-delta');
    v_actions := v_actions || jsonb_build_array('cron_reactivated:' || v_jobs);
  end if;

  insert into public.tw_bsr_degrade_events (api_name, from_mode, to_mode, reason, detail)
  values ('finmind', 'stalled', 'healing', 'autoheal_bsr_pipeline',
          jsonb_build_object('max_date', v_max_date, 'lag_days', v_lag_days, 'actions', v_actions));

  return jsonb_build_object('healed', true, 'max_date', v_max_date, 'lag_days', v_lag_days,
                            'requeued', v_requeued, 'switches', v_switches,
                            'cron_reactivated', v_jobs, 'actions', v_actions);
end;
$$;

revoke all on function public.bsr_daily_autoheal() from public;
revoke all on function public.bsr_daily_autoheal() from anon;
revoke all on function public.bsr_daily_autoheal() from authenticated;
grant execute on function public.bsr_daily_autoheal() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'tw-bsr-daily-autoheal';
select cron.schedule('tw-bsr-daily-autoheal', '22 * * * *', 'select public.bsr_daily_autoheal();');