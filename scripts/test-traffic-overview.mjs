import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

// In-memory PostgreSQL: no host, credentials, Cloud writes or fake visitors.
const db = new PGlite();
try {
  await db.exec(`BEGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
    CREATE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('traffic.test_admin',true)='true' $$;
    CREATE TABLE traffic_visits(visitor_id text,user_id uuid,first_seen_at timestamptz,last_seen_at timestamptz,channel text,utm_campaign text,utm_source text,utm_medium text,first_referrer_host text,first_landing_path text);
    CREATE TABLE traffic_events(visitor_id text,user_id uuid,route text,event_name text,occurred_at timestamptz,is_internal boolean);
    CREATE TABLE conversions(occurred_at timestamptz,gross_amount integer,platform_amount integer,channel text,utm_campaign text);
    SET traffic.test_admin='true';
    INSERT INTO traffic_visits VALUES('linked','00000000-0000-0000-0000-000000000001','2026-10-19T17:00Z','2026-10-19T17:00Z','direct','mia',null,null,null,'/');
    INSERT INTO traffic_events VALUES
      ('a',null,'/','page_view','2026-10-19T15:59:59Z',false),
      ('a',null,'/outside-top-15','page_view','2026-10-19T16:00Z',false),
      ('b',null,'/','page_view','2026-10-20T15:59:59Z',false),
      ('c',null,'/','page_view','2026-10-20T16:00Z',false),
      ('staff',null,'/','page_view','2026-10-19T17:00Z',true),
      ('unknown',null,'/',null,'2026-10-19T17:00Z',false),
      ('linked',null,'/','auth_login_success','2026-10-19T17:00Z',false),
      ('signup',null,'/','auth_signup_success','2026-10-19T18:00Z',false),
      ('signup',null,'/','auth_signup_success','2026-10-19T18:01Z',false);
    INSERT INTO conversions VALUES('2026-10-19T18:00Z',100,20,'direct','mia');`);
  const sql = process.argv[2] ?? readdirSync('drizzle/migrations').filter(f => f.endsWith('_traffic_daily_reconciliation.sql')).sort().at(-1);
  assert(sql, 'missing actual overview migration');
  await db.exec(readFileSync(process.argv[2] ? sql : `drizzle/migrations/${sql}`, 'utf8'));
  const from = '2026-10-19T16:00:00Z', to = '2026-10-20T16:00:00Z';
  const result = (await db.query('select get_traffic_overview($1,$2) AS s', [from,to])).rows[0].s;
  assert.equal(result.kpi.page_views, 2, 'named, non-internal pages only');
  assert.equal(result.kpi.signups, 1, 'one evidenced signup; identity link is not signup');
  assert.deepEqual(result.daily.map(d=>[d.day,d.page_views,d.orders,d.gross]), [['2026-10-20',2,1,100]], 'Taipei half-open day');
  assert.equal(result.daily.reduce((n,d)=>n+d.page_views,0), result.kpi.page_views);
  assert.equal(result.campaigns[0].signups, 0, 'historical linked visit is not campaign signup');
  const partial = (await db.query('select get_traffic_overview($1,$2) AS s', ['2026-10-19T17:00Z','2026-10-20T15:59:59Z'])).rows[0].s;
  assert.equal(partial.kpi.page_views,0); assert.equal(partial.daily[0].page_views,0);
  const all = (await db.query('select get_traffic_overview($1,$2) AS s', ['2026-10-19T15:00Z','2026-10-20T17:00Z'])).rows[0].s;
  assert.deepEqual(all.daily.map(d=>d.page_views),[1,2,1]);
  assert.equal(all.daily.reduce((n,d)=>n+d.page_views,0),4);
  await db.query("SET traffic.test_admin='false'");
  await assert.rejects(db.query('select get_traffic_overview($1,$2)',[from,to]), /Forbidden/);
  console.log('PASS actual overview SQL: identity/signup, internal/null exclusion, Taipei boundaries, partial/multiple days, KPI reconciliation, admin restriction');
} finally { await db.exec('ROLLBACK'); await db.close(); }