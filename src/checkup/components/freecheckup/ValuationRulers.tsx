/**
 * ValuationRulers —— PE/PB/PS 情境與獨立呈現的歷史比率、同業比較（持倉抽屜內）。
 *
 * 設計硬合約：
 *   - 顏色不單獨承載意義：每格都同時有數字 + 文字標籤（偏低／合理／偏高／不適用／資料不足）。
 *   - 不出現任何買賣建議字眼。
 *   - as-of / source 永遠可見。
 *   - 不得增加抽屜寬度；手機以逐尺明細換行，防止數字裁切。
 *   - 情境價格由 `valuationScenario.ts` 算好；歷史比率與同業仍由 `valuationRulers.ts` 處理。
 */
import { useState } from 'react';
import {
  formatPremium,
  peerScopeLabel,
  isFinancialIndustry,
  RULER_LABEL,
  type PeerDistribution,
  type PeerStat,
  type RulerKey,
  type TrendSeries,
  type ValuationView,
} from '@/checkup/lib/valuationRulers';
import { buildValuationScenario, historyReferenceBands, multiplesLabel, SCENARIO_BASES, SCENARIO_LABELS, type ValuationScenario, type ScenarioRow } from '@/checkup/lib/valuationScenario';
import { useValuationSnapshot } from '@/checkup/hooks/useValuationSnapshot';
import type { CheckupGateway } from '@/checkup/lib/gateway';

const SERIF = '"Source Serif 4", "Noto Serif TC", serif';

function fmt(key: string, v: number | null): string {
  if (v == null) return '—';
  return key === 'dividendYield' ? `${v.toFixed(2)}%` : v.toFixed(2);
}

