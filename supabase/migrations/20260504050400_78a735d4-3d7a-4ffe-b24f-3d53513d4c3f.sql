-- 1. Allow 'awaiting_info' status on remittance_orders
ALTER TABLE public.remittance_orders DROP CONSTRAINT IF EXISTS remittance_orders_status_check;
ALTER TABLE public.remittance_orders ADD CONSTRAINT remittance_orders_status_check
  CHECK (status IN ('awaiting_info','pending','confirmed','rejected','expired'));

-- 2. Add 'remittance' to provider_type enum
ALTER TYPE provider_type ADD VALUE IF NOT EXISTS 'remittance';
