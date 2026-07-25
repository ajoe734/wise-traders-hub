// Phase-2: Request Coalescing
// 同一 isolate 內、同 key 的多筆並發請求，只實際觸發一次上游 fetch/RPC；
// 其他呼叫端等同一個 Promise。
//
// 限制：只在單一 edge function isolate 有效（Deno 內記憶體）；跨 isolate 的
// 去重需要 DB advisory lock，等到有需求再擴。
//
// 用法：
//   const data = await coalesce(`bsr:${stockId}:${date}`, () => fetchBsr(stockId, date));

const inflight = new Map<string, { promise: Promise<any>; created_at: number }>();
const STALE_MS = 30_000; // 保險：30 秒後強制清（fetch 早該 timeout 了）

export interface CoalesceMetrics {
  key: string;
  hit: boolean;
  inflight_count: number;
}

export type CoalesceObserver = (m: CoalesceMetrics) => void;

let observer: CoalesceObserver | null = null;

export function setCoalesceObserver(cb: CoalesceObserver | null): void {
  observer = cb;
}

/** onAcquire / onRelease 可為 sync 或 async；coalescer 內部會 await + catch，不會反過來拋。 */
export type CoalesceSideEffect = () => void | Promise<void>;

async function runHook(hook: CoalesceSideEffect | undefined, label: string): Promise<void> {
  if (!hook) return;
  try {
    await Promise.resolve(hook());
  } catch (err) {
    console.warn(`[coalesce hook:${label}]`, (err as Error).message);
  }
}

export async function coalesce<T>(
  key: string,
  factory: () => Promise<T>,
  opts?: { onAcquire?: CoalesceSideEffect; onRelease?: CoalesceSideEffect },
): Promise<T> {
  const now = Date.now();
  const existing = inflight.get(key);
  if (existing && (now - existing.created_at) < STALE_MS) {
    observer?.({ key, hit: true, inflight_count: inflight.size });
    return existing.promise as Promise<T>;
  }

  // Fire-and-forget side effect on first acquire; failures never block the main flow.
  void runHook(opts?.onAcquire, 'onAcquire');

  const promise = (async () => {
    try {
      return await factory();
    } finally {
      inflight.delete(key);
      void runHook(opts?.onRelease, 'onRelease');
    }
  })();

  inflight.set(key, { promise, created_at: now });
  observer?.({ key, hit: false, inflight_count: inflight.size });
  return promise;
}

/** 診斷用：目前 inflight 數量 */
export function inflightSize(): number {
  return inflight.size;
}
