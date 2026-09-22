/**
 * useStockIndustryMap —— 全市場細分產業分類表載入器。
 *
 * 契約：
 *   - 對外握手一律走 `getCheckupGateway()`（不得直接 import supabase client / fetch）。
 *   - 只讀 `public.stock_industry_map`，不做任何寫入。
 *   - 載入完成後注入 `setAutoIndustryMap()`，讓 `getMultiMeta()` 維持純同步。
 *   - 本地快取 24 小時（`createDocumentCache`），離線或失敗時沿用舊快取。
 */
import { useEffect, useState } from 'react';
import { getCheckupGateway } from '@/checkup/lib/gateway';
import { createDocumentCache } from '@/checkup/lib/checkupCacheStore';
import { setAutoIndustryMap } from '@/checkup/lib/stockMetaMulti.js';

export interface AutoIndustryEntry {
  industries: string[];
  revenueMix: Array<{ industry: string; pct: number }> | null;
  themes: string[];
}

export type AutoIndustryMap = Record<string, AutoIndustryEntry>;

const TTL_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;

interface CachedDoc {
  at: number;
  map: AutoIndustryMap;
}

const cache = createDocumentCache<CachedDoc>({
  storageKey: 'lf.checkup.stockIndustryMap.v1',
  empty: () => ({ at: 0, map: {} }),
});

function readCached(): AutoIndustryMap | null {
  const doc = cache.read();
  const map = doc?.map;
  if (!map || Object.keys(map).length === 0) return null;
  return map;
}

function readFresh(): AutoIndustryMap | null {
  const doc = cache.read();
  if (!doc?.at || Date.now() - doc.at > TTL_MS) return null;
  return readCached();
}

let inflight: Promise<AutoIndustryMap> | null = null;
let applied = false;


function normalizeRow(row: any): AutoIndustryEntry | null {
  const industries = Array.isArray(row?.industries) ? row.industries.filter(Boolean).map(String) : [];
  if (industries.length === 0) return null;
  const mixRaw = Array.isArray(row?.revenue_mix) ? row.revenue_mix : null;
  const revenueMix =
    mixRaw && mixRaw.length
      ? mixRaw
          .map((m: any) => ({ industry: String(m?.industry ?? ''), pct: Number(m?.pct) }))
          .filter((m: any) => m.industry && Number.isFinite(m.pct))
      : null;
  const themes = Array.isArray(row?.themes) ? row.themes.filter(Boolean).map(String) : [];
  return { industries, revenueMix: revenueMix && revenueMix.length ? revenueMix : null, themes };
}

async function fetchAll(): Promise<AutoIndustryMap> {
  const db = getCheckupGateway().db;
  const out: AutoIndustryMap = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('stock_industry_map')
      .select('symbol, industries, revenue_mix, themes')
      .order('symbol')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || 'stock_industry_map read failed');
    for (const row of data ?? []) {
      const entry = normalizeRow(row);
      if (entry) out[String(row.symbol)] = entry;
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** 載入一次並注入；重複呼叫共用同一個 in-flight promise。 */
export async function loadStockIndustryMap(force = false): Promise<AutoIndustryMap> {
  if (!force) {
    const cached = cache.get();
    if (cached && Object.keys(cached).length) {
      setAutoIndustryMap(cached);
      applied = true;
      return cached;
    }
  }
  if (!inflight) {
    inflight = fetchAll()
      .then((map) => {
        if (Object.keys(map).length) {
          cache.set(map);
          setAutoIndustryMap(map);
          applied = true;
        }
        return map;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export interface UseStockIndustryMapResult {
  ready: boolean;
  count: number;
  error: string | null;
}

export function useStockIndustryMap(): UseStockIndustryMapResult {
  const [state, setState] = useState<UseStockIndustryMapResult>({
    ready: applied,
    count: 0,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    loadStockIndustryMap()
      .then((map) => {
        if (!alive) return;
        setState({ ready: true, count: Object.keys(map).length, error: null });
      })
      .catch((err: any) => {
        if (!alive) return;
        // 取不到就沿用官方大類，不擋畫面
        const stale = cache.getEntry()?.value;
        if (stale) setAutoIndustryMap(stale);
        setState({ ready: !!stale, count: stale ? Object.keys(stale).length : 0, error: String(err?.message ?? err) });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
