
-- Add more advisor experts (跟單派)
INSERT INTO public.experts (id, user_id, slug, name, role, status, bio) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'chen-weiming', '陳威明', 'advisor', 'active', '專注於台股短線操作，擅長技術分析與籌碼面研判'),
  ('a2000000-0000-0000-0000-000000000002', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'wang-junhao', '王俊豪', 'advisor', 'active', '深耕台股中長線佈局，善於掌握產業趨勢');

-- Add more mentor experts (修煉派)
INSERT INTO public.experts (id, user_id, slug, name, role, status, bio) VALUES
  ('a2000000-0000-0000-0000-000000000003', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'li-mingzhe', '李明哲', 'mentor', 'active', '實戰經驗超過15年，專注於教授價值投資策略'),
  ('a2000000-0000-0000-0000-000000000004', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', 'huang-yating', '黃雅婷', 'mentor', 'active', '從散戶到專業操盤手的實戰歷程，分享心法與技巧');

-- Create plans for new experts
INSERT INTO public.expert_plans (id, expert_id, name, plan_type, price_monthly, is_active, review_status) VALUES
  ('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', '陳威明 跟單方案', 'analyst_signal_l1', 1699, true, 'approved'),
  ('b2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', '王俊豪 跟單方案', 'analyst_signal_l1', 1699, true, 'approved'),
  ('b2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000003', '李明哲 修煉方案', 'mentor_weekly_journal', 799, true, 'approved'),
  ('b2000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000004', '黃雅婷 修煉方案', 'mentor_weekly_journal', 799, true, 'approved');

-- Create subscriptions for demo user (217eb240-f856-4ed1-8eea-f2667cabde57)
INSERT INTO public.member_subscriptions (user_id, plan_id, status, started_at) VALUES
  ('217eb240-f856-4ed1-8eea-f2667cabde57', 'b2000000-0000-0000-0000-000000000001', 'active', now()),
  ('217eb240-f856-4ed1-8eea-f2667cabde57', 'b2000000-0000-0000-0000-000000000002', 'active', now()),
  ('217eb240-f856-4ed1-8eea-f2667cabde57', 'b2000000-0000-0000-0000-000000000003', 'active', now()),
  ('217eb240-f856-4ed1-8eea-f2667cabde57', 'b2000000-0000-0000-0000-000000000004', 'active', now());
