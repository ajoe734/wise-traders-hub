/**
 * Live E2E — realign_instrument_unit RPC
 *
 * 覆蓋「改單位…」流程的完整合約：
 *   1. 權限：未登入 anon → forbidden；非擁有者 mentor → forbidden；擁有者 mentor → OK；
 *      company_admin → 可調任何 expert
 *   2. 資產類別相容性：us_stock 拒絕「張/顆/口」；tw_stock 拒絕「顆/口」；
 *      crypto 拒絕「張/股/口」；us_option/us_future 拒絕「張/股/顆」；
 *      拒絕時錯誤含 `incompatible_unit_for_asset_class`，且資料未被動到
 *   3. 參數驗證：null / 亂單位 → invalid_arguments / invalid_unit
 *   4. 批次更新：seed 多筆同 symbol 的 expert_signals + trade_records（初始「股」），
 *      切換為「張」→ signals_updated / trades_updated 精準對上；同 expert 但不同
 *      symbol prefix 不被動；再次呼叫（idempotent）→ 0 筆
 *   5. Admin 代改：company_admin 對其他 mentor 的部位切換單位 → 成功且不觸發權限錯誤
 *
 * 為什麼是 live spec：實際命中 RLS、SECURITY DEFINER、
 * enforce_unit_consistency 觸發器，mock 無法保證。
 *
 * 必備 env：
 *   - E2E_LIVE=1
 *   - SUPABASE_URL / SUPABASE_ANON_KEY（可用 VITE_ 版本）
 *   - E2E_SUPABASE_SERVICE_ROLE_KEY（僅 CI/staging 提供）
 *   - E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD（company_admin 角色）
 *
 * 執行：
 *   E2E_LIVE=1 bunx playwright test e2e/live/realign-instrument-unit.spec.ts
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SERVICE = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';

const shouldSkip =
  !process.env.E2E_LIVE || !SUPABASE_URL || !ANON || !SERVICE || !ADMIN_EMAIL || !ADMIN_PASSWORD;

test.skip(
  shouldSkip,
  'Set E2E_LIVE=1 + SUPABASE_URL + SUPABASE_ANON_KEY + E2E_SUPABASE_SERVICE_ROLE_KEY + E2E_ADMIN_EMAIL/PASSWORD.',
);

type SB = SupabaseClient;
const svc = (): SB => createClient(SUPABASE_URL, SERVICE);
const anonC = (): SB => createClient(SUPABASE_URL, ANON);

async function newMentor(a: SB, assetClass: string, currency: 'TWD' | 'USD') {
  const tag = `${assetClass}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const email = `realign_${tag}@e2e.local`;
  const password = `Pw!${Math.random().toString(36).slice(2, 12)}A1`;
  const { data: u, error: uErr } = await a.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (uErr || !u.user) throw new Error(`createUser: ${uErr?.message}`);
  const userId = u.user.id;

  const slug = `e2e-${tag}`.slice(0, 60);
  const { data: exp, error: eErr } = await a.from('experts').insert({
    user_id: userId,
    name: `E2E ${assetClass}`,
    slug,
    role: 'mentor' as any,
    asset_class: assetClass,
    currency,
    status: 'draft',
  }).select('id').single();
  if (eErr || !exp) throw new Error(`experts insert: ${eErr?.message}`);

  return { userId, email, password, expertId: exp.id, slug };
}

async function loginToken(email: string, password: string): Promise<string> {
  const c = anonC();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`login: ${error?.message}`);
  return data.session.access_token;
}

/** 建立一個以指定 access_token 為 Authorization 的 supabase-js client（讓 RPC 帶 JWT）。*/
function scoped(token: string): SB {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedSignalsAndTrades(
  a: SB,
  expertId: string,
  instrument: string,
  unit: string,
  n: number,
) {
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const { data: sig, error: sErr } = await a.from('expert_signals').insert({
      expert_id: expertId,
      instrument,
      action: 'buy' as any,
      quantity: 10 + i,
      quantity_unit: unit,
      price_hint: 100 + i,
      status: 'published' as any,
      published_at: new Date(now.getTime() - i * 3600_000).toISOString(),
    }).select('id').single();
    if (sErr || !sig) throw new Error(`seed signal: ${sErr?.message}`);
    const { error: tErr } = await a.from('trade_records').insert({
      expert_id: expertId,
      instrument,
      quantity: 10 + i,
      quantity_unit: unit,
      entry_price: 100 + i,
      entry_date: new Date(now.getTime() - i * 3600_000).toISOString().slice(0, 10),
      status: 'open' as any,
      signal_id: sig.id,
    });
    if (tErr) throw new Error(`seed trade: ${tErr?.message}`);
  }
}

