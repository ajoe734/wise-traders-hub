CREATE TABLE public.plaid_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id),
  environment text NOT NULL DEFAULT 'sandbox',
  item_id text,
  institution_id text,
  institution_name text,
  status text NOT NULL DEFAULT 'active',
  sync_blocked boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  last_sync_status text,
  last_error text,
  disconnect_requested_at timestamptz,
  revoke_deadline_at timestamptz,
  revoked_at timestamptz,
  purged_at timestamptz,
  revoke_attempts integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_plaid_connections_expert ON public.plaid_connections(expert_id);
CREATE UNIQUE INDEX uq_plaid_connections_active ON public.plaid_connections(expert_id) WHERE status = 'active';

CREATE TABLE public.plaid_access_tokens (
  connection_id uuid PRIMARY KEY REFERENCES public.plaid_connections(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.plaid_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.plaid_connections(id) ON DELETE CASCADE,
  expert_id uuid NOT NULL,
  trigger text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'running',
  error_code text,
  holdings_count integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX idx_plaid_sync_runs_conn ON public.plaid_sync_runs(connection_id, started_at DESC);

CREATE TABLE public.plaid_holding_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.plaid_connections(id) ON DELETE CASCADE,
  expert_id uuid NOT NULL,
  sync_run_id uuid,
  security_id text,
  symbol text,
  name text,
  security_type text,
  quantity numeric,
  cost_basis numeric,
  close_price numeric,
  currency text,
  as_of date,
  review_status text NOT NULL DEFAULT 'draft',
  confirmed_at timestamptz,
  confirmed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_plaid_drafts_conn ON public.plaid_holding_drafts(connection_id);

GRANT SELECT ON public.plaid_connections TO authenticated;
GRANT SELECT ON public.plaid_sync_runs TO authenticated;
GRANT SELECT ON public.plaid_holding_drafts TO authenticated;
GRANT ALL ON public.plaid_connections, public.plaid_access_tokens, public.plaid_sync_runs, public.plaid_holding_drafts TO service_role;
REVOKE ALL ON public.plaid_access_tokens FROM anon, authenticated;

ALTER TABLE public.plaid_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plaid_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plaid_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plaid_holding_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Expert owner or admin reads plaid connections" ON public.plaid_connections
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'company_admin')
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = plaid_connections.expert_id AND e.user_id = auth.uid()));
CREATE POLICY "Expert owner or admin reads plaid sync runs" ON public.plaid_sync_runs
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'company_admin')
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = plaid_sync_runs.expert_id AND e.user_id = auth.uid()));
CREATE POLICY "Expert owner or admin reads plaid drafts" ON public.plaid_holding_drafts
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'company_admin')
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = plaid_holding_drafts.expert_id AND e.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.plaid_replace_drafts(_connection_id uuid, _run_id uuid, _rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; n integer;
BEGIN
  SELECT * INTO c FROM public.plaid_connections WHERE id = _connection_id FOR UPDATE;
  IF c IS NULL OR c.status <> 'active' OR c.sync_blocked THEN
    RAISE EXCEPTION 'plaid_sync_blocked' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.plaid_holding_drafts WHERE connection_id = _connection_id AND review_status = 'draft';
  INSERT INTO public.plaid_holding_drafts (connection_id, expert_id, sync_run_id, security_id, symbol, name, security_type, quantity, cost_basis, close_price, currency, as_of)
  SELECT _connection_id, c.expert_id, _run_id, r->>'security_id', r->>'symbol', r->>'name', r->>'security_type',
         NULLIF(r->>'quantity','')::numeric, NULLIF(r->>'cost_basis','')::numeric, NULLIF(r->>'close_price','')::numeric,
         r->>'currency', NULLIF(r->>'as_of','')::date
  FROM jsonb_array_elements(_rows) r;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.plaid_connections SET last_sync_at = now(), last_sync_status = 'ok', last_error = NULL, updated_at = now() WHERE id = _connection_id;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.plaid_replace_drafts(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plaid_replace_drafts(uuid, uuid, jsonb) TO service_role;

SELECT cron.schedule('plaid-revoke-retry', '7 * * * *', $$SELECT public.cron_edge_call('plaid-link', '{"action":"retry_revokes"}'::jsonb)$$);
SELECT cron.schedule('plaid-daily-sync', '30 22 * * 1-5', $$SELECT public.cron_edge_call('plaid-link', '{"action":"sync_all"}'::jsonb, 120000)$$);