/**
 * 站牌附加資料（唯讀）：人工同業名單的當日倍數、前瞻 EPS 預估。
 * 對外握手只走 getCheckupGateway()。
 */
import { useEffect, useState } from 'react';
import { getCheckupGateway } from '@/checkup/lib/gateway';
import { findPeerGroup, type ForwardInput, type PeerGroup } from '@/checkup/lib/valuationStations';
import { isJwtExpired } from '@/checkup/hooks/useValuationSnapshot';
import { useFilingRefresh } from './useFilingRefresh';

export type PeerMultipleRow = { symbol: string; trade_date: string | null; pe: number | null; pb: number | null; ps: number | null; ps_date?: string | null };
export type StationExtras = { group: PeerGroup | null; peerRows: PeerMultipleRow[]; forward: (ForwardInput & { asOf: string; epsSource: string; ai: boolean }) | null; forwardBlocked: string | null; loading: boolean };

const attempted = new Map<string, string | null>();

export function useStationExtras(symbol?: string | null, industry?: string | null): StationExtras {
  const filingRevision = useFilingRefresh();
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
    // 前瞻預估只經 forward_estimate_for（登入者、單檔、不含建立者），不直接讀資料表
    const readForward = () => Promise.resolve(gw.rpc<any[]>('forward_estimate_for', { _symbol: code }))
      .then((rows: any) => (Array.isArray(rows) ? rows[0] : rows?.data?.[0]) ?? null).catch(() => null);
    const fwdP = readForward()
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
            return { row: await readForward(), blocked: null };
          }
          return { row: null, blocked };
        } catch { attempted.set(code, null); return { row: null, blocked: null }; }
      });
    Promise.all([peerP, fwdP]).then(([rows, fr]) => {
      const f = fr?.row ?? null;
      if (cancelled) return;
      setState({
        group,
        peerRows: Array.isArray(rows) ? rows.map((r) => ({ ...r, pe: r.pe == null ? null : Number(r.pe), pb: r.pb == null ? null : Number(r.pb), ps: r.ps == null ? null : Number(r.ps) })) : [],
        forward: f ? { eps: Number(f.eps), multiple: f.forward_pe == null ? null : Number(f.forward_pe), period: f.period, source: f.pe_source ?? null, epsSource: f.eps_source, asOf: f.as_of, ai: String(f.note || '').startsWith('ai_extraction:') } : null,
        forwardBlocked: f ? null : fr?.blocked ?? null,
        loading: false,
      });
    });
    return () => { cancelled = true; };
  }, [symbol, industry, filingRevision]);
  return state;
}
