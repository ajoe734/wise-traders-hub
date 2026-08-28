/**
 * sparklineFetchTask — sparkline 取數的 module-owned task 與跨 consumer 去重。
 *
 * 為什麼不放在 React effect 裡：原本 effect 的 `cancelled` flag 會讓「元件先 unmount、
 * 回應才回來」的批次完全不寫快取；同時 prefetch 若看到 in-flight 就直接跳過，
 * 於是資料永久缺失。這裡把 fetch → commit 的生命週期交給 module：
 *   - reservation 在第一個 await 之前就同步填好，同 tick 的併發只會有 1 次 invoke；
 *   - commit 一定會發生（good / partial / fail），與任何 consumer 的 unmount 無關；
 *   - release 是 identity-safe：只有 Map 內仍是自己那顆 deferred 才刪，
 *     避免 `__resetForTests()` 後舊 task 誤刪新 task 的 reservation。
 *
 * 本模組**不做 market grouping**：caller 交來什麼 entries 就送單一既有 `{ codes }` body。
 */

export interface SparklineTaskEntry {
  code: string;
  /** 該 code 在本次任務使用的 cache key（reservation / attempt 同鍵） */
  key: string;
}

export interface SparklineTaskDeps<R> {
  /** 單一 Edge 請求；body 維持既有 `{ codes }`，不新增欄位 / header。 */
  invoke: (codes: string[]) => Promise<R | null>;
  /** 寫入快取；`result=null` 代表整批失敗（負快取）。 */
  commit: (entries: SparklineTaskEntry[], result: R | null) => void;
}

const reservations = new Map<string, Promise<void>>();
let currentGeneration = 0;

/** 測試觀測用。 */
export function __taskDebugState() {
  return { size: reservations.size, generation: currentGeneration };
}

export function hasSparklineReservation(key: string): boolean {
  return reservations.has(key);
}

export function getSparklineReservation(key: string): Promise<void> | undefined {
  return reservations.get(key);
}

/**
 * 執行（或加入）一批 sparkline 取數。同一個 key 同時間最多 1 次 invoke。
 */
export function runSparklineTask<R>(
  entries: SparklineTaskEntry[],
  deps: SparklineTaskDeps<R>,
): Promise<void> {
  const seen = new Set<string>();
  const fresh: SparklineTaskEntry[] = [];
  const waiting: Promise<void>[] = [];
  for (const e of entries) {
    if (!e || !e.code || !e.key || seen.has(e.key)) continue;
    seen.add(e.key);
    const held = reservations.get(e.key);
    if (held) waiting.push(held);
    else fresh.push(e);
  }

  if (!fresh.length) return Promise.all(waiting).then(() => undefined);

  let resolveDeferred!: () => void;
  const deferred = new Promise<void>((r) => { resolveDeferred = r; });
  // 1) deferred 先建立、2) 同步填 Map —— 都在第一個 await 之前，同 tick 的 prefetch 必命中
  fresh.forEach((e) => reservations.set(e.key, deferred));
  const gen = currentGeneration;

  const task = (async () => {
    try {
      const data = await deps.invoke(fresh.map((e) => e.code));
      if (gen !== currentGeneration) return; // stale：不得寫快取
      deps.commit(fresh, data ?? null);
    } catch {
      if (gen !== currentGeneration) return; // stale：catch 也不得 commit
      deps.commit(fresh, null);
    } finally {
      // identity-safe release：只刪自己那一筆，不動 reset 後新建的 reservation
      fresh.forEach((e) => {
        if (reservations.get(e.key) === deferred) reservations.delete(e.key);
      });
      resolveDeferred();
    }
  })();

  return Promise.all([task, ...waiting]).then(() => undefined);
}

/** DEV/test only：先讓在途 task 失效，再清空 reservation。 */
export function __resetSparklineTaskForTests(): void {
  currentGeneration += 1;
  reservations.clear();
}
