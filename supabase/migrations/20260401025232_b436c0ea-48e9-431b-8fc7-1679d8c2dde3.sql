
CREATE TABLE public.checkup_prediction_accuracy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_type TEXT,
  pred TEXT NOT NULL,
  actual TEXT NOT NULL,
  was_correct BOOLEAN NOT NULL DEFAULT false,
  reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.checkup_prediction_accuracy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read prediction accuracy"
  ON public.checkup_prediction_accuracy FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert prediction accuracy"
  ON public.checkup_prediction_accuracy FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
