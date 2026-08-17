CREATE SCHEMA IF NOT EXISTS t;
CREATE TABLE IF NOT EXISTS t.result(
  id serial primary key, name text, passed boolean, detail text);

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

-- runs sql in a subtransaction; expects it (or the deferred constraints) to raise containing needle
CREATE OR REPLACE FUNCTION t.expect_error(p_name text, p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO t.result(name,passed,detail) VALUES (p_name, false, 'no error raised');
    RAISE EXCEPTION 'rollback_marker' USING ERRCODE='P0002';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO t.result(name,passed,detail)
      VALUES (p_name, position(p_needle in v_msg) > 0, v_msg);
  END;
  SET CONSTRAINTS ALL DEFERRED;
END $$;

-- runs sql in a subtransaction; expects success (changes rolled back)
CREATE OR REPLACE FUNCTION t.expect_ok(p_name text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO t.result(name,passed,detail) VALUES (p_name, true, '');
    RAISE EXCEPTION 'rollback_marker' USING ERRCODE='P0002';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO t.result(name,passed,detail) VALUES (p_name, false, v_msg);
  END;
  SET CONSTRAINTS ALL DEFERRED;
END $$;
