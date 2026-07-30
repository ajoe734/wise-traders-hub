import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toMirror, readDeno, MIRROR_PATH } from '../../../scripts/gen-journal-repository-mirror.mjs';
import * as repo from '@/lib/journalRepository';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf-8');

/** 最小 supabase query builder 替身：記錄呼叫鏈，回傳固定資料。 */
function fakeDb(result: { data?: any; error?: any } = {}, rpcResult?: any) {
  const calls: any[] = [];
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') return undefined;
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => {
            calls.push([prop]);
            return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
          };
        }
        return (...args: any[]) => {
          calls.push([prop, ...args]);
          return builder;
        };
      },
    },
  );
  // 讓 builder 可被 await（沒有 maybeSingle 的鏈）
  (builder as any).then = undefined;
  const db = {
    calls,
    from(table: string) {
      calls.push(['from', table]);
      return awaitable(builder, result, calls);
    },
    rpc(fn: string, args: any) {
      calls.push(['rpc', fn, args]);
      return Promise.resolve(rpcResult ?? { data: null, error: null });
    },
  };
  return db;
}

function awaitable(_b: any, result: any, calls: any[]) {
  const target: any = {};
  const proxy: any = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (res: any) => res({ data: result.data ?? null, error: result.error ?? null });
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => {
          calls.push([prop]);
          return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
        };
      }
      return (...args: any[]) => {
        calls.push([prop, ...args]);
        return proxy;
      };
    },
  });
  return proxy;
}

const flat = (calls: any[]) => calls.map((c) => c.join('|'));

describe('journalRepository mirror parity', () => {
  it('前台鏡像與 Deno 唯一資料源逐字同步', () => {
    expect(read(MIRROR_PATH)).toBe(toMirror(readDeno()));
  });

  it('四組 select 契約兩邊完全相同', () => {
    const deno = readDeno();
    for (const name of [
      'JOURNAL_LIST_SELECT',
      'JOURNAL_DETAIL_SELECT',
      'JOURNAL_EXPORT_SELECT',
      'JOURNAL_PUSH_SELECT',
    ] as const) {
      expect(deno).toContain((repo as any)[name]);
    }
  });
});

describe('forSubscriber', () => {
  it('固定 status=published、依 published_at 反序、預設 limit 100', async () => {
    const db = fakeDb({ data: [{ id: 'a' }] });
    const { signals } = await repo.forSubscriber(db as any, { mentorIds: ['m1', 'm2'] });
    expect(signals).toEqual([{ id: 'a' }]);
    const c = flat(db.calls);
    expect(c).toContain('from|expert_signals');
    expect(c).toContain('eq|status|published');
    expect(c.some((x) => x.startsWith('in|expert_id'))).toBe(true);
    expect(c).toContain('limit|100');
  });

  it('沒有 mentor 時不打 DB', async () => {
    const db = fakeDb();
    const { signals } = await repo.forSubscriber(db as any, { mentorIds: [] });
    expect(signals).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
});

describe('forOwnerPreview', () => {
  it('RLS 命中時走 rls 來源並抓同週', async () => {
    const db = fakeDb({ data: { id: 's1', expert_id: 'e1', published_at: '2026-07-15T02:00:00Z' } });
    const r = await repo.forOwnerPreview(db as any, { signalId: 's1', forceOwner: false });
    expect(r.diagnostics.source).toBe('rls');
    expect(r.diagnostics.ownerExpertId).toBe('e1');
    const c = flat(db.calls);
    expect(c).toContain('eq|expert_id|e1');
    expect(c.some((x) => x.startsWith('gte|published_at'))).toBe(true);
  });

  it('RLS 拉不到 + forceOwner 時 fallback 到 owner RPC', async () => {
    const db = fakeDb(
      { data: null },
      { data: { signal: { id: 's1', expert_id: 'e9' }, weekSignals: [{ id: 's2' }] }, error: null },
    );
    const r = await repo.forOwnerPreview(db as any, { signalId: 's1', forceOwner: true });
    expect(r.diagnostics.source).toBe('owner_rpc');
    expect(r.diagnostics.ownerRpcAttempted).toBe(true);
    expect(r.weekSignals).toHaveLength(1);
    expect(flat(db.calls)).toContain('rpc|get_owned_journal_bundle|[object Object]');
  });

  it('沒有 forceOwner 時不呼叫 RPC，回 not_found_or_forbidden', async () => {
    const db = fakeDb({ data: null });
    const r = await repo.forOwnerPreview(db as any, { signalId: 's1' });
    expect(r.error).toBe('not_found_or_forbidden');
    expect(r.diagnostics.ownerRpcAttempted).toBe(false);
  });
});

describe('forExport', () => {
  it('publishedOnly 以 published_at 為界並鎖 status', async () => {
    const db = fakeDb({ data: [] });
    await repo.forExport(db as any, { startIso: 'A', endIso: 'B', publishedOnly: true });
    const c = flat(db.calls);
    expect(c).toContain('eq|experts.role|mentor');
    expect(c).toContain('eq|status|published');
    expect(c).toContain('gte|published_at|A');
    expect(c).toContain('lt|published_at|B');
  });

  it('含草稿時改以 created_at 為界且不鎖 status', async () => {
    const db = fakeDb({ data: [] });
    await repo.forExport(db as any, { startIso: 'A', endIso: 'B', publishedOnly: false });
    const c = flat(db.calls);
    expect(c).toContain('gte|created_at|A');
    expect(c).not.toContain('eq|status|published');
  });
});

describe('週記讀取單一資料源守衛', () => {
  const OWNERS = [
    'src/lib/journalRepository.ts',
    'supabase/functions/_shared/journalRepository.ts',
  ];

  it('週記四場景的呼叫端不得自刻 expert_signals select', () => {
    const callers = [
      'src/pages/app/Journals.tsx',
      'src/pages/app/JournalDetail.tsx',
      'src/pages/company/JournalsExport.tsx',
      'supabase/functions/weekly-journal-export/index.ts',
    ];
    for (const f of callers) {
      const src = read(f);
      expect(src, `${f} 仍直接查 expert_signals，請改用 journalRepository`).not.toMatch(
        /from\(["']expert_signals["']\)[\s\S]{0,80}\.select\(/,
      );
    }
  });

  it('select 契約字串只出現在 repository 兩份檔案', () => {
    const contract = repo.JOURNAL_EXPORT_SELECT;
    const files = [
      'src/pages/company/JournalsExport.tsx',
      'supabase/functions/weekly-journal-export/index.ts',
      ...OWNERS,
    ];
    const hits = files.filter((f) => read(f).includes(contract));
    expect(hits.sort()).toEqual([...OWNERS].sort());
  });
});
