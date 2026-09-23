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
import {
  PORTFOLIO_BUCKET_VALUATION_CONTRACT,
  type BucketAssignment,
  type BucketValuation,
} from '@/checkup/lib/valuationRulers';
import { usePortfolioValuation, type PortfolioHoldingLike } from '@/checkup/hooks/usePortfolioValuation';
import { getMultiMeta } from '@/checkup/lib/stockMetaMulti';
import type { CheckupGateway } from '@/checkup/lib/gateway';

const SERIF = '"Source Serif 4", "Noto Serif TC", serif';

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

function BucketRow({ WB, b, maxShare }: { WB: any; b: BucketValuation; maxShare: number }) {
  const barPct = maxShare > 0 ? Math.round((b.weightShare / maxShare) * 100) : 0;
  return (
    <div
      data-testid={`holdings-bucket-valuation-${b.key}`}
      data-kind={b.kind}
      style={{ borderTop: `1px solid ${WB.hair}`, padding: '6px 0', minWidth: 0 }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 8px', minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: WB.ink, minWidth: 0 }}>{b.key}</span>
        <span style={{ fontFamily: SERIF, fontSize: 13, fontWeight: 700, color: WB.ink }}>{pct(b.weightShare)}</span>
        <span style={{ fontSize: 10, color: WB.inkMute }}>{b.stockCount} 檔</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, margin: '3px 0' }}>
        <span style={{ flex: '1 1 auto', minWidth: 0, height: 6, background: WB.hair }}>
          <span style={{ display: 'block', width: `${barPct}%`, height: '100%', background: WB.ink, opacity: 0.55 }} />
        </span>
      </div>
      {b.insufficient ? (
        <div data-testid={`holdings-bucket-insufficient-${b.key}`} style={{ fontSize: 10, color: WB.inkMute }}>
          同業樣本不足，暫不顯示加權指數
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', minWidth: 0 }}>
          {b.rulers.map((r) => (
            <span key={r.key} data-testid={`holdings-bucket-${b.key}-${r.key}`} style={{ fontSize: 10, color: WB.inkSub, whiteSpace: 'nowrap' }}>
              {r.label} {fmtPremium(r.weightedPremium)}（{r.text}）
            </span>
          ))}
          <span data-testid={`holdings-bucket-coverage-${b.key}`} style={{ fontSize: 10, color: WB.inkMute, whiteSpace: 'nowrap' }}>
            涵蓋 {pct(b.coverage)}
          </span>
        </div>
      )}
    </div>
  );
}

export default function HoldingsSectorValuation({
  holdings,
  stockMeta,
  overrides,
  WB,
  injectedGateway,
  maxRows = 8,
}: {
  holdings: PortfolioHoldingLike[] | null | undefined;
  stockMeta?: any;
  overrides?: any;
  WB: any;
  injectedGateway?: CheckupGateway;
  maxRows?: number;
}) {
  const [open, setOpen] = useState(false);

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
      for (const g of Array.isArray(meta?.marketGroups) ? meta.marketGroups : []) {
        if (g) out.push({ kind: 'marketGroup', key: g });
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

  const indShown = open ? industryBuckets : industryBuckets.slice(0, maxRows);
  const grpShown = open ? groupBuckets : groupBuckets.slice(0, maxRows);
  const maxIndShare = Math.max(...industryBuckets.map((b) => b.weightShare), 0);
  const maxGrpShare = Math.max(...groupBuckets.map((b) => b.weightShare), 0);
  const hidden =
    Math.max(industryBuckets.length - indShown.length, 0) + Math.max(groupBuckets.length - grpShown.length, 0);

  return (
    <div
      data-testid="holdings-sector-valuation"
      data-contract={PORTFOLIO_BUCKET_VALUATION_CONTRACT}
      style={{ margin: '4px 0 10px', border: `1px solid ${WB.hair}`, padding: '10px 12px', minWidth: 0 }}
    >
      <div style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.12em', marginBottom: 4 }}>
        產業分布與市場族群（市值佔比 vs 同業中位數）
      </div>

      {industryBuckets.length > 0 && (
        <div data-testid="holdings-sector-distribution">
          <div style={{ fontSize: 10, color: WB.inkSub, marginTop: 4 }}>產業分布（依細分產業，合計 100%）</div>
          {indShown.map((b) => (
            <BucketRow key={`ind-${b.key}`} WB={WB} b={b} maxShare={maxIndShare} />
          ))}
        </div>
      )}

      {groupBuckets.length > 0 && (
        <div data-testid="holdings-group-distribution" style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: WB.inkSub }}>市場族群（純標籤，一檔可屬多個族群，比例不互斥）</div>
          {grpShown.map((b) => (
            <BucketRow key={`grp-${b.key}`} WB={WB} b={b} maxShare={maxGrpShare} />
          ))}
        </div>
      )}

      {hidden > 0 && (
        <button
          type="button"
          data-testid="holdings-sector-valuation-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{
            border: 'none',
            background: 'transparent',
            padding: 0,
            marginTop: 6,
            font: 'inherit',
            fontSize: 10,
            color: WB.inkMute,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
            cursor: 'pointer',
          }}
        >
          {open ? '收合' : `展開其餘 ${hidden} 項`}
        </button>
      )}

      <div data-testid="holdings-sector-valuation-meta" style={{ fontSize: 10, color: WB.inkMute, marginTop: 6, lineHeight: 1.7 }}>
        每個產業／族群各自以市值加權計算與同業中位數的溢折價；同業中位數需至少 3 家同業有當日有效數值，
        不足者不計入涵蓋率。涵蓋率＝該桶內算得出溢折價的市值 ÷ 該桶市值。僅描述相對位置，不構成買賣建議。
        {asOf ? `・截至 ${asOf.split('-').join('/')}` : ''}
      </div>
    </div>
  );
}
