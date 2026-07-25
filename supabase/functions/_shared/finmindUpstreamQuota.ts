// Phase-2: FinMind 上游配額觀察器
// FinMind 部分端點會在 response header 回報剩餘配額；把它記到 DB 讓 guardian
// 能在真正逼近上游限額前就降級（優於只看 429）。
//
// 目前 FinMind 已知的 header 名稱因端點而異，故做寬鬆匹配。
// 找不到任何線索時就 no-op（不寫）。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const HEADER_HINTS_REMAINING = [
  'x-ratelimit-remaining',
  'x-rate-limit-remaining',
  'x-finmind-remaining',
];
const HEADER_HINTS_LIMIT = [
  'x-ratelimit-limit',
  'x-rate-limit-limit',
  'x-finmind-limit',
];
const HEADER_HINTS_RESET = [
  'x-ratelimit-reset',
  'x-rate-limit-reset',
  'x-finmind-reset',
];

function pickNumber(h: Headers, keys: string[]): number | null {
  for (const k of keys) {
    const v = h.get(k);
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function pickReset(h: Headers, keys: string[]): string | null {
  for (const k of keys) {
    const v = h.get(k);
    if (!v) continue;
    const n = Number(v);
    if (Number.isFinite(n)) {
      // Epoch seconds → ISO
      const ms = n > 1e12 ? n : n * 1000;
      return new Date(ms).toISOString();
    }
    // 已是 ISO
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export async function recordUpstreamQuota(
  supa: SupabaseClient,
  source: string,
  res: Response,
): Promise<void> {
  try {
    const remaining = pickNumber(res.headers, HEADER_HINTS_REMAINING);
    const limit = pickNumber(res.headers, HEADER_HINTS_LIMIT);
    const reset = pickReset(res.headers, HEADER_HINTS_RESET);
    if (remaining == null && limit == null && reset == null) return;

    await supa.from('finmind_upstream_quota').upsert({
      source,
      remaining,
      quota_limit: limit,
      reset_at: reset,
      observed_at: new Date().toISOString(),
      raw: {
        remaining,
        limit,
        reset,
        status: res.status,
      },
    });
  } catch (e) {
    console.warn('[upstreamQuota] record failed:', (e as Error).message);
  }
}
