import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

let db: PGlite;
const original = [{ id: '00000000-0000-0000-0000-000000000001', symbol: 'AAOI', market: 'US', trade_date: '2026-10-27', close_price: 71.94 }];
const replacement = [{ symbol: 'AAOI', market: 'US', trade_date: '2026-10-26', close_price: 71.94, open_price: 72, high_price: 73, low_price: 71, yesterday_close: 71, volume: 1000, change_percent: 1.32 }];
const evidence = { source: 'nasdaq', sha256: 'verified_fixture', original_sha256: 'original_fixture' };
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.daily_price_snapshots(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,symbol text,trade_date date,market text,close_price numeric,yesterday_close numeric,change_percent numeric,open_price numeric,high_price numeric,low_price numeric,volume bigint,volume_unit text,volume_shares bigint,volume_ma5 numeric,is_limit_up boolean DEFAULT false,limit_up_price numeric,UNIQUE(symbol,trade_date));
    CREATE TABLE public.audit_logs(action text,target_type text,detail jsonb);
    INSERT INTO daily_price_snapshots(id,symbol,trade_date,market,close_price) VALUES('00000000-0000-0000-0000-000000000001','AAOI','2026-10-27','US',71.94),('00000000-0000-0000-0000-000000000002','2330','2026-10-27','TW',1000);`);
  await db.exec(readFileSync('drizzle/migrations/0065_us_snapshot_verified_reconstruction.sql', 'utf8'));
});
afterAll(async () => { await db.close(); });
describe('atomic audited US repair', () => {
  it('corrects day, retains full original, nulls unusable row and leaves TW intact', async () => {
    await db.query('select rebuild_us_snapshots($1::jsonb,$2::jsonb,$3::jsonb)', [JSON.stringify(original),JSON.stringify(replacement),JSON.stringify(evidence)]);
    const { rows } = await db.query<{trade_date:string;is_usable:boolean;close_price:string|null;symbol:string}>('select symbol,trade_date::text,is_usable,close_price::text from daily_price_snapshots order by symbol,trade_date');
    expect(rows.find(r => r.symbol==='AAOI' && r.trade_date==='2026-10-26')).toMatchObject({is_usable:true,close_price:'71.94'});
    expect(rows.find(r => r.symbol==='AAOI' && r.trade_date==='2026-10-27')).toMatchObject({is_usable:false,close_price:null});
    expect(rows.find(r => r.symbol==='2330')).toMatchObject({close_price:'1000',is_usable:true});
    const audit = await db.query<{detail:{original:unknown}}> ('select detail from audit_logs');
    expect(audit.rows[0].detail.original).toEqual(original);
  });
  it('replay has no second audit or duplicate date', async () => {
    const r = await db.query<{r:{already_applied:boolean}}>('select rebuild_us_snapshots($1::jsonb,$2::jsonb,$3::jsonb) as r',[JSON.stringify(original),JSON.stringify(replacement),JSON.stringify(evidence)]);
    expect(r.rows[0].r.already_applied).toBe(true);
    expect((await db.query<{n:number}>('select count(*)::int n from audit_logs')).rows[0].n).toBe(1);
  });
  it('rejects stale original before writing or auditing', async () => {
    await expect(db.query('select rebuild_us_snapshots($1::jsonb,$2::jsonb,$3::jsonb)',[JSON.stringify(original),JSON.stringify(replacement),JSON.stringify({...evidence,sha256:'other'})])).rejects.toThrow('Concurrent snapshot change');
    expect((await db.query<{n:number}>('select count(*)::int n from audit_logs')).rows[0].n).toBe(1);
  });
  it('blocks unverified live-price snapshots even for service writes', async () => {
    await db.exec(`INSERT INTO daily_price_snapshots(symbol,trade_date,market,close_price) VALUES('NVDA','2026-10-27','US',100)`);
    const r = await db.query('select is_usable,close_price,exclusion_reason from daily_price_snapshots where symbol=\'NVDA\'');
    expect(r.rows[0]).toMatchObject({is_usable:false,close_price:null,exclusion_reason:'unverified_us_daily_source'});
  });
});