UPDATE member_subscriptions 
SET status = 'active', auto_renew = true, canceled_at = NULL 
WHERE id = '4456469e-a799-4218-89fd-c709137b7a34';

UPDATE member_line_bindings 
SET is_active = true 
WHERE user_id = 'b0e9255e-b8cb-47df-8ebc-3ee842a45266' 
AND expert_id = (SELECT expert_id FROM expert_plans WHERE id = (SELECT plan_id FROM member_subscriptions WHERE id = '4456469e-a799-4218-89fd-c709137b7a34'));