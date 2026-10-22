/**
 * HoldingsSectorValuation —— 持倉的「產業分布 × 市場族群比例 × 各自的加權估值指數」。
 *
 * 設計硬合約：
 *   - 所有數字由 `valuationRulers.ts` 純函式算好（buildBucketValuations），本檔不做運算。
 *   - 產業桶依營收拆分權重分攤市值（與索引區 aggregateBySector 同口徑），合計 100%。
 *   - 市場族群是純標籤：桶與桶之間不互斥，比例不得與產業桶相加。
 *   - 同業門檻沿用 MIN_PEER_N：桶內算不出溢折價的部分不計入涵蓋率，三把尺全不足顯示「同業樣本不足」。
 *   - 顏色不單獨承載意義（條形圖旁一律有數字與文字），不出現任何買賣建議字眼。
 *   - 手機 ≤640px 允許換行，禁止橫向溢出。
 */
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import ValuationSpectrum from './ValuationSpectrum';
import {
  PORTFOLIO_BUCKET_VALUATION_CONTRACT,
  type BucketAssignment,
  type BucketValuation,
} from '@/checkup/lib/valuationRulers';
import { usePortfolioValuation, type PortfolioHoldingLike } from '@/checkup/hooks/usePortfolioValuation';
import { getMultiMeta } from '@/checkup/lib/stockMetaMulti';
import type { CheckupGateway } from '@/checkup/lib/gateway';

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v * 1000) / 10}%`;
}

function fmtPremium(v: number | null): string {
  if (v == null) return '—';
  const p = v * 100;
  const rounded = Math.sign(p) * (Math.round(Math.abs(p) * 10) / 10);
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
}

function BucketRow({ b }: { b: BucketValuation }) {
  return <div data-testid={`holdings-bucket-valuation-${b.key}`} data-kind={b.kind}>
    {b.insufficient ? <p className="hv-sub" data-testid={`holdings-bucket-insufficient-${b.key}`}>同業樣本不足，暫不顯示加權指數</p> : <>
      <ValuationSpectrum rulers={b.rulers} name={`${b.key}估值`} />
      <div className="hv-values">{b.rulers.map(r => <div key={r.key} data-testid={`holdings-bucket-${b.key}-${r.key}`}><strong>{r.label} {fmtPremium(r.weightedPremium)}</strong><p>{r.text}</p></div>)}</div>
      <p className="hv-sub" data-testid={`holdings-bucket-coverage-${b.key}`}>涵蓋 {pct(b.coverage)} 該桶市值</p>
    </>}
  </div>;
}

export default function HoldingsSectorValuation({
  holdings,
  stockMeta,
  overrides,
  WB,
  injectedGateway,
}: {
  holdings: PortfolioHoldingLike[] | null | undefined;
  stockMeta?: any;
  overrides?: any;
  WB: any;
  injectedGateway?: CheckupGateway;
  maxRows?: number;
}) {
  const [selected, setSelected] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const bucketsOf = useCallback(
    (symbol: string): BucketAssignment[] => {
      const meta = getMultiMeta(symbol, stockMeta || {}, (overrides || {})[symbol]);
      const out: BucketAssignment[] = [];
      const industries: string[] = Array.isArray(meta?.industries) ? meta.industries : [];
      const mix = Array.isArray(meta?.revenueMix) ? meta.revenueMix : null;
      if (mix && mix.length > 0) {
        for (const m of mix) {
          if (!m?.industry) continue;
          out.push({ kind: 'industry', key: m.industry, share: (Number(m.pct) || 0) / 100 });
        }
      } else {
        for (const k of industries) {
          if (!k) continue;
          out.push({ kind: 'industry', key: k, share: 1 / industries.length });
        }
      }
      const groups: string[] = Array.isArray(meta?.marketGroups) ? (meta.marketGroups as string[]) : [];
      for (const g of groups) {
        if (g) out.push({ kind: 'marketGroup', key: String(g) });
      }
      return out;
    },
    [stockMeta, overrides],
  );

  const { status, buckets, asOf } = usePortfolioValuation(holdings, { injectedGateway, bucketsOf });

  const { industryBuckets, groupBuckets } = useMemo(
    () => ({
      industryBuckets: buckets.filter((b) => b.kind === 'industry'),
      groupBuckets: buckets.filter((b) => b.kind === 'marketGroup'),
    }),
    [buckets],
  );

  if (status === 'idle') return null;
  if (status === 'loading') {
    return (
      <div
        data-testid="holdings-sector-valuation-loading"
        data-contract={PORTFOLIO_BUCKET_VALUATION_CONTRACT}
        style={{ margin: '4px 0 10px', border: `1px solid ${WB.hair}`, padding: '10px 12px', fontSize: 11, color: WB.inkMute }}
      >
        產業與族群估值計算中…
      </div>
    );
  }
  if (industryBuckets.length === 0 && groupBuckets.length === 0) return null;

  const available = [...industryBuckets, ...groupBuckets];
  const active = available.find(b => `${b.kind}:${b.key}` === selected) || available[0];
  return <section className="hs-summary hv-section" data-testid="holdings-sector-valuation" data-contract={PORTFOLIO_BUCKET_VALUATION_CONTRACT}>
    <header><h2>產業／族群估值</h2></header>
    <p className="hv-sub">各桶市值加權 vs 同業中位數 · 三把尺分開判讀</p>
    <div className="hv-selector"><select aria-label="選擇產業或市場族群估值" value={active ? `${active.kind}:${active.key}` : ''} onChange={e=>setSelected(e.target.value)}>
      {industryBuckets.length>0 && <optgroup label="產業">{industryBuckets.map(b=><option key={b.key} value={`industry:${b.key}`}>{b.key}</option>)}</optgroup>}
      {groupBuckets.length>0 && <optgroup label="市場族群">{groupBuckets.map(b=><option key={b.key} value={`marketGroup:${b.key}`}>{b.key}</option>)}</optgroup>}
    </select></div>
    {active && <BucketRow b={active} />}
    {active?.kind === 'marketGroup' && <p className="hv-sub">市場族群持股市值 {pct(active.weightShare)} · 標籤不互斥</p>}
    <Button variant="ghost" className="hv-toggle" aria-expanded={detailsOpen} onClick={()=>setDetailsOpen(v=>!v)}>{detailsOpen ? '收合估值依據' : '估值依據'}</Button>
    {detailsOpen && <p className="hv-meta">每個產業／族群各自以市值加權計算與同業中位數的溢折價；同業中位數需至少 3 家同業有當日有效數值，不足者不計入涵蓋率。涵蓋率＝該桶內算得出溢折價的市值 ÷ 該桶市值。僅描述相對位置，不構成買賣建議。</p>}
    <p className="hv-meta" data-testid="holdings-sector-valuation-meta">{asOf ? `截至 ${asOf.split('-').join('/')}` : '資料日期未提供'}</p>
  </section>;
}
