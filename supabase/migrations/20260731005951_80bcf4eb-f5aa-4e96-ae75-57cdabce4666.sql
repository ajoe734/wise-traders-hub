CREATE TABLE public.line_push_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL,
  recipient text NOT NULL,
  expert_id uuid,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX line_push_receipts_key_recipient_uidx
  ON public.line_push_receipts (dedupe_key, recipient);
CREATE INDEX line_push_receipts_sent_at_idx ON public.line_push_receipts (sent_at);

GRANT ALL ON public.line_push_receipts TO service_role;

ALTER TABLE public.line_push_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages line push receipts"
ON public.line_push_receipts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);