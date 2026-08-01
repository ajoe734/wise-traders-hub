// AUTH: public
// deno-lint-ignore-file no-explicit-any
// tw-chips-detail
// 前端唯一單股查詢入口：回傳單一 stock_id 的籌碼摘要（三大法人 1/5/20/60 日 + BSR top brokers + 集中度）。
// 僅讀公開市場資料表；不需要使用者身份，避免 demo/匿名模式因 anon JWT 無 sub 被誤擋。
//
// 實作已將 payload 建構邏輯下沉至 ../_shared/chipsDetailCore.ts，本檔只負責：
//   1) 版本戳 / stamp_only 探針
//   2) edge 記憶體快取
//   3) request coalescing
//   4) HTTP 包裝
import { serviceClient } from '../_shared/supabaseClients.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsPreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { cacheGet, cacheSet } from "../_shared/memoryCache.ts";
import { coalesce, setCoalesceObserver } from "../_shared/requestCoalescer.ts";
import { makeInflightHook } from "../_shared/coalesceDbHook.ts";
import { computeChipsStamp } from "../_shared/chipsStamp.ts";
import { buildChipsPayload } from "../_shared/chipsDetailCore.ts";

const CACHE_TTL_MS = 5 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  try {
    const url = new URL(req.url);
    const stockId = (url.searchParams.get("stock_id") || "").trim();
    if (!/^[0-9A-Za-z]{3,10}$/.test(stockId)) {
      return errorResponse("stock_id required", 400, { code: "BAD_REQUEST" });
    }

    const supa = serviceClient();

    const stamp = await computeChipsStamp(supa, stockId);
    const stampVer = stamp.stampVer;

    if (url.searchParams.get("stamp_only") === "1") {
      return jsonResponse({
        stock_id: stockId,
        stamp_ver: stampVer,
        chips_as_of: stamp.chipsAsOf,
        inst_as_of: stamp.instAsOf,
        served_at: new Date().toISOString(),
      });
    }

    const cacheKey = `chips:${stockId}:${stampVer}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) {
      return jsonResponse({
        ...cached,
        cached: true,
        _cache_meta: { cache: 'hit', stamp_ver: stampVer, served_at: new Date().toISOString() },
      });
    }

    let coalescedHit = false;
    setCoalesceObserver((m) => { if (m.key === cacheKey && m.hit) coalescedHit = true; });
    const inflightHook = makeInflightHook(supa, { key: cacheKey, kind: 'chips', stockId });
    const payload = await coalesce(cacheKey, async () => buildChipsPayload(supa, stockId), {
      onAcquire: inflightHook.onAcquire,
      onRelease: inflightHook.onRelease,
    });

    cacheSet(cacheKey, payload, CACHE_TTL_MS);

    return jsonResponse({
      ...payload,
      coalesced: coalescedHit,
      _cache_meta: { cache: coalescedHit ? 'coalesced' : 'miss', stamp_ver: stampVer, served_at: new Date().toISOString() },
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500, { code: "INTERNAL_ERROR" });
  }
});
