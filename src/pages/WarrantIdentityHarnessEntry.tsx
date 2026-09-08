// @ts-nocheck
/**
 * Preview-only harness：權證 identity → K 線 symbol。
 * Route: /e2e/warrant-identity-harness?ocr=54530&name=祥碩凱基5C購01
 *
 * 目的：在真實 Preview runtime（非單元測試）證明
 *   1. OCR 數值化代號 54530 會 canonicalize 回 "054530"
 *   2. 實際 checkup-sparkline 請求送出的 symbol 是 054530，不是標的 5269
 */
import { useEffect, useState } from 'react';
import { canonicalizeTradeRow } from '@/checkup/lib/importedTradeIdentity';
import { supabase } from '@/integrations/supabase/client';

export default function WarrantIdentityHarnessEntry() {
  const params = new URLSearchParams(window.location.search);
  const rawOcr = params.get('ocr') ?? '54530';
  const name = params.get('name') ?? '祥碩凱基5C購01';
  const row = canonicalizeTradeRow({ code: Number(rawOcr), name, qty: 10, price: 0.61, action: '買進' });
  const [state, setState] = useState({ status: 'loading', symbol: '', first: null, last: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.functions.invoke('checkup-sparkline', {
        body: { codes: [row.code] },
      });
      if (!alive) return;
      const entry = data?.result?.[row.code];
      const ohlc = entry?.ohlc ?? [];
      setState({
        status: error ? 'error' : 'ok',
        symbol: Object.keys(data?.result ?? {}).join(','),
        first: ohlc[0] ?? null,
        last: ohlc[ohlc.length - 1] ?? null,
      });
    })();
    return () => { alive = false; };
  }, [row.code]);

  return (
    <div id="warrant-identity-harness" style={{ padding: 16, fontFamily: 'monospace', fontSize: 13 }}>
      <div data-testid="ocr-raw">ocr_raw={String(rawOcr)}</div>
      <div data-testid="canonical-code">canonical_code={row.code}</div>
      <div data-testid="display-name">name={row.name}</div>
      <div data-testid="chart-status">status={state.status}</div>
      <div data-testid="chart-symbol">chart_symbol={state.symbol}</div>
      <div data-testid="chart-first">first={JSON.stringify(state.first)}</div>
      <div data-testid="chart-last">last={JSON.stringify(state.last)}</div>
    </div>
  );
}
