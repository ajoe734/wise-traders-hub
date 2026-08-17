CREATE SCHEMA IF NOT EXISTS t;
CREATE TABLE IF NOT EXISTS t.result(
  id serial primary key, name text, passed boolean, detail text,
  kind text NOT NULL DEFAULT 'assert',      -- assert | negative
  expected_sqlstate text, actual_sqlstate text, expected_needle text);

CREATE OR REPLACE FUNCTION t.ok(p_name text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t.result(name, passed, detail) VALUES (p_name, coalesce(p_cond,false), p_detail);
END $$;

CREATE OR REPLACE FUNCTION t.eq(p_name text, a anyelement, b anyelement)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t.result(name, passed, detail)
  VALUES (p_name, a IS NOT DISTINCT FROM b, format('got=%s expected=%s', a, b));
END $$;

-- runs sql in a rolled-back subtransaction; expects a raise containing needle
-- Negative test: p_sql MUST fail, the message MUST contain p_needle, and the
-- SQLSTATE MUST equal p_sqlstate (default P0001 = deliberate domain guard raise).
-- An unexpected error class can therefore never be counted as a PASS.
CREATE OR REPLACE FUNCTION t.expect_error(p_name text, p_sql text, p_needle text,
                                          p_sqlstate text DEFAULT 'P0001')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_msg text; v_state text; v_pass boolean := false; v_detail text := 'no error raised';
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'e0_rollback_marker' USING ERRCODE='P0002';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN v_pass := false; v_detail := 'no error raised'; v_state := NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      v_pass := position(p_needle in v_msg) > 0 AND v_state = p_sqlstate;
      v_detail := v_state||': '||v_msg;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO t.result(name,passed,detail,kind,expected_sqlstate,actual_sqlstate,expected_needle)
  VALUES (p_name, v_pass, v_detail, 'negative', p_sqlstate, v_state, p_needle);
END $$;

-- runs sql in a rolled-back subtransaction; expects success
CREATE OR REPLACE FUNCTION t.expect_ok(p_name text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_msg text; v_pass boolean := false; v_detail text := '';
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'e0_rollback_marker' USING ERRCODE='P0002';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN v_pass := true;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT; v_pass := false; v_detail := v_msg;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO t.result(name,passed,detail) VALUES (p_name, v_pass, v_detail);
END $$;
