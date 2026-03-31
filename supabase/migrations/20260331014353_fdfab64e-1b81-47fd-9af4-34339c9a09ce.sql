ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS line_user_id text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_line_user_id_unique ON public.profiles (line_user_id) WHERE line_user_id IS NOT NULL;