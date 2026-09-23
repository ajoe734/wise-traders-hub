/**
 * ValuationRulers —— 估值三把尺 + 同業中位數比較（持倉抽屜內）。
 *
 * 設計硬合約：
 *   - 顏色不單獨承載意義：每格都同時有數字 + 文字標籤（偏低／合理／偏高／不適用／資料不足）。
 *   - 不出現任何買賣建議字眼。
 *   - as-of / source 永遠可見。
 *   - 不得增加抽屜寬度；手機 ≤640px 維持 3 欄極簡，靠 min-width:0 + 字級縮小防溢出。
 *   - 所有數字由 `valuationRulers.ts` 純函式算好後傳入，本檔案不做運算。
 */
import { useState } from 'react';
import {
  formatPremium,
  isFinancialIndustry,
  RULER_LABEL,
  type PeerDistribution,
  type PeerStat,
  type RulerKey,
  type RulerResult,
  type TrendSeries,
  type ValuationView,
} from '@/checkup/lib/valuationRulers';
import { useValuationSnapshot } from '@/checkup/hooks/useValuationSnapshot';
import type { CheckupGateway } from '@/checkup/lib/gateway';

const SERIF = '"Source Serif 4", "Noto Serif TC", serif';

function fmt(key: string, v: number | null): string {
  if (v == null) return '—';
  return key === 'dividendYield' ? `${v.toFixed(2)}%` : v.toFixed(2);
}

function RulerCard({ WB, r }: { WB: any; r: RulerResult }) {
  return (
    <div
      data-testid={`valuation-ruler-${r.key}`}
      data-band={r.band}
      style={{ minWidth: 0, border: `1px solid ${WB.hair}`, padding: '8px 10px' }}
    >
      <div style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>
        {RULER_LABEL[r.key]}
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 700, color: WB.ink, lineHeight: 1.4 }}>
        {fmt(r.key, r.value)}
      </div>
      <div data-testid={`valuation-band-${r.key}`} style={{ fontSize: 11, color: WB.inkSub, lineHeight: 1.5 }}>
        {r.bandLabel}
      </div>
      {r.percentile != null && (
        <div style={{ fontSize: 10, color: WB.inkMute }}>5 年分位 {r.percentile.toFixed(0)}%</div>
      )}
    </div>
  );
}

function PeerLine({ WB, stats }: { WB: any; stats: PeerStat[] }) {
  const usable = stats.filter((s) => s.median != null);
  if (usable.length === 0) {
    return (
      <div data-testid="valuation-peer-insufficient" style={{ fontSize: 11, color: WB.inkMute, marginTop: 6 }}>
        同業樣本不足（n={stats[0]?.n ?? 0}），暫不顯示同業中位數
      </div>
    );
  }
  return (
    <div data-testid="valuation-peer-row" style={{ fontSize: 11, color: WB.inkSub, marginTop: 6, lineHeight: 1.7 }}>
      {usable.map((s) => (
        <span key={s.key} style={{ marginRight: 10, whiteSpace: 'nowrap' }} data-testid={`valuation-peer-${s.key}`}>
          {s.label}同業中位數 {fmt(s.key, s.median)}（n={s.n}）· {formatPremium(s.premium)}
        </span>
      ))}
    </div>
  );
}

const CHART_KEYS: RulerKey[] = ['pe', 'pb', 'dividendYield'];

