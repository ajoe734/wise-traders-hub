\set ON_ERROR_STOP on
-- Only run against the socket-only ephemeral harness, never the shared database.
DO $$ BEGIN
  ASSERT current_database() = 'bsr_ephemeral' AND inet_server_addr() IS NULL;
END $$;
BEGIN;
DO $$ DECLARE s jsonb; BEGIN
  s := public.history_backfill_status();
  ASSERT (s->>'scheduled')::boolean = false, 'empty queue must have no recurring job';
END $$;
ROLLBACK;