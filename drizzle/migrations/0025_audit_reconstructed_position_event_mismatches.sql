CREATE TABLE public.position_event_reconstruction_issues (
  expert_id uuid NOT NULL,
  symbol text NOT NULL,
  replay_quantity numeric NOT NULL DEFAULT 0,
  actual_quantity numeric NOT NULL DEFAULT 0,
  detected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (expert_id, symbol)
);

GRANT SELECT ON public.position_event_reconstruction_issues TO authenticated;
GRANT ALL ON public.position_event_reconstruction_issues TO service_role;
ALTER TABLE public.position_event_reconstruction_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authorized viewers can see position reconstruction issues"
ON public.position_event_reconstruction_issues
FOR SELECT
TO authenticated
USING (
  expert_id IN (SELECT expert_id FROM public.has_active_subscription(auth.uid()))
  OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'company_admin'::public.app_role)
  OR public.is_tester(auth.uid())
);

WITH replay AS (
  SELECT expert_id, symbol,
         (array_agg(quantity_after ORDER BY event_at DESC, created_at DESC))[1] AS replay_qty
  FROM public.position_events
  GROUP BY expert_id, symbol
),
actual AS (
  SELECT expert_id, split_part(btrim(instrument), ' ', 1) AS symbol, SUM(quantity) AS actual_qty
  FROM public.trade_records
  WHERE status = 'open'
  GROUP BY expert_id, split_part(btrim(instrument), ' ', 1)
)
INSERT INTO public.position_event_reconstruction_issues (expert_id, symbol, replay_quantity, actual_quantity)
SELECT COALESCE(r.expert_id, a.expert_id), COALESCE(r.symbol, a.symbol), COALESCE(r.replay_qty, 0), COALESCE(a.actual_qty, 0)
FROM replay r
FULL JOIN actual a USING (expert_id, symbol)
WHERE COALESCE(r.replay_qty, 0) <> COALESCE(a.actual_qty, 0);