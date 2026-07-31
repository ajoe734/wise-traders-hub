/**
 * 測試用 fake gateway：記錄所有對外握手，可預先塞回應。
 *
 * 用法：
 *   const fake = createFakeGateway({ http: { '/api/analyze': { ok: true } } });
 *   setCheckupGateway(fake);
 *   ...
 *   expect(fake.calls.http).toHaveLength(1);
 */
import {
  CheckupGatewayError,
  type CheckupGateway,
  type RealtimeSpec,
} from './types';

export interface HttpCall {
  url: string;
  init?: RequestInit;
  method: string;
  body: any;
}

export interface DbCall {
  table: string;
  op: string;
  args: any[];
}

export interface InvokeCall {
  name: string;
  body: unknown;
}

export interface RpcCall {
  fn: string;
  args: Record<string, unknown> | undefined;
}

export interface FakeGatewayOptions {
  /** url（完全相符或子字串）→ 回應內容；值為 Error 時視為失敗。 */
  http?: Record<string, any>;
  /** table → select 回傳的列。 */
  tables?: Record<string, any[]>;
  /** edge function 名 → 回傳值。 */
  functions?: Record<string, any>;
  /** RPC 名 → 回傳值；值為 Error 時視為失敗。 */
  rpcs?: Record<string, any>;
  userId?: string | null;
  accessToken?: string | null;
  functionsUrl?: string;
}

export interface FakeGateway extends CheckupGateway {
  calls: {
    http: HttpCall[];
    db: DbCall[];
    invoke: InvokeCall[];
    rpc: RpcCall[];
    realtime: RealtimeSpec[];
    authSubscriptions: number;
  };
  /** 目前仍存活的訂閱數（realtime + auth），用來驗證有沒有洩漏。 */
  openSubscriptions(): number;
  /** 觸發某張表的 realtime 事件。 */
  emitRealtime(table: string, payload: any): void;
  /** 觸發 auth 狀態變化。 */
  emitAuthChange(userId: string | null): void;
}

function matchResponse(map: Record<string, any>, url: string) {
  if (Object.prototype.hasOwnProperty.call(map, url)) return { hit: true, value: map[url] };
  for (const key of Object.keys(map)) {
    if (url.includes(key)) return { hit: true, value: map[key] };
  }
  return { hit: false, value: undefined };
}

export function createFakeGateway(options: FakeGatewayOptions = {}): FakeGateway {
  const httpMap = options.http ?? {};
  const tables = options.tables ?? {};
  const functions = options.functions ?? {};
  const rpcs = options.rpcs ?? {};

  const calls: FakeGateway['calls'] = {
    http: [],
    db: [],
    invoke: [],
    rpc: [],
    realtime: [],
    authSubscriptions: 0,
  };

  const realtimeHandlers = new Map<string, Set<(payload: any) => void>>();
  const authHandlers = new Set<(userId: string | null) => void>();
  let openRealtime = 0;
  let openAuth = 0;

  const record = (url: string, init?: RequestInit) => {
    let body: any = undefined;
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.http.push({ url, init, method: (init?.method || 'GET').toUpperCase(), body });
  };

  const resolveHttp = (url: string) => {
    const { hit, value } = matchResponse(httpMap, url);
    if (!hit) {
      throw new CheckupGatewayError(`No fake response registered for ${url}`, { url, status: 404 });
    }
    if (value instanceof Error) throw value;
    return value;
  };

  function builder(table: string) {
    const rowsFor = () => tables[table] ?? [];
    const chain: any = {};
    const passthrough = [
      'select',
      'eq',
      'in',
      'gte',
      'lte',
      'lt',
      'gt',
      'neq',
      'is',
      'or',
      'order',
      'limit',
      'range',
      'filter',
      'contains',
      'match',
    ];
    for (const op of passthrough) {
      chain[op] = (...args: any[]) => {
        calls.db.push({ table, op, args });
        return chain;
      };
    }
    const terminal = (op: string) => (...args: any[]) => {
      calls.db.push({ table, op, args });
      return Promise.resolve({ data: rowsFor(), error: null });
    };
    chain.insert = terminal('insert');
    chain.upsert = terminal('upsert');
    chain.update = terminal('update');
    chain.delete = terminal('delete');
    chain.maybeSingle = () => {
      calls.db.push({ table, op: 'maybeSingle', args: [] });
      return Promise.resolve({ data: rowsFor()[0] ?? null, error: null });
    };
    chain.single = () => {
      calls.db.push({ table, op: 'single', args: [] });
      return Promise.resolve({ data: rowsFor()[0] ?? null, error: null });
    };
    chain.then = (resolve: any, reject: any) =>
      Promise.resolve({ data: rowsFor(), error: null }).then(resolve, reject);
    return chain;
  }

  return {
    calls,

    http: {
      async json(url, init) {
        record(url, init);
        return resolveHttp(url);
      },
      async tryJson(url, init) {
        record(url, init);
        try {
          return resolveHttp(url);
        } catch {
          return null;
        }
      },
      async text(url, init) {
        record(url, init);
        const value = resolveHttp(url);
        return typeof value === 'string' ? value : JSON.stringify(value);
      },
      async blob(url, init) {
        record(url, init);
        const value = resolveHttp(url);
        return value instanceof Blob ? value : new Blob([String(value)]);
      },
    },

    db: { from: (table: string) => builder(table) },

    auth: {
      async getUserId() {
        return options.userId ?? null;
      },
      onAuthStateChange(handler) {
        calls.authSubscriptions += 1;
        openAuth += 1;
        authHandlers.add(handler);
        return () => {
          if (authHandlers.delete(handler)) openAuth -= 1;
        };
      },
      async getAccessToken() {
        return options.accessToken ?? null;
      },
    },

    realtime: {
      subscribe(spec, handler) {
        calls.realtime.push(spec);
        openRealtime += 1;
        const set = realtimeHandlers.get(spec.table) ?? new Set();
        set.add(handler);
        realtimeHandlers.set(spec.table, set);
        return () => {
          if (set.delete(handler)) openRealtime -= 1;
        };
      },
    },

    async invoke(name, body) {
      calls.invoke.push({ name, body });
      if (!Object.prototype.hasOwnProperty.call(functions, name)) {
        throw new CheckupGatewayError(`No fake edge function registered for ${name}`, { url: name });
      }
      const value = functions[name];
      if (value instanceof Error) throw value;
      return value;
    },

    async rpc(fn, args) {
      calls.rpc.push({ fn, args });
      if (!Object.prototype.hasOwnProperty.call(rpcs, fn)) {
        throw new CheckupGatewayError(`No fake rpc registered for ${fn}`, { url: fn });
      }
      const value = rpcs[fn];
      if (value instanceof Error) throw value;
      return value;
    },

    functionsUrl: () => options.functionsUrl ?? 'https://fake.local/functions/v1',

    openSubscriptions: () => openRealtime + openAuth,

    emitRealtime(table, payload) {
      realtimeHandlers.get(table)?.forEach((h) => h(payload));
    },

    emitAuthChange(userId) {
      authHandlers.forEach((h) => h(userId));
    },
  };
}
