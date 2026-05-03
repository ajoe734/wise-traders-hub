-- Track price-fetch failures from Free Checkup backfill
create table if not exists public.checkup_price_misses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  symbol text not null,
  reason text not null,
  attempts int not null default 1,
  last_error text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists checkup_price_misses_user_symbol_idx
  on public.checkup_price_misses (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), symbol);

alter table public.checkup_price_misses enable row level security;

create policy "Users view their own price misses"
  on public.checkup_price_misses for select
  to authenticated
  using (user_id = auth.uid());

create policy "Company admins view all price misses"
  on public.checkup_price_misses for select
  to authenticated
  using (public.has_role(auth.uid(), 'company_admin'::app_role));
