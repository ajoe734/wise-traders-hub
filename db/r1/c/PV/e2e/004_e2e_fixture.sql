-- =====================================================================
-- PV-E2E 004 — SYNTHETIC fixture for the real-browser admin E2E stage.
-- NOTHING here is copied from production content. Two teachers x two weeks,
-- one company_admin, one plain member, one anonymous caller (no row).
-- User ids are the ones GoTrue actually minted (passed in with -v).
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = warning;

-- wipe the shape fixture: this clone is for the E2E stage only
DELETE FROM public.trade_records;
DELETE FROM public.expert_signals;
DELETE FROM public.expert_signal_templates;
DELETE FROM public.member_subscriptions;
DELETE FROM public.expert_plans;
DELETE FROM public.experts;
DELETE FROM public.user_roles;
DELETE FROM public.profiles;

-- ---------------------------------------------------------------- identities
INSERT INTO public.profiles (user_id, display_name, expert_slug, is_tester) VALUES
  (:'ua'::uuid, 'PVE Teacher Alpha', 'pve-alpha', false),
  (:'ub'::uuid, 'PVE Teacher Beta',  'pve-beta',  false),
  (:'uadm'::uuid, 'PVE Company Admin', NULL, false),
  (:'umem'::uuid, 'PVE Member', NULL, false);

INSERT INTO public.user_roles (user_id, role) VALUES
  (:'uadm'::uuid, 'company_admin'),
  (:'ua'::uuid, 'analyst'),
  (:'ub'::uuid, 'analyst');

-- ---------------------------------------------------------------- experts
INSERT INTO public.experts
  (id, user_id, slug, name, role, status, currency, asset_class, starting_capital, description)
VALUES
  ('aaaaaaaa-0000-4000-9000-000000000001', :'ua'::uuid, 'pve-alpha', 'PVE Alpha 老師',
   'mentor', 'active', 'USD', 'us_stock', 100000, 'synthetic mentor'),
  ('bbbbbbbb-0000-4000-9000-000000000002', :'ub'::uuid, 'pve-beta', 'PVE Beta 老師',
   'advisor', 'active', 'TWD', 'tw_stock', 3000000, 'synthetic advisor');

INSERT INTO public.expert_plans (id, expert_id, name, plan_type, price_monthly, is_active, review_status) VALUES
  ('aaaaaaaa-0000-4000-9100-000000000001', 'aaaaaaaa-0000-4000-9000-000000000001', 'Alpha 週記', 'mentor_weekly_journal', 1200, true, 'approved'),
  ('bbbbbbbb-0000-4000-9100-000000000002', 'bbbbbbbb-0000-4000-9000-000000000002', 'Beta 訊號', 'analyst_signal_l1', 900, true, 'approved');

-- ---------------------------------------------------------------- prices
INSERT INTO public.current_prices (symbol, name, price, currency, market, asset_class) VALUES
  ('SOXL','Direxion Semis Bull', 25.10,'USD','US','us_stock'),
  ('QCOM','Qualcomm',           168.20,'USD','US','us_stock'),
  ('ORCL','Oracle',             142.50,'USD','US','us_stock'),
  ('AMD','AMD',                 176.40,'USD','US','us_stock'),
  ('SPACEX','SpaceX pre-IPO',   112.00,'USD','US','us_stock'),
  ('2330','台積電',              1085.00,'TWD','TW','tw_stock'),
  ('6505','台塑化',                48.35,'TWD','TW','tw_stock');

-- ---------------------------------------------------------------- trades (Alpha, USD)
-- non-zero economics + ONE genuine quantity = 0 row (true zero, must render 「0 股」)
INSERT INTO public.trade_records
  (id, expert_id, instrument, entry_price, current_price, quantity, quantity_unit, status, market, currency, entry_date, created_at)
VALUES
  ('aaaa0001-0000-4000-a000-000000000001','aaaaaaaa-0000-4000-9000-000000000001','SOXL Direxion Semis Bull', 22.50, 25.10, 300,'股','open','US','USD','2026-08-03T13:35:00Z','2026-08-03T13:35:00Z'),
  ('aaaa0002-0000-4000-a000-000000000002','aaaaaaaa-0000-4000-9000-000000000001','QCOM Qualcomm',           150.00,168.20, 100,'股','open','US','USD','2026-08-04T13:40:00Z','2026-08-04T13:40:00Z'),
  ('aaaa0003-0000-4000-a000-000000000003','aaaaaaaa-0000-4000-9000-000000000001','ORCL Oracle',             130.00,142.50,  50,'股','open','US','USD','2026-08-05T13:45:00Z','2026-08-05T13:45:00Z'),
  ('aaaa0004-0000-4000-a000-000000000004','aaaaaaaa-0000-4000-9000-000000000001','SPACEX SpaceX pre-IPO',   112.00,112.00,   0,'股','open','US','USD','2026-08-06T13:45:00Z','2026-08-06T13:45:00Z');

INSERT INTO public.trade_records
  (id, expert_id, instrument, entry_price, exit_price, current_price, pnl_percent, quantity, quantity_unit, status, market, currency, entry_date, exit_date, created_at)
