-- Manual renewal model: change auto_renew defaults to false and update existing rows
ALTER TABLE public.member_subscriptions ALTER COLUMN auto_renew SET DEFAULT false;
ALTER TABLE public.checkup_subscriptions ALTER COLUMN auto_renew SET DEFAULT false;

UPDATE public.member_subscriptions SET auto_renew = false WHERE auto_renew = true;
UPDATE public.checkup_subscriptions SET auto_renew = false WHERE auto_renew = true;