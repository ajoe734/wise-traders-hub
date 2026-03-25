
-- Trigger function: when user_performances rows are deleted,
-- recalculate user_summaries. If no rows remain, zero out.
CREATE OR REPLACE FUNCTION recalc_user_summary_on_perf_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _remaining int;
  _total double precision;
  _avg double precision;
BEGIN
  SELECT count(*), coalesce(sum(pnl_percent), 0), coalesce(avg(pnl_percent), 0)
    INTO _remaining, _total, _avg
    FROM user_performances
   WHERE user_id = OLD.user_id;

  IF _remaining = 0 THEN
    UPDATE user_summaries
       SET total_pnl_percent = 0,
           avg_pnl_percent = 0,
           updated_at = now()
     WHERE user_id = OLD.user_id;
  ELSE
    UPDATE user_summaries
       SET total_pnl_percent = _total,
           avg_pnl_percent = _avg,
           updated_at = now()
     WHERE user_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_summary_on_perf_delete ON user_performances;
CREATE TRIGGER trg_recalc_summary_on_perf_delete
  AFTER DELETE ON user_performances
  FOR EACH ROW
  EXECUTE FUNCTION recalc_user_summary_on_perf_delete();

UPDATE user_summaries
   SET total_pnl_percent = 0,
       avg_pnl_percent = 0,
       updated_at = now()
 WHERE user_id NOT IN (SELECT DISTINCT user_id FROM user_performances);
