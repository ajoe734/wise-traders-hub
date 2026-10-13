/**
 * 站牌附加資料（唯讀）：人工同業名單的當日倍數、前瞻 EPS 預估。
 * 對外握手只走 getCheckupGateway()。
 */
import { useEffect, useState } from 'react';
import { getCheckupGateway } from '@/checkup/lib/gateway';
import { findPeerGroup, type ForwardInput, type PeerGroup } from '@/checkup/lib/valuationStations';

export type PeerMultipleRow = { symbol: string; trade_date: string | null; pe: number | null; pb: number | null };
export type StationExtras = { group: PeerGroup | null; peerRows: PeerMultipleRow[]; forward: (ForwardInput & { asOf: string; epsSource: string }) | null; loading: boolean };

export function useStationExtras(symbol?: string | null, industry?: string | null): StationExtras {
  const [state, setState] = useState<StationExtras>({ group: null, peerRows: [], forward: null, loading: false });
  useEffect(() => {
    const code = symbol ? String(symbol).trim() : '';
    if (!/^\d{4,6}$/.test(code)) { setState({ group: null, peerRows: [], forward: null, loading: false }); return; }
    let cancelled = false;
    const group = findPeerGroup(code, industry);
    setState((s) => ({ ...s, group, loading: true }));
    const gw = getCheckupGateway();
    const peerP = group
      ? Promise.resolve(gw.rpc<PeerMultipleRow[]>('valuation_peer_multiples', { _symbols: group.symbols.filter((s) => s !== code) })).catch(() => [])
      : Promise.resolve([]);
    const fwdP = Promise.resolve(gw.db.from('forward_eps_estimates')
      .select('period, eps, eps_source, forward_pe, pe_source, as_of')
      .eq('symbol', code).order('as_of', { ascending: false }).limit(1))
      .then((r: any) => r?.data?.[0] ?? null).catch(() => null);
    Promise.all([peerP, fwdP]).then(([rows, f]) => {
      if (cancelled) return;
      setState({
        group,
        peerRows: Array.isArray(rows) ? rows.map((r) => ({ ...r, pe: r.pe == null ? null : Number(r.pe), pb: r.pb == null ? null : Number(r.pb) })) : [],
        forward: f ? { eps: Number(f.eps), multiple: Number(f.forward_pe), period: f.period, source: f.pe_source, epsSource: f.eps_source, asOf: f.as_of } : null,
        loading: false,
      });
    });
    return () => { cancelled = true; };
  }, [symbol, industry]);
  return state;
}
