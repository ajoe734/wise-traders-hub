-- Stage 3B / S3B-0 共用殘留快照協定（v4.1 §S3B-0 第 4 條）
--
-- 每個會碰 producer/recovery/gate/config 的 SQL test 都要在「第一步」與「最後一步」
-- 各取一次快照並比對。比對面向（缺一不可）：
--   * tw_bsr_sync_queue：count(*)、全表 (id,status) hash、max(updated_at)、max(enqueued_at)
--   * tw_bsr_sync_config：全 key 的 version + md5(config::text)
--   * audit_logs：count(*)
--   * tw_bsr_degrade_events：count(*)
-- 任一不等即 RAISE EXCEPTION 'test_left_residue'。
--
-- 用法（測試檔內）：
--   \i supabase/tests/_s3b0_snapshot.sql
--   CALL s3b0_snapshot('before');
--   ... 測試 ...
--   CALL s3b0_assert_no_residue();

CREATE TEMP TABLE IF NOT EXISTS _s3b0_snap (
  tag           text primary key,
  queue_rows    bigint,
  queue_hash    text,
  queue_max_upd timestamptz,
  queue_max_enq timestamptz,
  config_hash   text,
  audit_rows    bigint,
  degrade_rows  bigint
);

CREATE OR REPLACE PROCEDURE s3b0_snapshot(p_tag text)
LANGUAGE plpgsql AS $proc$
BEGIN
  DELETE FROM _s3b0_snap WHERE tag = p_tag;
  INSERT INTO _s3b0_snap
  SELECT
    p_tag,
    (SELECT count(*) FROM public.tw_bsr_sync_queue),
    (SELECT md5(COALESCE(string_agg(id::text || ':' || status, '|' ORDER BY id), ''))
       FROM public.tw_bsr_sync_queue),
    (SELECT max(updated_at)   FROM public.tw_bsr_sync_queue),
    (SELECT max(enqueued_at)  FROM public.tw_bsr_sync_queue),
    (SELECT md5(COALESCE(string_agg(key || ':' || version || ':' || md5(config::text), '|'
                                    ORDER BY key), ''))
       FROM public.tw_bsr_sync_config),
    (SELECT count(*) FROM public.audit_logs),
    (SELECT count(*) FROM public.tw_bsr_degrade_events);
END $proc$;

CREATE OR REPLACE PROCEDURE s3b0_assert_no_residue()
LANGUAGE plpgsql AS $proc$
DECLARE b _s3b0_snap; a _s3b0_snap;
BEGIN
  CALL s3b0_snapshot('after');
  SELECT * INTO b FROM _s3b0_snap WHERE tag = 'before';
  SELECT * INTO a FROM _s3b0_snap WHERE tag = 'after';
  IF b IS NULL THEN
    RAISE EXCEPTION 'test_left_residue: before snapshot missing (CALL s3b0_snapshot(''before'') 未執行)';
  END IF;
  IF b.queue_rows    IS DISTINCT FROM a.queue_rows
  OR b.queue_hash    IS DISTINCT FROM a.queue_hash
  OR b.queue_max_upd IS DISTINCT FROM a.queue_max_upd
  OR b.queue_max_enq IS DISTINCT FROM a.queue_max_enq
  OR b.config_hash   IS DISTINCT FROM a.config_hash
  OR b.audit_rows    IS DISTINCT FROM a.audit_rows
  OR b.degrade_rows  IS DISTINCT FROM a.degrade_rows THEN
    RAISE EXCEPTION 'test_left_residue: before=(%,%,%,%,%,%,%) after=(%,%,%,%,%,%,%)',
      b.queue_rows, b.queue_hash, b.queue_max_upd, b.queue_max_enq,
      b.config_hash, b.audit_rows, b.degrade_rows,
      a.queue_rows, a.queue_hash, a.queue_max_upd, a.queue_max_enq,
      a.config_hash, a.audit_rows, a.degrade_rows;
  END IF;
END $proc$;
