
-- Remove the duplicate trade_record (keep the original one)
DELETE FROM public.trade_records 
WHERE id = '3442f72c-36b1-4c3c-b361-2e2c7908cfad';

-- Insert missing trade_signal for the existing open position
INSERT INTO public.trade_signals (user_id, symbol, name, entry_price, status)
VALUES ('e0633a1f-5d39-40e0-ad50-0e31061c86bb', '2330', '台積電', 1050, 'open');
