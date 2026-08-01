// AUTH: public
// deno-lint-ignore-file no-explicit-any
// tw-chips-batch
// 多股籌碼摘要批次入口，回傳 { results: { [stock_id]: payload } }。
// 單一 payload 的欄位與 tw-chips-detail 完全相同，避免前端要學兩種形狀。
// 最大支援 30 檔，與 checkup-sparkline 對齊。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { cacheGet, cacheSet } from "../_shared/memoryCache.ts";
import { computeChipsStamp } from "../_shared/chipsStamp.ts";
import { buildChipsPayload } from "../_shared/chipsDetailCore.ts";

const MAX_BATCH = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;

// 限制並行度，避免單一請求把 DB 連線池打滿。
async function withConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<any>): Promise<any[]> {
  const results: any[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i]);
      } catch (err) {
        results[i] = err;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function buildOne(supa: any, stockId: string): Promise<{ payload: any; stampVer: string }> {
  const stamp = await computeChipsStamp(supa, stockId);
  const stampVer = stamp.stampVer;
  const cacheKey = `chips:${stockId}:${stampVer}`;
  let cached = cacheGet<any>(cacheKey);
  if (!cached) {
    cached = await buildChipsPayload(supa, stockId);
    cacheSet(cacheKey, cached, CACHE_TTL_MS);
  }
  return {
    payload: {
      ...cached,
      cached: true,
      _cache_meta: { cache: 'hit', stamp_ver: stampVer, served_at: new Date().toISOString() },
    },
    stampVer,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST" && req.method !== "GET") {
    return errorResponse("method not allowed", 405, { code: "METHOD_NOT_ALLOWED" });
  }

  try {
    let body: any = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    } else {
      const url = new URL(req.url);
      const raw = url.searchParams.get("stock_ids") || "";
      body = { stock_ids: raw.split(/[,，\s]+/).filter(Boolean) };
    }

    const ids = Array.isArray(body?.stock_ids) ? body.stock_ids : [];
    const stockIds = ids
      .map((v: unknown) => String(v ?? "").trim())
      .filter((v) => /^[0-9A-Za-z]{3,10}$/.test(v))
      .slice(0, MAX_BATCH);

    if (!stockIds.length) {
      return errorResponse("stock_ids required (max 30)", 400, { code: "BAD_REQUEST" });
    }
    if (stockIds.length !== new Set(stockIds).size) {
      return errorResponse("duplicate stock_ids", 400, { code: "BAD_REQUEST" });
    }

    const supa = serviceClient();

    const settled = await withConcurrency(stockIds, 3, async (id) => {
      try {
        return { ok: true, id, value: await buildOne(supa, id) };
      } catch (err) {
        return { ok: false, id, error: (err as Error).message };
      }
    });

    const results: Record<string, any> = {};
    const errors: Record<string, string> = {};
    for (const r of settled) {
      if (r.ok) {
        results[r.id] = r.value.payload;
      } else {
        errors[r.id] = r.error;
      }
    }

    return jsonResponse({
      results,
      errors,
      count: Object.keys(results).length,
      failed: Object.keys(errors).length,
      served_at: new Date().toISOString(),
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500, { code: "INTERNAL_ERROR" });
  }
});
