/**
 * 站牌附加資料（唯讀）：人工同業名單的當日倍數、前瞻 EPS 預估。
 * 對外握手只走 getCheckupGateway()。
 */
import { useEffect, useState } from 'react';
import { getCheckupGateway } from '@/checkup/lib/gateway';
import { findPeerGroup, type ForwardInput, type PeerGroup } from '@/checkup/lib/valuationStations';
import { isJwtExpired } from '@/checkup/hooks/useValuationSnapshot';

export type PeerMultipleRow = { symbol: string; trade_date: string | null; pe: number | null; pb: number | null };
export type StationExtras = { group: PeerGroup | null; peerRows: PeerMultipleRow[]; forward: (ForwardInput & { asOf: string; epsSource: string; ai: boolean }) | null; forwardBlocked: string | null; loading: boolean };

const attempted = new Map<string, string | null>();

export function useStationExtras(symbol?: string | null, industry?: string | null): StationExtras {
  const [state, setState] = useState<StationExtras>({ group: null, peerRows: [], forward: null, forwardBlocked: null, loading: false });
  useEffect(() => {
    const code = symbol ? String(symbol).trim() : '';
    if (!/^\d{4,6}$/.test(code)) { setState({ group: null, peerRows: [], forward: null, forwardBlocked: null, loading: false }); return; }
    let cancelled = false;
    const group = findPeerGroup(code, industry);
    setState((s) => ({ ...s, group, loading: true }));
    const gw = getCheckupGateway();
    const peerP = group
      ? Promise.resolve(gw.rpc<PeerMultipleRow[]>('valuation_peer_multiples', { _symbols: group.symbols.filter((s) => s !== code) })).catch(() => [])
      : Promise.resolve([]);
    const fwdP = Promise.resolve(gw.db.from('forward_eps_estimates')
      .select('period, eps, eps_source, forward_pe, pe_source, as_of, note')
      .eq('symbol', code).order('as_of', { ascending: false }).limit(1))
      .then((r: any) => r?.data?.[0] ?? null).catch(() => null)
      .then(async (row: any) => {
        if (row) return { row, blocked: null };
        // 沒有前瞻資料 → 觸發一次 AI 多輪抽取（伺服器端 24 小時快取、未登入會被擋）
        if (attempted.has(code)) return { row: null, blocked: attempted.get(code) ?? null };
        // 未登入或憑證過期不呼叫（服務只接受有效登入，避免 401）
        const token = await gw.auth?.getAccessToken?.().catch(() => null);
        if (!token || isJwtExpired(token)) return { row: null, blocked: null };
        try {
          const d: any = await gw.invoke('forward-eps-extract', { symbol: code });
          const blocked = d?.status === 'blocked' ? (d.reason || d.block_reason || '自動確認未通過') : null;
          attempted.set(code, blocked);
          if (d?.status === 'passed') {
            const again: any = await gw.db.from('forward_eps_estimates').select('period, eps, eps_source, forward_pe, pe_source, as_of, note')
              .eq('symbol', code).order('as_of', { ascending: false }).limit(1);
            return { row: again?.data?.[0] ?? null, blocked: null };
          }
          return { row: null, blocked };
        } catch { attempted.set(code, null); return { row: null, blocked: null }; }
      });
    Promise.all([peerP, fwdP]).then(([rows, fr]) => {
      const f = fr?.row ?? null;
      if (cancelled) return;
      setState({
        group,
        peerRows: Array.isArray(rows) ? rows.map((r) => ({ ...r, pe: r.pe == null ? null : Number(r.pe), pb: r.pb == null ? null : Number(r.pb) })) : [],
        forward: f ? { eps: Number(f.eps), multiple: Number(f.forward_pe), period: f.period, source: f.pe_source, epsSource: f.eps_source, asOf: f.as_of, ai: String(f.note || '').startsWith('ai_extraction:') } : null,
        forwardBlocked: f ? null : fr?.blocked ?? null,
        loading: false,
      });
    });
    return () => { cancelled = true; };
  }, [symbol, industry]);
  return state;
}
