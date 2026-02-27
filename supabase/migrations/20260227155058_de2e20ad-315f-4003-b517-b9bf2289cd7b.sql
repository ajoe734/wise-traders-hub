
-- Temporarily drop foreign key constraints
ALTER TABLE public.expert_plans DROP CONSTRAINT expert_plans_expert_id_fkey;
ALTER TABLE public.expert_signals DROP CONSTRAINT expert_signals_expert_id_fkey;
ALTER TABLE public.trade_records DROP CONSTRAINT trade_records_expert_id_fkey;
ALTER TABLE public.member_line_bindings DROP CONSTRAINT member_line_bindings_expert_id_fkey;
ALTER TABLE public.line_binding_codes DROP CONSTRAINT line_binding_codes_expert_id_fkey;
ALTER TABLE public.expert_line_channels DROP CONSTRAINT expert_line_channels_expert_id_fkey;

-- Update experts table
UPDATE public.experts
SET id = 'b1000000-0000-0000-0000-000000000001'
WHERE id = 'a1000000-0000-0000-0000-000000000002';

-- Update all referencing tables
UPDATE public.expert_plans SET expert_id = 'b1000000-0000-0000-0000-000000000001' WHERE expert_id = 'a1000000-0000-0000-0000-000000000002';
UPDATE public.expert_signals SET expert_id = 'b1000000-0000-0000-0000-000000000001' WHERE expert_id = 'a1000000-0000-0000-0000-000000000002';
UPDATE public.trade_records SET expert_id = 'b1000000-0000-0000-0000-000000000001' WHERE expert_id = 'a1000000-0000-0000-0000-000000000002';
UPDATE public.member_line_bindings SET expert_id = 'b1000000-0000-0000-0000-000000000001' WHERE expert_id = 'a1000000-0000-0000-0000-000000000002';
UPDATE public.line_binding_codes SET expert_id = 'b1000000-0000-0000-0000-000000000001' WHERE expert_id = 'a1000000-0000-0000-0000-000000000002';
UPDATE public.expert_line_channels SET expert_id = 'b1000000-0000-0000-0000-000000000001' WHERE expert_id = 'a1000000-0000-0000-0000-000000000002';

-- Re-add foreign key constraints
ALTER TABLE public.expert_plans ADD CONSTRAINT expert_plans_expert_id_fkey FOREIGN KEY (expert_id) REFERENCES public.experts(id);
ALTER TABLE public.expert_signals ADD CONSTRAINT expert_signals_expert_id_fkey FOREIGN KEY (expert_id) REFERENCES public.experts(id);
ALTER TABLE public.trade_records ADD CONSTRAINT trade_records_expert_id_fkey FOREIGN KEY (expert_id) REFERENCES public.experts(id);
ALTER TABLE public.member_line_bindings ADD CONSTRAINT member_line_bindings_expert_id_fkey FOREIGN KEY (expert_id) REFERENCES public.experts(id);
ALTER TABLE public.line_binding_codes ADD CONSTRAINT line_binding_codes_expert_id_fkey FOREIGN KEY (expert_id) REFERENCES public.experts(id);
ALTER TABLE public.expert_line_channels ADD CONSTRAINT expert_line_channels_expert_id_fkey FOREIGN KEY (expert_id) REFERENCES public.experts(id);
