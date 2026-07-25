// Phase-2 / PR-10: DB inflight helper for request coalescing.
// 把 finmind_inflight_requests 的寫入從各 caller 抽出來，避免 upsert / delete 語法
// 被複製貼上。所有錯誤靜默，因為這是輔助觀測，不能反過來阻斷主流程。

export interface InflightHook {
  onAcquire: () => Promise<void>;
  onRelease: () => Promise<void>;
}

export function makeInflightHook(
  supa: any,
  opts: { key: string; kind: string; stockId?: string | null },
): InflightHook {
  return {
    async onAcquire() {
      try {
        await supa.from('finmind_inflight_requests').upsert({
          key: opts.key,
          kind: opts.kind,
          stock_id: opts.stockId ?? null,
          acquired_at: new Date().toISOString(),
        }, { onConflict: 'key' });
      } catch { /* observability best-effort */ }
    },
    async onRelease() {
      try {
        await supa.from('finmind_inflight_requests').delete().eq('key', opts.key);
      } catch { /* observability best-effort */ }
    },
  };
}
