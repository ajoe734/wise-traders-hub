// @ts-nocheck
/**
 * Preview-only harness：權證 identity → K 線 symbol。
 * Route: /e2e/warrant-identity-harness?ocr=54530&name=祥碩凱基5C購01
 *
 * 契約：必須與 production OCR import path 一致 —— 先跑
 * `screenImportedTradeIdentities` fail-closed gate，被拒絕就不得 canonicalize 成
 * 持倉、不得發任何 sparkline 請求。
 */
import { useEffect, useState } from 'react';
import {
  canonicalizeTradeRow,
  screenImportedTradeIdentities,
} from '@/checkup/lib/importedTradeIdentity';
import { supabase } from '@/integrations/supabase/client';

export default function WarrantIdentityHarnessEntry() {
  const params = new URLSearchParams(window.location.search);
  const rawOcr = params.get('ocr') ?? '54530';
  const name = params.get('name') ?? '祥碩凱基5C購01';

  // production parity：gate 先跑於原始 OCR 列，再 canonicalize
  const rawRow = { code: Number.isNaN(Number(rawOcr)) ? rawOcr : Number(rawOcr), name, qty: 10, price: 0.61, action: '買進' };
  const gate = screenImportedTradeIdentities([canonicalizeTradeRow(rawRow)]);
  const accepted = gate.ok ? gate.accepted : [];
  const code = accepted[0]?.code ?? '';

  const [state, setState] = useState({
    status: gate.ok ? 'loading' : 'blocked',
    symbol: '',
    first: null,
    last: null,
  });

  useEffect(() => {
    if (!gate.ok || !code) {
      setState({ status: 'blocked', symbol: '', first: null, last: null });
      return;
    }
    let alive = true;
    (async () => {
      const { data, error } = await supabase.functions.invoke('checkup-sparkline', {
        body: { codes: [code] },
      });
      if (!alive) return;
      const entry = data?.result?.[code];
      const ohlc = entry?.ohlc ?? [];
      setState({
        status: error ? 'error' : 'ok',
        symbol: Object.keys(data?.result ?? {}).join(','),
        first: ohlc[0] ?? null,
        last: ohlc[ohlc.length - 1] ?? null,
      });
    })();
    return () => { alive = false; };
  }, [code, gate.ok]);

  return (
    <div id="warrant-identity-harness" style={{ padding: 16, fontFamily: 'monospace', fontSize: 13 }}>
      <div data-testid="ocr-raw">ocr_raw={String(rawOcr)}</div>
      <div data-testid="gate-ok">gate_ok={String(gate.ok)}</div>
      <div data-testid="accepted-count">accepted={accepted.length}</div>
      <div data-testid="canonical-code">canonical_code={code}</div>
      <div data-testid="display-name">name={name}</div>
      <div data-testid="chart-status">status={state.status}</div>
      <div data-testid="chart-symbol">chart_symbol={state.symbol}</div>
      <div data-testid="chart-first">first={JSON.stringify(state.first)}</div>
      <div data-testid="chart-last">last={JSON.stringify(state.last)}</div>
      {!gate.ok && (
        <div data-testid="identity-error" role="alert" style={{ marginTop: 12, color: '#B4232A' }}>
          {gate.error}
        </div>
      )}
    </div>
  );
}
