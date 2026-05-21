
ALTER TABLE public.remittance_orders
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS remittance_orders_user_client_req_idx
  ON public.remittance_orders(user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'remittance_orders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.remittance_orders';
  END IF;
END $$;

ALTER TABLE public.remittance_orders REPLICA IDENTITY FULL;
