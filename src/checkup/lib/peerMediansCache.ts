/**
 * peerMediansCache —— `valuation_peer_medians` 批次 RPC 的去重＋有界快取。
 *
 * 目的（持倉看板刷新根因修復 2026-09-24）：
 *   - 投組估值條與產業／族群區塊是同一 hook 的兩個實例，過去各打一次相同 RPC。
 *   - key 只看「排序後代碼集合」，報價造成的市值變動不再觸發 RPC。
 *   - in-flight promise 共享；TTL 內命中直接回傳；最多保留 MAX_ENTRIES 組（LRU）。
 *   - `force` 跳過快取（排程 / 手動重抓），但仍與同時間的 in-flight 共享。
 */
import type { CheckupGateway } from '@/checkup/lib/gateway';

export const PEER_MEDIANS_TTL_MS = 30 * 60 * 1000;
export const PEER_MEDIANS_MAX_ENTRIES = 8;

interface Entry { at: number; data: any[] }

const gwIds = new WeakMap<object, number>();
let gwSeq = 0;
const done = new Map<string, Entry>();
const inflight = new Map<string, Promise<any[]>>();

function gwId(gw: object): number {
  let id = gwIds.get(gw);
  if (id == null) { id = ++gwSeq; gwIds.set(gw, id); }
  return id;
}

export function peerMediansKey(symbols: string[]): string {
  return [...new Set(symbols)].sort().join(',');
}

export function fetchPeerMedians(
  gateway: CheckupGateway,
  symbols: string[],
  opts: { force?: boolean; now?: number } = {},
): Promise<any[]> {
  const now = opts.now ?? Date.now();
  const k = `${gwId(gateway as unknown as object)}|${peerMediansKey(symbols)}`;
  const pending = inflight.get(k);
  if (pending) return pending;
  if (!opts.force) {
    const hit = done.get(k);
    if (hit && now - hit.at < PEER_MEDIANS_TTL_MS) {
      done.delete(k); done.set(k, hit); // LRU touch
      return Promise.resolve(hit.data);
    }
  }
  const p = Promise.resolve(
    gateway.rpc('valuation_peer_medians', { _symbols: peerMediansKey(symbols).split(',') }),
  )
    .then((raw: any) => {
      const data = Array.isArray(raw) ? raw : [];
      done.delete(k);
      done.set(k, { at: opts.now ?? Date.now(), data });
      while (done.size > PEER_MEDIANS_MAX_ENTRIES) {
        const oldest = done.keys().next().value as string;
        done.delete(oldest);
      }
      return data;
    })
    .finally(() => { inflight.delete(k); });
  inflight.set(k, p);
  return p;
}

/** 測試用：清空快取。 */
export function __resetPeerMediansCache() {
  done.clear();
  inflight.clear();
}

export function __peerMediansCacheSize() {
  return done.size;
}
