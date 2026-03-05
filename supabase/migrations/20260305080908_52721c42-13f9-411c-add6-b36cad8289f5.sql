INSERT INTO public.payment_providers (provider_type, display_name, is_active, is_default, config)
VALUES ('acpay', 'ACpay 信用卡', true, false, '{"mode": "sandbox"}'::jsonb);