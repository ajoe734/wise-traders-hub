/**
 * Checkup Gateway 契約測試。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createFakeGateway,
  getCheckupGateway,
  setCheckupGateway,
  resetCheckupGateway,
  createSupabaseGateway,
  CheckupGatewayError,
} from '../gateway';

vi.mock('@/integrations/supabase/client', () => {
  const removed: any[] = [];
  const channelObj: any = {
    on: vi.fn(() => channelObj),
    subscribe: vi.fn(() => channelObj),
  };
  return {
    supabase: {
      __removed: removed,
      __channel: channelObj,
      from: vi.fn((table: string) => ({ __table: table })),
      channel: vi.fn(() => channelObj),
      removeChannel: vi.fn((c: any) => removed.push(c)),
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } } })),
        getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
        onAuthStateChange: vi.fn((cb: any) => {
          (globalThis as any).__authCb = cb;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
      },
      functions: {
        invoke: vi.fn(async (name: string) =>
          name === 'boom'
            ? { data: null, error: { message: 'kaboom' } }
            : { data: { ok: true, name }, error: null },
        ),
      },
    },
  };
});

afterEach(() => {
  resetCheckupGateway();
  vi.unstubAllGlobals();
});

describe('gateway registry', () => {
  it('預設回 supabase adapter，且是單例', () => {
    const a = getCheckupGateway();
    expect(a).toBe(getCheckupGateway());
  });

  it('setCheckupGateway 可換成 fake，reset 後回到真實 adapter', () => {
    const fake = createFakeGateway();
    setCheckupGateway(fake);
    expect(getCheckupGateway()).toBe(fake);
    resetCheckupGateway();
    expect(getCheckupGateway()).not.toBe(fake);
  });
});

describe('supabase adapter · http', () => {
  const gw = () => createSupabaseGateway();

  it('json() 解析 2xx 回應', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ a: 1 }), { status: 200 })),
    );
    await expect(gw().http.json('/x')).resolves.toEqual({ a: 1 });
  });

  it('非 2xx 丟 CheckupGatewayError 並帶 status 與 body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(gw().http.json('/x')).rejects.toMatchObject({
      name: 'CheckupGatewayError',
      status: 500,
      body: 'nope',
      url: '/x',
    });
  });

  it('網路錯誤也正規化成 CheckupGatewayError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(gw().http.json('/x')).rejects.toBeInstanceOf(CheckupGatewayError);
  });

  it('tryJson() 任何失敗都回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(gw().http.tryJson('/x')).resolves.toBeNull();
  });

  it('text() 回純文字', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('t00.tw|123', { status: 200 })));
    await expect(gw().http.text('/twse')).resolves.toBe('t00.tw|123');
  });
});

describe('supabase adapter · auth / realtime / invoke', () => {
  it('getUserId 取 user.id', async () => {
    await expect(createSupabaseGateway().auth.getUserId()).resolves.toBe('u-1');
  });

  it('onAuthStateChange 回傳退訂函式', () => {
    const off = createSupabaseGateway().auth.onAuthStateChange(() => {});
    expect(typeof off).toBe('function');
    off();
  });

  it('realtime.subscribe 回傳的函式會 removeChannel', async () => {
    const { supabase }: any = await import('@/integrations/supabase/client');
    const off = createSupabaseGateway().realtime.subscribe(
      { name: 'ch1', table: 'notifications' },
      () => {},
    );
    off();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it('invoke 成功回 data、失敗轉 CheckupGatewayError', async () => {
    const gw = createSupabaseGateway();
    await expect(gw.invoke('ok-fn', { a: 1 })).resolves.toEqual({ ok: true, name: 'ok-fn' });
    await expect(gw.invoke('boom')).rejects.toBeInstanceOf(CheckupGatewayError);
  });
});

describe('fake gateway', () => {
  it('記錄 http 呼叫的 url / method / body', async () => {
    const fake = createFakeGateway({ http: { '/api/analyze': { result: 'ok' } } });
    await fake.http.json('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ action: 'daily' }),
    });
    expect(fake.calls.http).toEqual([
      expect.objectContaining({
        url: '/api/analyze',
        method: 'POST',
        body: { action: 'daily' },
      }),
    ]);
  });

  it('未註冊的 url 會失敗（避免測試不小心打真網路）', async () => {
    const fake = createFakeGateway();
    await expect(fake.http.json('/unknown')).rejects.toBeInstanceOf(CheckupGatewayError);
    await expect(fake.http.tryJson('/unknown')).resolves.toBeNull();
  });

  it('db builder 回傳預設列並記錄操作', async () => {
    const fake = createFakeGateway({ tables: { target_price_history: [{ id: 1 }] } });
    const { data } = await fake.db
      .from('target_price_history')
      .select('*')
      .eq('user_id', 'u-1')
      .order('created_at');
    expect(data).toEqual([{ id: 1 }]);
    expect(fake.calls.db.map((c) => c.op)).toEqual(['select', 'eq', 'order']);
  });

  it('realtime 與 auth 訂閱可被觸發，退訂後歸零', () => {
    const fake = createFakeGateway();
    const seen: any[] = [];
    const offRt = fake.realtime.subscribe({ name: 'c', table: 'checkup_meta' }, (p) => seen.push(p));
    const offAuth = fake.auth.onAuthStateChange((id) => seen.push(id));
    fake.emitRealtime('checkup_meta', { new: { id: 9 } });
    fake.emitAuthChange('u-2');
    expect(seen).toEqual([{ new: { id: 9 } }, 'u-2']);
    expect(fake.openSubscriptions()).toBe(2);
    offRt();
    offAuth();
    expect(fake.openSubscriptions()).toBe(0);
  });

  it('invoke 記錄呼叫並回註冊值', async () => {
    const fake = createFakeGateway({ functions: { 'checkup-analyze-enqueue': { job_id: 'j1' } } });
    await expect(fake.invoke('checkup-analyze-enqueue', { a: 1 })).resolves.toEqual({ job_id: 'j1' });
    expect(fake.calls.invoke).toEqual([{ name: 'checkup-analyze-enqueue', body: { a: 1 } }]);
  });
});