const twd = (v: number | null) =>
  v == null ? '—' : `NT$${v.toLocaleString('zh-TW', { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
const twd2 = (v: number) => `NT$${v.toLocaleString('zh-TW', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const num = (v: number | null, d = 2) => (v == null ? '—' : v.toLocaleString('zh-TW', { maximumFractionDigits: d }));

/** 僅已公告、股數口徑相同的獨立分母與有理由的倍數才產生情境價。 */
function BasisRow({ WB, row }: { WB: any; row: ScenarioRow }) {
  const { key, basis, multiples } = row;
  const reference = row.basisOk && basis && row.reference
    ? { low: basis.value * row.reference.low, high: basis.value * row.reference.high, ...row.reference }
    : null;
  return (
    <div
      data-testid={`valuation-ruler-${key}`}
      className="valuation-basis-row"
      style={{ minWidth: 0, borderTop: `1px solid ${WB.hair}`, padding: '10px 0', fontSize: 12, color: WB.inkSub, lineHeight: 1.7, overflowWrap: 'anywhere' }}
    >
      <div style={{ color: WB.ink, fontWeight: 700 }}>{SCENARIO_LABELS[key]}</div>
      <div data-testid={`valuation-basis-value-${key}`} data-basis-ok={row.basisOk ? '1' : '0'}>
        {row.basisOk && basis
          ? <>分母已計算：{basis.kind === 'forecast' ? '預測假設' : '已公布'}{SCENARIO_BASES[key]} <strong style={{ color: WB.ink }}>{twd2(Number(basis.value.toFixed(2)))}</strong></>
          : <>分母不適用：{row.reason}</>}
      </div>
      {row.basisOk && (
        <div data-testid={`valuation-basis-range-${key}`} data-confidence={row.confidence ?? ''}>
          {row.low != null && row.high != null && basis && multiples
            ? <>{SCENARIO_BASES[key]} {twd2(Number(basis.value.toFixed(2)))} × {num(multiples.low)}–{num(multiples.high)} 倍 = <span style={{ whiteSpace: 'nowrap' }}>{twd(row.low)}–{twd(row.high)}</span>{row.confidence === 'low' ? '（倍數信心低，不合成主圖區間）' : ''}</>
            : <>倍數信心：依據不足——{row.reason}</>}
        </div>
      )}
      {basis?.derivation && <div data-testid={`valuation-basis-derivation-${key}`}>算式：{basis.derivation}</div>}
      {basis && <div data-testid={`valuation-basis-availability-${key}`}>分母：{basis.source} · {basis.period} · {basis.availability?.note ?? `法定申報期限 ${basis.publishedAt}（非實際公告日）`} · {basis.unit} · 股數基準 {basis.shareBasis}</div>}
      {multiples && <div data-testid={`valuation-multiples-${key}`} data-method={multiples.method ?? 'history'}><strong style={{ color: WB.ink }}>{multiplesLabel(multiples)}</strong>：{multiples.reason} · {multiples.source} · {multiples.period} · 樣本 {multiples.sampleSize} · 同業 {multiples.peerComparability} · 景氣 {multiples.cycle} · 成長 {multiples.growth} · 獲利 {multiples.earningsStability} · 現金 {multiples.cash} · 負債 {multiples.debt}</div>}
      {reference && !multiples && <div data-testid={`valuation-reference-detail-${key}`} style={{ color: WB.ink }}>
        {reference.label}：{twd(reference.low)}–{twd(reference.high)} · 倍數 {num(row.reference!.low)}–{num(row.reference!.high)} · {reference.sampleSize} 個獨立期 · {reference.period} · {reference.note}
      </div>}
      {multiples?.caveats?.length ? <div data-testid={`valuation-caveats-${key}`} style={{ color: WB.ink }}>注意：{multiples.caveats.join('；')}</div> : null}
      {row.samples?.length ? (
        <details data-testid={`valuation-samples-${key}`} style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', color: WB.ink }}>相近景氣期歷史 {row.samples.length} 個資料期（同期多個月點只算一份證據）</summary>
          {row.samples.map((s) => (
            <div key={s.quarter} style={{ overflowWrap: 'anywhere' }}>
              {s.months != null
                ? <>{s.quarter}（{s.firstDate}～{s.date}，月末點 {s.months} 個）收盤 {twd2(s.closeMin!)}–{twd2(s.closeMax!)} ÷ {SCENARIO_BASES[key]} {twd2(Number(s.basis.toFixed(2)))} = 中位 {num(s.multiple, 1)} 倍（{num(s.multipleMin!, 1)}–{num(s.multipleMax!, 1)}）</>
                : <>{s.quarter}：{s.date} 收盤 {twd2(s.close)} ÷ {SCENARIO_BASES[key]} {twd2(Number(s.basis.toFixed(2)))} = {num(s.multiple, 1)} 倍</>}
              {' '}· 營收年增 {s.growthYoY == null ? '—' : `${Math.round(s.growthYoY * 100)}%`} · 淨利率 {s.netMargin == null ? '—' : `${(s.netMargin * 100).toFixed(1)}%`}
              {' '}· 現金 {s.cashRatio == null ? '—' : `${Math.round(s.cashRatio * 100)}%`} · 負債 {s.debtRatio == null ? '—' : `${Math.round(s.debtRatio * 100)}%`}
              {s.excluded ? <> · <strong style={{ color: WB.ink }}>排除：{s.excluded}</strong></> : null}
            </div>
          ))}
        </details>
      ) : null}
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
        <span key={s.key} style={{ display: 'block', overflowWrap: 'anywhere' }} data-testid={`valuation-peer-${s.key}`}>
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
            {k === 'dividendYield' ? '現金殖利率（輔助）' : RULER_LABEL[k]}
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
  band = null,
  defaultBasisOpen = false,
  status,
  error,
  stale,
  onRetry,
}: {
  WB: any;
  view: ValuationView | null;
  band?: ValuationScenario | null;
  /** harness / 測試用：預設展開計算依據。 */
  defaultBasisOpen?: boolean;
  status: string;
  error: string | null;
  stale: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [basisOpen, setBasisOpen] = useState(defaultBasisOpen);

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

  const scenario = band ?? buildValuationScenario(view.asOf, []);
  const references = historyReferenceBands(scenario);

  return (
    <div data-testid="valuation-rulers" style={{ marginTop: 16, minWidth: 0 }}>
      <button
        type="button"
        data-testid="valuation-basis-toggle"
        aria-expanded={basisOpen}
        onClick={() => setBasisOpen((v) => !v)}
        style={{ fontSize: 12, color: WB.inkSub, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', letterSpacing: '0.08em' }}
      >
         {basisOpen ? '▾' : '▸'} 怎麼算（三把尺、同業參考）
      </button>
      {basisOpen && (
      <div data-testid="valuation-basis" style={{ marginTop: 8, minWidth: 0 }}>
       <div data-testid="valuation-asof" style={{ fontSize: 12, color: WB.inkSub, marginBottom: 6 }}>
         比率資料日 {view.asOf ? view.asOf.split('-').join('/') : '無日期'} · 來源 {view.source || '未知'}
        {stale ? ' · 資料已逾 7 天' : ''}
      </div>

       {scenario.rows.map((row) => (
         <BasisRow key={row.key} WB={WB} row={row} />
      ))}

       {references.length > 0 && (
         <div data-testid="valuation-reference-detail-summary" style={{ fontSize: 12, color: WB.ink, marginTop: 6, lineHeight: 1.7 }}>
           個別歷史估值參考：{references.map((r) => `${SCENARIO_LABELS[r.key].split(' ')[0]} ${twd(r.low)}–${twd(r.high)}（${r.sampleSize} 個獨立期，${r.period}）`).join('；')}。低信心，非合理價。
         </div>
       )}

       <div data-testid="valuation-basis-formula" style={{ fontSize: 12, color: WB.inkSub, marginTop: 6, lineHeight: 1.7 }}>
         三尺分別以已公告或明標預測的每股獲利、淨值、營收 × 有理由的倍數推算；三尺資料都可信且有共同支持區才顯示情境區間。
          {scenario.basisCount === 0 ? '目前沒有通過核實的財報分母。' : ''}不能以現價除比率當作財報分母。下方歷史比率與產業同業僅供參考，不代表可比同業或合理價格。
      </div>

       <div data-testid="valuation-summary" data-overall="na" style={{ marginTop: 8, fontSize: 12, color: WB.ink, fontWeight: 700 }}>
         財報分母 {scenario.basisCount}/3 已計算；{scenario.shareVerification?.source === 'official' && !scenario.shareVerification.preferredUnknown
           ? '股數已由官方名錄核對'
           : scenario.shareVerification?.source === 'fallback'
             ? `股數採後備核對${scenario.shareVerification.preferredUnknown ? '，特別股待官方確認' : ''}`
             : '股數核對來源未明'}；倍數區間 {scenario.validCount}/3 可算；{scenario.status === 'consensus' ? '共同支持區僅為情境，非獲利保證' : scenario.status === 'historical' ? '歷史情境參考，非合理價' : '暫無單一合理區間'}
       </div>

       <div data-testid="valuation-historical-ratios" style={{ marginTop: 8, fontSize: 11, color: WB.inkSub, lineHeight: 1.7 }}>
         歷史比率參考（非三尺情境價）：本益比 {fmt('pe', view.rulers[0]?.value ?? null)}、股價淨值比 {fmt('pb', view.rulers[1]?.value ?? null)}；現金殖利率 {fmt('dividendYield', view.rulers[2]?.value ?? null)} 僅為輔助資訊。
       </div>

      {isFinancialIndustry(view.industry) && (
        <div data-testid="valuation-financial-note" style={{ fontSize: 10, color: WB.inkMute, marginTop: 4 }}>
           金融股 PB 股價淨值比通常較具參考性；仍須核實淨值與倍數理由。殖利率僅作輔助觀察
        </div>
      )}

      {view.peerIndustry && (
        <div data-testid="valuation-peer-scope" data-scope={view.peerScope} style={{ fontSize: 10, color: WB.inkMute, marginTop: 6 }}>
           產業比率參考（非已核實產品／風險可比同業）：{view.peerIndustry}（{peerScopeLabel(view.peerScope)}・{view.peerCount} 家）
          {view.peerScope === 'broad' ? '・細分同業不足，改用產業大類' : ''}
          {view.peerScope === 'fineWide' ? '・主產業同業不足，納入次要產業' : ''}
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
  const { status, view, band, error, stale, refetch } = useValuationSnapshot(stockCode, { injectedGateway });
  return (
    <ValuationRulersView WB={WB} view={view} band={band} status={status} error={error} stale={stale} onRetry={refetch} />
  );
}