VALUES
  ('aaaa0005-0000-4000-a000-000000000005','aaaaaaaa-0000-4000-9000-000000000001','AMD AMD', 160.00, 176.40, 176.40, 10.25, 80,'股','closed','US','USD','2026-07-28T13:35:00Z','2026-08-07T13:55:00Z','2026-07-28T13:35:00Z');

-- ---------------------------------------------------------------- trades (Beta, TWD)
INSERT INTO public.trade_records
  (id, expert_id, instrument, entry_price, current_price, quantity, quantity_unit, status, market, currency, entry_date, created_at)
VALUES
  ('bbbb0001-0000-4000-b000-000000000001','bbbbbbbb-0000-4000-9000-000000000002','2330 台積電', 1010.00, 1085.00, 2000,'股','open','TW','TWD','2026-08-03T01:10:00Z','2026-08-03T01:10:00Z'),
  ('bbbb0002-0000-4000-b000-000000000002','bbbbbbbb-0000-4000-9000-000000000002','6505 台塑化',   50.10,   48.35, 5000,'股','open','TW','TWD','2026-08-05T01:20:00Z','2026-08-05T01:20:00Z');

-- ---------------------------------------------------------------- journal content
-- Two teachers x two weeks. Week 1 = 2026-08-03..08-09, week 2 = 2026-08-10..08-16 (Taipei).
-- Timezone boundary pair: 15:59:59Z (=23:59:59 Taipei, week 1) vs 16:00:00Z (=00:00 Taipei, week 2).
INSERT INTO public.expert_signals
  (id, expert_id, plan_id, instrument, action, status, market, quantity, quantity_unit, price_hint,
   reason_summary, reason_detail, learning_points, teaching_topic, published_at, created_at)
VALUES
  ('aaaa1001-0000-4000-c000-000000000001','aaaaaaaa-0000-4000-9000-000000000001','aaaaaaaa-0000-4000-9100-000000000001',
   'SOXL Direxion Semis Bull','buy','published','US',300,'股',22.50,
   'PVE-W1-ALPHA-SUMMARY','PVE-W1-ALPHA-BODY 本週建立半導體多方部位，分批進場。',
   'PVE-W1-ALPHA-LEARN 控制單筆風險 2%。','半導體週期',
   '2026-08-03T13:40:00Z','2026-08-03T13:40:00Z'),
  ('aaaa1002-0000-4000-c000-000000000002','aaaaaaaa-0000-4000-9000-000000000001','aaaaaaaa-0000-4000-9100-000000000001',
   'QCOM Qualcomm','add','published','US',100,'股',150.00,
   'PVE-W1-EDGE-2359-SUMMARY','PVE-W1-EDGE-2359-BODY 台北時間 23:59:59 落在第一週。',
   'PVE-W1-EDGE-2359-LEARN','週界線',
   '2026-08-09T15:59:59Z','2026-08-09T15:59:59Z'),
  ('aaaa1003-0000-4000-c000-000000000003','aaaaaaaa-0000-4000-9000-000000000001','aaaaaaaa-0000-4000-9100-000000000001',
   'SPACEX SpaceX pre-IPO','teaching','published','US',0,'股',112.00,
   'PVE-W2-EDGE-0000-SUMMARY','PVE-W2-EDGE-0000-BODY 台北時間 00:00:00 已屬第二週。',
   'PVE-W2-EDGE-0000-LEARN','週界線',
   '2026-08-09T16:00:00Z','2026-08-09T16:00:00Z'),
  ('aaaa1004-0000-4000-c000-000000000004','aaaaaaaa-0000-4000-9000-000000000001','aaaaaaaa-0000-4000-9100-000000000001',
   'ORCL Oracle','buy','published','US',50,'股',130.00,
   'PVE-W2-ALPHA-SUMMARY','PVE-W2-ALPHA-BODY 第二週加入雲端股，續抱 AMD 已了結。',
   'PVE-W2-ALPHA-LEARN 留意財報日。','雲端',
   '2026-08-12T13:40:00Z','2026-08-12T13:40:00Z'),
  ('bbbb1001-0000-4000-d000-000000000001','bbbbbbbb-0000-4000-9000-000000000002','bbbbbbbb-0000-4000-9100-000000000002',
   '2330 台積電','buy','published','TW',2000,'股',1010.00,
   'PVE-W1-BETA-SUMMARY','PVE-W1-BETA-BODY 第一週布局權值股。','PVE-W1-BETA-LEARN','權值股',
   '2026-08-03T01:15:00Z','2026-08-03T01:15:00Z'),
  ('bbbb1002-0000-4000-d000-000000000002','bbbbbbbb-0000-4000-9000-000000000002','bbbbbbbb-0000-4000-9100-000000000002',
   '6505 台塑化','trim','published','TW',5000,'股',50.10,
   'PVE-W2-BETA-SUMMARY','PVE-W2-BETA-BODY 第二週減碼塑化。','PVE-W2-BETA-LEARN','塑化',
   '2026-08-12T01:25:00Z','2026-08-12T01:25:00Z');

INSERT INTO public.expert_signal_templates (expert_id, title, action, reason, risk_note, strategy_note, sort_order)
VALUES ('aaaaaaaa-0000-4000-9000-000000000001','PVE 模板','buy','synthetic','synthetic','synthetic',0);
