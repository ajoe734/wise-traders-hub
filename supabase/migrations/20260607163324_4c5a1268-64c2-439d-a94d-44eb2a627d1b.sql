
-- 1) Partial unique indexes to block duplicate active subscriptions at DB level
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_sub_active_user_plan
  ON public.member_subscriptions (user_id, plan_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_checkup_sub_active_user_plan
  ON public.checkup_subscriptions (user_id, plan_id)
  WHERE status = 'active';

-- 2) Add FK user_id -> auth.users with CASCADE (only if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_subscriptions_user_id_fkey' AND conrelid = 'public.member_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.member_subscriptions
      ADD CONSTRAINT member_subscriptions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkup_subscriptions_user_id_fkey' AND conrelid = 'public.checkup_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.checkup_subscriptions
      ADD CONSTRAINT checkup_subscriptions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3) Recreate expert_line_channels.expert_id FK with ON DELETE CASCADE
ALTER TABLE public.expert_line_channels
  DROP CONSTRAINT IF EXISTS expert_line_channels_expert_id_fkey;
ALTER TABLE public.expert_line_channels
  ADD CONSTRAINT expert_line_channels_expert_id_fkey
  FOREIGN KEY (expert_id) REFERENCES public.experts(id) ON DELETE CASCADE;
