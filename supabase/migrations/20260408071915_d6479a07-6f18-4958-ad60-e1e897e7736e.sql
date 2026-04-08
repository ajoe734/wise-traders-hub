
ALTER TABLE public.user_performances DROP CONSTRAINT user_performances_pkey;
ALTER TABLE public.user_performances ADD PRIMARY KEY (user_id, signal_id);