function DistributionChart({ WB, dist }: { WB: any; dist: PeerDistribution }) {
  if (dist.insufficient) {
    return (
      <div data-testid="valuation-distribution-insufficient" style={{ fontSize: 10, color: WB.inkMute }}>
        同業樣本不足（n={dist.n}），暫不顯示分布
      </div>
    );
  }
  return (
    <div data-testid="valuation-distribution" data-key={dist.key}>
      <div style={{ fontSize: 10, color: WB.inkMute, marginBottom: 4 }}>
        {dist.label}產業分布（同業 {dist.n} 家，含本檔共 {dist.total} 檔）
      </div>
      {dist.buckets.map((b, i) => {
        const pct = dist.maxCount > 0 ? Math.round((b.count / dist.maxCount) * 100) : 0;
        const marks = [b.hasSelf ? '本檔' : '', b.hasMedian ? '中位數' : ''].filter(Boolean).join('・');
        return (
          <div
            key={i}
            data-testid={`valuation-distribution-bucket-${dist.key}-${i}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, lineHeight: 1.6 }}
          >
            <span style={{ fontSize: 10, color: WB.inkMute, width: 78, flex: '0 0 78px', whiteSpace: 'nowrap' }}>
              {fmt(dist.key, b.from)}–{fmt(dist.key, b.to)}
            </span>
            <span style={{ flex: '1 1 auto', minWidth: 0, height: 8, background: WB.hair }}>
              <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: WB.ink, opacity: 0.55 }} />
            </span>
            <span style={{ fontSize: 10, color: WB.inkSub, whiteSpace: 'nowrap' }}>
              {b.count} 檔{marks ? `・${marks}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TrendChart({ WB, series }: { WB: any; series: TrendSeries }) {
  if (series.insufficient) {
    return (
      <div data-testid="valuation-trend-insufficient" style={{ fontSize: 10, color: WB.inkMute, marginTop: 8 }}>
        {series.label}趨勢資料不足（{series.points.length} 個月）
      </div>
    );
  }
  const W = 300;
  const H = 56;
  const min = series.min as number;
  const max = series.max as number;
  const span = max - min || 1;
  const n = series.points.length;
  const d = series.points
    .map((p, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * W;
      const y = H - ((p.value - min) / span) * (H - 6) - 3;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div data-testid="valuation-trend" data-key={series.key} style={{ marginTop: 8, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: WB.inkMute, marginBottom: 2 }}>{series.label}估值趨勢（每月取樣）</div>
      <svg
        role="img"
        aria-label={`${series.label}估值趨勢：${series.rangeText}`}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: 56, border: `1px solid ${WB.hair}` }}
      >
        <path d={d} fill="none" stroke={WB.ink} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div data-testid="valuation-trend-range" style={{ fontSize: 10, color: WB.inkSub, marginTop: 2 }}>
        {series.points[0].date.split('-').slice(0, 2).join('/')}–
        {series.points[n - 1].date.split('-').slice(0, 2).join('/')}｜{series.rangeText}
      </div>
    </div>
  );
}

function PeerCharts({ WB, view }: { WB: any; view: ValuationView }) {
  const [key, setKey] = useState<RulerKey>('pe');
  const dist = view.distributions.find((d) => d.key === key);
  const trend = view.trends.find((t) => t.key === key);
  if (!dist || !trend) return null;
  return (
    <div data-testid="valuation-peer-charts" style={{ marginTop: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {CHART_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            data-testid={`valuation-chart-metric-${k}`}
            aria-pressed={k === key}
            onClick={() => setKey(k)}
            style={{
              fontSize: 10,
              padding: '2px 8px',
              cursor: 'pointer',
              background: 'transparent',
              border: `1px solid ${k === key ? WB.ink : WB.hair}`,
              color: k === key ? WB.ink : WB.inkSub,
              fontWeight: k === key ? 700 : 400,
            }}
          >
            {RULER_LABEL[k]}
            {k === key ? '（檢視中）' : ''}
          </button>
        ))}
      </div>
      <DistributionChart WB={WB} dist={dist} />
      <TrendChart WB={WB} series={trend} />
    </div>
  );
}

export function ValuationRulersView({
  WB,
  view,
  status,
  error,
  stale,
  onRetry,
}: {
  WB: any;
  view: ValuationView | null;
  status: string;
  error: string | null;
  stale: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (status === 'idle') return null;

  if (status === 'loading') {
    return (
      <div data-testid="valuation-skeleton" style={{ marginTop: 16, fontSize: 11, color: WB.inkMute }}>
        估值資料載入中…
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div data-testid="valuation-error" style={{ marginTop: 16, fontSize: 11, color: '#b04a4a' }}>
        估值資料暫時取不到{error ? `（${error}）` : ''}
        <button
          type="button"
          data-testid="valuation-retry"
          onClick={onRetry}
          style={{ marginLeft: 8, fontSize: 11, border: `1px solid ${WB.hair}`, background: 'transparent', padding: '1px 8px', cursor: 'pointer' }}
        >
          重試
        </button>
      </div>
    );
  }

  if (!view) {
    return (
      <div data-testid="valuation-empty" style={{ marginTop: 16, fontSize: 11, color: WB.inkMute }}>
        尚無估值資料
      </div>
    );
  }

  return (
    <div data-testid="valuation-rulers" style={{ marginTop: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: WB.inkMute, letterSpacing: '0.14em' }}>估值三把尺</div>
        <div data-testid="valuation-asof" style={{ fontSize: 10, color: WB.inkMute, textAlign: 'right' }}>
          {view.asOf ? view.asOf.split('-').join('/') : '無日期'} · 來源 {view.source || '未知'}
          {stale ? ' · 資料較舊' : ''}
        </div>
      </div>

      <div
        className="valuation-ruler-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}
      >
        {view.rulers.map((r) => (
          <RulerCard key={r.key} WB={WB} r={r} />
        ))}
      </div>

      <div
        data-testid="valuation-summary"
        data-overall={view.summary.overall || 'na'}
        style={{ marginTop: 8, fontSize: 12, color: WB.ink, fontWeight: 700 }}
      >
        {view.summary.text}
      </div>

      {isFinancialIndustry(view.industry) && (
        <div data-testid="valuation-financial-note" style={{ fontSize: 10, color: WB.inkMute, marginTop: 4 }}>
          金融股以股價淨值比與現金殖利率為主，本益比易受一次性損益影響
        </div>
      )}

      {view.peerIndustry && (
        <div data-testid="valuation-peer-scope" style={{ fontSize: 10, color: WB.inkMute, marginTop: 6 }}>
          同業母體：{view.peerIndustry}
          {view.peerScope === 'broad' ? '（細分同業不足，改用產業大類）' : ''}
        </div>
      )}

      <PeerLine WB={WB} stats={view.peerStats} />

      {view.nearestPeers.length > 0 && (
        <>
          <button
            type="button"
            data-testid="valuation-peer-expand"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            style={{ marginTop: 6, fontSize: 11, color: WB.inkSub, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            {open ? '收合同業明細' : `展開同業明細（${view.peerCount} 家）`}
          </button>
          {open && (
            <div data-testid="valuation-peer-detail" style={{ marginTop: 6, fontSize: 11, color: WB.inkSub, lineHeight: 1.8 }}>
              {[...view.nearestPeers, ...view.restPeers].map((p) => (
                <div key={p.symbol} style={{ minWidth: 0 }}>
                  {p.symbol} {p.name || ''} · 本益比 {fmt('pe', p.pe)} · 淨值比 {fmt('pb', p.pb)} · 殖利率 {fmt('dividendYield', p.dividendYield)}
                </div>
              ))}
              <PeerCharts WB={WB} view={view} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ValuationRulers({
  WB,
  stockCode,
  injectedGateway,
}: {
  WB: any;
  stockCode?: string | null;
  injectedGateway?: CheckupGateway;
}) {
  const { status, view, error, stale, refetch } = useValuationSnapshot(stockCode, { injectedGateway });
  return (
    <ValuationRulersView WB={WB} view={view} status={status} error={error} stale={stale} onRetry={refetch} />
  );
}
