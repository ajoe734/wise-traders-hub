/**
 * Live E2E — us_stock 週記送出 → publish 全流程（Benny 場景回歸）
 *
 * 覆蓋 `enforce_signal_capital_limit` 觸發器新契約：
 *   1. pending 草稿無論金額都應放行（Benny 週記無法送出的核心根因）
 *   2. pending → published 且未超額：成功發布並由 `handle_signal_trade`
 *      衍生一筆 trade_records
 *   3. pending → published 但超額：拋 CAPITAL_EXCEEDED，訊息帶幣別 (USD)
 *   4. 直接 INSERT published 未超額：成功
 *   5. 直接 INSERT published 超額：拋 CAPITAL_EXCEEDED
 *   6. published → published (UPDATE 其他欄位) 不再重驗（避免調 price_hint 被鎖）
 *
 * 為什麼是 live spec：實際命中 SECURITY DEFINER 觸發器 + get_expert_capital_status
 * + handle_signal_trade + enforce_unit_consistency，mock 無法覆蓋。
 *
 * 必備 env：
 *   - E2E_LIVE=1
 *   - SUPABASE_URL / SUPABASE_ANON_KEY（可用 VITE_ 版本）
 *   - E2E_SUPABASE_SERVICE_ROLE_KEY
 *
 * 執行：
 *   E2E_LIVE=1 bunx playwright test e2e/live/us-stock-publish-flow.spec.ts
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const SERVICE = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY || '';

const shouldSkip = !process.env.E2E_LIVE || !SUPABASE_URL || !ANON || !SERVICE;

test.skip(
  shouldSkip,
  'Set E2E_LIVE=1 + SUPABASE_URL + SUPABASE_ANON_KEY + E2E_SUPABASE_SERVICE_ROLE_KEY.',
);

type SB = SupabaseClient;
const svc = (): SB => createClient(SUPABASE_URL, SERVICE);
const anonC = (): SB => createClient(SUPABASE_URL, ANON);

/** Benny-shaped mentor: us_stock / USD / 有限 starting_capital。 */
async function newUsMentor(a: SB, startingCapital: number) {
  const tag = `benny_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const email = `${tag}@e2e.local`;
  const password = `Pw!${Math.random().toString(36).slice(2, 12)}A1`;
  const { data: u, error: uErr } = await a.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (uErr || !u.user) throw new Error(`createUser: ${uErr?.message}`);
  const userId = u.user.id;

  const slug = `e2e-${tag}`.slice(0, 60);
  const { data: exp, error: eErr } = await a.from('experts').insert({
    user_id: userId,
    name: `E2E Benny ${tag}`,
    slug,
    role: 'mentor' as any,
    asset_class: 'us_stock',
    currency: 'USD',
    starting_capital: startingCapital,
    status: 'pending',
  }).select('id').single();
  if (eErr || !exp) throw new Error(`experts insert: ${eErr?.message}`);

  return { userId, email, password, expertId: exp.id, slug };
}

function scoped(token: string): SB {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loginToken(email: string, password: string): Promise<string> {
  const { data, error } = await anonC().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`login: ${error?.message}`);
  return data.session.access_token;
}

async function cleanup(a: SB, expertId: string, userId: string) {
  await a.from('trade_records').delete().eq('expert_id', expertId);
  await a.from('expert_signals').delete().eq('expert_id', expertId);
  await a.from('experts').delete().eq('id', expertId);
  try { await a.auth.admin.deleteUser(userId); } catch { /* ignore */ }
}

test.describe.serial('us_stock 週記送出 → publish 全流程（Benny 回歸）', () => {
  test('1) pending 草稿：金額遠超 starting_capital 也應通過', async () => {
    const a = svc();
    // Benny 原本 starting_capital=30000 USD，這裡故意送一筆 60,000 的 pending
    const mentor = await newUsMentor(a, 30000);
    try {
      const tok = await loginToken(mentor.email, mentor.password);
      const { data, error } = await scoped(tok).from('expert_signals').insert({
        expert_id: mentor.expertId,
        instrument: 'NVDA',
        action: 'buy' as any,
        quantity: 200,       // 200 股（us_stock 單位=股）
        quantity_unit: '股',
        price_hint: 300,     // required = 200 * 300 = 60,000 USD
        status: 'pending' as any,
      }).select('id, status').single();
      expect(error, `pending 應放行, got: ${JSON.stringify(error)}`).toBeNull();
      expect(data?.status).toBe('pending');
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });

  test('2) pending → published 未超額：成功發布並衍生 trade_record', async () => {
    const a = svc();
    const mentor = await newUsMentor(a, 30000);
    try {
      const tok = await loginToken(mentor.email, mentor.password);
      const s = scoped(tok);

      // 先送 pending，required = 100 * 210 = 21,000 < 30,000
      const ins = await s.from('expert_signals').insert({
        expert_id: mentor.expertId,
        instrument: 'AAPL',
        action: 'buy' as any,
        quantity: 100,
        quantity_unit: '股',
        price_hint: 210,
        status: 'pending' as any,
      }).select('id').single();
      expect(ins.error, JSON.stringify(ins.error)).toBeNull();
      const signalId = ins.data!.id as string;

      // pending → published
      const upd = await s.from('expert_signals')
        .update({ status: 'published' as any, published_at: new Date().toISOString() })
        .eq('id', signalId)
        .select('id, status')
        .single();
      expect(upd.error, `publish 應成功, got: ${JSON.stringify(upd.error)}`).toBeNull();
      expect(upd.data?.status).toBe('published');

      // handle_signal_trade 應衍生 trade_records（open）
      const { data: trades } = await a.from('trade_records')
        .select('id, status, quantity, quantity_unit')
        .eq('signal_id', signalId);
      expect(trades?.length, 'handle_signal_trade 應建 1 筆 open').toBe(1);
      expect(trades![0].quantity).toBe(100);
      expect(trades![0].quantity_unit).toBe('股');
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });

  test('3) pending → published 超額：CAPITAL_EXCEEDED 帶幣別 USD', async () => {
    const a = svc();
    const mentor = await newUsMentor(a, 30000);
    try {
      const tok = await loginToken(mentor.email, mentor.password);
      const s = scoped(tok);

      // required = 200 * 170 = 34,000 > 30,000
      const ins = await s.from('expert_signals').insert({
        expert_id: mentor.expertId,
        instrument: 'NVDA',
        action: 'buy' as any,
        quantity: 200,
        quantity_unit: '股',
        price_hint: 170,
        status: 'pending' as any,
      }).select('id').single();
      expect(ins.error).toBeNull();
      const signalId = ins.data!.id as string;

      const upd = await s.from('expert_signals')
        .update({ status: 'published' as any, published_at: new Date().toISOString() })
        .eq('id', signalId);
      const msg = upd.error?.message || '';
      expect(msg, `期待 CAPITAL_EXCEEDED, got: ${msg}`).toMatch(/CAPITAL_EXCEEDED/);
      expect(msg, '訊息必須帶幣別 USD').toMatch(/USD/);

      // 且 status 未變
      const { data: after } = await a.from('expert_signals')
        .select('status').eq('id', signalId).single();
      expect(after?.status).toBe('pending');

      // 且未衍生 trade_records
      const { data: trades } = await a.from('trade_records').select('id').eq('signal_id', signalId);
      expect(trades?.length ?? 0).toBe(0);
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });

  test('4) 直接 INSERT published 未超額：成功', async () => {
    const a = svc();
    const mentor = await newUsMentor(a, 30000);
    try {
      const tok = await loginToken(mentor.email, mentor.password);
      const { data, error } = await scoped(tok).from('expert_signals').insert({
        expert_id: mentor.expertId,
        instrument: 'AAPL',
        action: 'buy' as any,
        quantity: 50,
        quantity_unit: '股',
        price_hint: 210,        // 10,500 USD
        status: 'published' as any,
        published_at: new Date().toISOString(),
      }).select('id, status').single();
      expect(error, JSON.stringify(error)).toBeNull();
      expect(data?.status).toBe('published');
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });

  test('5) 直接 INSERT published 超額：CAPITAL_EXCEEDED', async () => {
    const a = svc();
    const mentor = await newUsMentor(a, 30000);
    try {
      const tok = await loginToken(mentor.email, mentor.password);
      const { error } = await scoped(tok).from('expert_signals').insert({
        expert_id: mentor.expertId,
        instrument: 'NVDA',
        action: 'buy' as any,
        quantity: 200,
        quantity_unit: '股',
        price_hint: 170,
        status: 'published' as any,
        published_at: new Date().toISOString(),
      });
      expect(error?.message || '').toMatch(/CAPITAL_EXCEEDED/);
      expect(error?.message || '').toMatch(/USD/);
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });

  test('6) 已 published 再 UPDATE 其他欄位：不會重驗額度', async () => {
    const a = svc();
    const mentor = await newUsMentor(a, 30000);
    try {
      const tok = await loginToken(mentor.email, mentor.password);
      const s = scoped(tok);

      // 先合法 published
      const ins = await s.from('expert_signals').insert({
        expert_id: mentor.expertId,
        instrument: 'AAPL',
        action: 'buy' as any,
        quantity: 50,
        quantity_unit: '股',
        price_hint: 210,
        status: 'published' as any,
        published_at: new Date().toISOString(),
      }).select('id').single();
      expect(ins.error).toBeNull();

      // 拉高 price_hint 到會超額的水位（若 UPDATE 也重驗會炸）
      const upd = await s.from('expert_signals')
        .update({ price_hint: 9999 })
        .eq('id', ins.data!.id);
      expect(upd.error, `published→published UPDATE 不應重驗, got: ${JSON.stringify(upd.error)}`).toBeNull();
    } finally {
      await cleanup(a, mentor.expertId, mentor.userId);
    }
  });
});
