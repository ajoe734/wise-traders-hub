/**
 * 持倉看板「已反映程度」清單：逐檔用與抽屜相同的站牌算法（buildDrawerStations）分級。
 * 財報情境走 loadFundamentals（6 小時前端快取，與抽屜共用），未登入只算範例股。
 */
import { useEffect, useMemo, useState } from 'react';
import { getCheckupGateway } from '@/checkup/lib/gateway';
import { buildValuationView } from '@/checkup/lib/valuationRulers';
import { loadFundamentals, scenarioFromFundamentals, isJwtExpired } from '@/checkup/hooks/useValuationSnapshot';
import { buildDrawerStations } from './HoldingsDetailPanel';
import { PRICED_IN_ORDER, type PricedIn } from '@/checkup/lib/valuationStations';
import { DEMO_FUNDAMENTALS_SYMBOLS } from '../../../../supabase/functions/_shared/demoFundamentalsSymbols';

export type PricedInItem = { code: string; name: string; price: number | null; pricedIn: PricedIn | null };

const CONCURRENCY = 2;

export function sortPricedIn(items: PricedInItem[]): PricedInItem[] {
  const rank = (i: PricedInItem) => (i.pricedIn ? PRICED_IN_ORDER[i.pricedIn.level] : 4);
  const ratio = (i: PricedInItem) => (i.pricedIn && i.pricedIn.level !== 'unknown' ? i.pricedIn.ratioToBelt : Infinity);
  return [...items].sort((a, b) => rank(a) - rank(b) || ratio(a) - ratio(b));
}

export function usePricedInList(holdings: any[] | null | undefined) {
  const list = useMemo(() => {
    const seen = new Map<string, { code: string; name: string; price: number | null }>();
    for (const h of holdings || []) {
      const code = String(h?.code ?? h?.symbol ?? '').trim();
      if (!/^\d{4,6}$/.test(code) || seen.has(code)) continue;
      seen.set(code, { code, name: String(h?.name || code), price: Number(h?.price) > 0 ? Number(h.price) : null });
    }
    return [...seen.values()];
  }, [holdings]);
  const key = list.map((x) => `${x.code}:${x.price ?? ''}`).join(',');
  const [items, setItems] = useState<PricedInItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!list.length) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    setItems(list.map((x) => ({ ...x, pricedIn: null })));
    const gw = getCheckupGateway();
    (async () => {
      const token = await gw.auth?.getAccessToken?.().catch(() => null);
      const signedIn = !!token && !isJwtExpired(token);
      const queue = [...list];
      const one = async (x: typeof list[number]): Promise<PricedInItem> => {
        if (!signedIn && !DEMO_FUNDAMENTALS_SYMBOLS.includes(x.code)) return { ...x, pricedIn: { level: 'unknown', label: '無法判斷', reason: '登入後可計算' } };
        try {
          const raw: any = await gw.rpc('valuation_snapshot', { _symbol: x.code });
          const p = Array.isArray(raw) ? raw[0] : raw;
          const view = p ? buildValuationView({
            symbol: p.symbol || x.code, asOf: p.asOf ?? null, source: p.source ?? null, pe: p.pe ?? null, pb: p.pb ?? null,
            dividendYield: p.dividendYield ?? null, industry: p.industry ?? null,
            history: { pe: p?.history?.pe || [], pb: p?.history?.pb || [], dividendYield: p?.history?.dividendYield || [] },
            peerScope: p.peerScope ?? null, peerIndustry: p.peerIndustry ?? null, peers: p.peers || [], trend: Array.isArray(p?.trend) ? p.trend : [],
          } as any) : null;
          const band = scenarioFromFundamentals(await loadFundamentals(gw, x.code, false, false), null);
          const st = buildDrawerStations(view, band, x.code, x.price);
          return { ...x, pricedIn: st.pricedIn };
        } catch {
          return { ...x, pricedIn: { level: 'unknown', label: '無法判斷', reason: '資料暫時取不到' } };
        }
      };
      const out = new Map<string, PricedInItem>();
      await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length && !cancelled) {
          const x = queue.shift()!;
          const r = await one(x);
          out.set(x.code, r);
          if (!cancelled) setItems(list.map((y) => out.get(y.code) ?? { ...y, pricedIn: null }));
        }
      }));
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { items: sortPricedIn(items), loading };
}
