-- Enforce user_performances.current_price to come from current_prices only
create or replace function public.enforce_user_performance_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price numeric;
begin
  select cp.price
  into v_price
  from public.current_prices cp
  where cp.symbol = new.symbol
  limit 1;

  if v_price is null then
    new.current_price := null;
    new.pnl := null;
    new.pnl_percent := null;
  else
    new.current_price := v_price;

    if new.entry_price is not null and new.entry_price > 0 then
      new.pnl := round((v_price - new.entry_price)::numeric, 3);
      new.pnl_percent := round((((v_price - new.entry_price) / new.entry_price) * 100)::numeric, 2);
    else
      new.pnl := null;
      new.pnl_percent := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_user_performances_price_guard on public.user_performances;
create trigger trg_user_performances_price_guard
before insert or update on public.user_performances
for each row
execute function public.enforce_user_performance_price();

-- Fix existing rows when current_prices has no price
update public.user_performances up
set current_price = null,
    pnl = null,
    pnl_percent = null
where not exists (
  select 1
  from public.current_prices cp
  where cp.symbol = up.symbol
    and cp.price is not null
);