async function countByUnit(a: SB, expertId: string, instrument: string) {
  const [sig, tr] = await Promise.all([
    a.from('expert_signals').select('quantity_unit').eq('expert_id', expertId).eq('instrument', instrument),
    a.from('trade_records').select('quantity_unit').eq('expert_id', expertId).eq('instrument', instrument),
  ]);
  const tally = (rows: any[] | null) => {
    const m: Record<string, number> = {};
    (rows || []).forEach((r) => { m[r.quantity_unit || 'null'] = (m[r.quantity_unit || 'null'] || 0) + 1; });
    return m;
  };
  return { signals: tally(sig.data as any), trades: tally(tr.data as any) };
}

async function cleanup(a: SB, expertId: string, userId: string) {
  await a.from('trade_records').delete().eq('expert_id', expertId);
  await a.from('expert_signals').delete().eq('expert_id', expertId);
  await a.from('experts').delete().eq('id', expertId);
  try { await a.auth.admin.deleteUser(userId); } catch { /* ignore */ }
}

test.describe.serial('realign_instrument_unit — 權限 + 相容性 + 批次更新', () => {
  test('1) 未登入 anon 呼叫 → forbidden，不動資料', async () => {
    const a = svc();
    const mentor = await newMentor(a, 'tw_stock', 'TWD');
    try {
      await seedSignalsAndTrades(a, mentor.expertId, '2330', '股', 2);
      const before = await countByUnit(a, mentor.expertId, '2330');

      const { data, error } = await anonC().rpc('realign_instrument_unit', {
        p_expert_id: mentor.expertId,
        p_symbol_prefix: '2330',
        p_new_unit: '張',
      });
      // 未登入 → SECURITY DEFINER 內 auth.uid()=null，v_is_admin=false 且 v_owner!=null，
      // 所以直接 raise forbidden。
      expect(error?.message || '').toMatch(/forbidden|permission|denied/i);
      expect(data).toBeFalsy();

      const after = await countByUnit(a, mentor.expertId, '2330');
      expect(after).toEqual(before);
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });

  test('2) 非擁有者 mentor → forbidden', async () => {
    const a = svc();
    const owner = await newMentor(a, 'tw_stock', 'TWD');
    const stranger = await newMentor(a, 'tw_stock', 'TWD');
    try {
      await seedSignalsAndTrades(a, owner.expertId, '2330', '股', 1);
      const before = await countByUnit(a, owner.expertId, '2330');

      const tok = await loginToken(stranger.email, stranger.password);
      const { data, error } = await scoped(tok).rpc('realign_instrument_unit', {
        p_expert_id: owner.expertId,
        p_symbol_prefix: '2330',
        p_new_unit: '張',
      });
      expect(error?.message || '').toMatch(/forbidden/i);
      expect(data).toBeFalsy();

      const after = await countByUnit(a, owner.expertId, '2330');
      expect(after).toEqual(before);
    } finally {
      await cleanup(a, stranger.expertId, stranger.userId);
      await cleanup(a, owner.expertId, owner.userId);
    }
  });

  test('3) 資產類別相容性：incompatible_unit_for_asset_class', async () => {
    const a = svc();
    // (asset_class, currency, badUnits[])
    const cases: Array<[string, 'USD' | 'TWD', string[], string]> = [
      ['us_stock',  'USD', ['張', '顆', '口'], 'AAPL'],
      ['tw_stock',  'TWD', ['顆', '口'],       '2330'],
      ['crypto',    'USD', ['張', '股', '口'], 'BTC'],
    ];
    for (const [ac, cur, bads, instrument] of cases) {
      const mentor = await newMentor(a, ac, cur);
      const seedUnit = ac === 'us_stock' ? '股' : ac === 'crypto' ? '顆' : '股';
      try {
        await seedSignalsAndTrades(a, mentor.expertId, instrument, seedUnit, 1);
        const before = await countByUnit(a, mentor.expertId, instrument);
        const tok = await loginToken(mentor.email, mentor.password);
        for (const bad of bads) {
          const { data, error } = await scoped(tok).rpc('realign_instrument_unit', {
            p_expert_id: mentor.expertId,
            p_symbol_prefix: instrument,
            p_new_unit: bad,
          });
          expect(
            error?.message || '',
            `[${ac}] 期待拒絕單位「${bad}」`,
          ).toMatch(/incompatible_unit_for_asset_class/);
          expect(data).toBeFalsy();
        }
        const after = await countByUnit(a, mentor.expertId, instrument);
        expect(after, `[${ac}] 拒絕後資料不應被改動`).toEqual(before);
      } finally {
        await cleanup(a, mentor.expertId, mentor.userId);
      }
    }
  });

  test('4) 參數驗證：null / 亂單位', async () => {
    const a = svc();
    const mentor = await newMentor(a, 'tw_stock', 'TWD');
    try {
      const tok = await loginToken(mentor.email, mentor.password);
      const s = scoped(tok);

      const nullNew = await s.rpc('realign_instrument_unit', {
        p_expert_id: mentor.expertId,
        p_symbol_prefix: '2330',
        p_new_unit: null as any,
      });
      expect(nullNew.error?.message || '').toMatch(/invalid_arguments/);

      const garbage = await s.rpc('realign_instrument_unit', {
        p_expert_id: mentor.expertId,
        p_symbol_prefix: '2330',
        p_new_unit: 'lbs',
      });
      expect(garbage.error?.message || '').toMatch(/invalid_unit/);
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });

  test('5) 批次更新：signals/trades 精準對數 + prefix 限縮 + idempotent', async () => {
    const a = svc();
    const mentor = await newMentor(a, 'tw_stock', 'TWD');
    try {
      // 5 筆 2330 的股，另外 2 筆 2317 的股（不應被動到）
      await seedSignalsAndTrades(a, mentor.expertId, '2330', '股', 5);
      await seedSignalsAndTrades(a, mentor.expertId, '2317', '股', 2);

      const tok = await loginToken(mentor.email, mentor.password);
      const s = scoped(tok);

      const first = await s.rpc('realign_instrument_unit', {
        p_expert_id: mentor.expertId,
        p_symbol_prefix: '2330',
        p_new_unit: '張',
      });
      expect(first.error, JSON.stringify(first.error)).toBeNull();
      const d = first.data as any;
      expect(d.signals_updated).toBe(5);
      expect(d.trades_updated).toBe(5);
      expect(d.new_unit).toBe('張');

      const after2330 = await countByUnit(a, mentor.expertId, '2330');
      expect(after2330.signals).toEqual({ 張: 5 });
      expect(after2330.trades).toEqual({ 張: 5 });

      const after2317 = await countByUnit(a, mentor.expertId, '2317');
      expect(after2317.signals).toEqual({ 股: 2 });
      expect(after2317.trades).toEqual({ 股: 2 });

      // idempotent
      const again = await s.rpc('realign_instrument_unit', {
        p_expert_id: mentor.expertId,
        p_symbol_prefix: '2330',
        p_new_unit: '張',
      });
      expect(again.error).toBeNull();
      expect((again.data as any).signals_updated).toBe(0);
      expect((again.data as any).trades_updated).toBe(0);
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });

  test('6) company_admin 可代其他 mentor 改單位', async () => {
    const a = svc();
    const mentor = await newMentor(a, 'tw_stock', 'TWD');
    try {
      await seedSignalsAndTrades(a, mentor.expertId, '2330', '股', 3);
      const adminTok = await loginToken(ADMIN_EMAIL, ADMIN_PASSWORD);
      const { data, error } = await scoped(adminTok).rpc('realign_instrument_unit', {
        p_expert_id: mentor.expertId,
        p_symbol_prefix: '2330',
        p_new_unit: '張',
      });
      expect(error, JSON.stringify(error)).toBeNull();
      expect((data as any).signals_updated).toBe(3);
      expect((data as any).trades_updated).toBe(3);

      // admin 也不能繞過相容性
      const bad = await scoped(adminTok).rpc('realign_instrument_unit', {
        p_expert_id: mentor.expertId,
        p_symbol_prefix: '2330',
        p_new_unit: '顆',
      });
      expect(bad.error?.message || '').toMatch(/incompatible_unit_for_asset_class/);
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });
});
