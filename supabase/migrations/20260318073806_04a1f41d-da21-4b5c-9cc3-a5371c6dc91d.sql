UPDATE member_subscriptions 
SET status = 'active', auto_renew = true, canceled_at = NULL 
WHERE user_id = 'b0e9255e-b8cb-47df-8ebc-3ee842a45266' AND status = 'canceled';

UPDATE member_line_bindings 
SET is_active = true 
WHERE user_id = 'b0e9255e-b8cb-47df-8ebc-3ee842a45266';