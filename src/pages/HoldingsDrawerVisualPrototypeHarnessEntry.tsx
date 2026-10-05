import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RangeBand } from '@/checkup/components/freecheckup/HoldingsDetailPanel';
import { WB } from '@/pages/_freeCheckup/constants.jsx';
import './holdingsDrawerVisualPrototype.css';

const PRICE = 4229.3;
const COST = 2566.67;
const TARGET = 3429;

function makeOhlc() {
  const closes = [
    3290, 3240, 3175, 3260, 3380, 3310, 3480, 3560, 3475, 3690,
    3820, 3750, 3910, 4050, 3970, 4180, 4310, 4240, 4460, 4610,
    4520, 4780, 4930, 4810, 5070, 5345, 5120, 4860, 4510, PRICE,
  ];
  return closes.map((close, index) => {
    const previous = index === 0 ? 3230 : closes[index - 1];
    const open = Number((previous + (index % 3 === 0 ? 34 : index % 3 === 1 ? -28 : 16)).toFixed(2));
    return {
      date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      open,
      high: Math.min(5345, Math.max(open, close) + 54 + (index % 4) * 12),
      low: Math.max(3175, Math.min(open, close) - 46 - (index % 5) * 9),
      close,
      volume: 1_100_000 + ((index * 379_000) % 4_800_000),
    };
  });
}

const INSTITUTIONAL = [
  { name: '外資', tone: 'foreign', values: [-84, 88, -980, -3481] },
  { name: '投信', tone: 'trust', values: [19, 79, 107, 3718] },
  { name: '自營商', tone: 'dealer', values: [5, -49, -199, -1239] },
];

type ScaleMode = 'target' | 'pe' | 'pb' | 'ps';

const SCALE_MODES: Array<{ key: ScaleMode; label: string }> = [
  { key: 'target', label: '目標價' },
  { key: 'pe', label: 'PE' },
  { key: 'pb', label: 'PB' },
  { key: 'ps', label: 'PS' },
];

const AXIS_MIN = 2400;
const AXIS_MAX = 4500;
const axisX = (value: number) => 28 + ((value - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * 344;

function LieflatPriceAxis({ showTarget }: { showTarget: boolean }) {
  const ticks = Array.from({ length: 43 }, (_, index) => index);
  const costX = axisX(COST);
  const targetX = axisX(TARGET);
  const priceX = axisX(PRICE);

  return (
    <svg className="hdvp-lieflat-axis" viewBox="0 0 400 174" role="img" aria-label={showTarget
      ? '等比例新台幣價格軸，成本 2566.67 元、目標價 3429 元、現價 4229.3 元'
      : '等比例新台幣價格軸，成本 2566.67 元、現價 4229.3 元，所選估值資料不足'}>
      <line className="hdvp-axis-floor" x1="28" y1="91" x2="372" y2="91" />
      {ticks.map((tick) => {
        const x = 28 + (tick / 42) * 344;
        const major = tick % 7 === 0;
        return <line key={tick} className={major ? 'hdvp-axis-tick is-major' : 'hdvp-axis-tick'}
          x1={x} y1={major ? 80 : 84} x2={x} y2={major ? 102 : 98}
          style={{ '--tick-delay': `${tick * 11}ms` } as React.CSSProperties} />;
      })}
      <g className="hdvp-axis-marker hdvp-axis-cost" style={{ '--marker-delay': '180ms' } as React.CSSProperties}>
        <line x1={costX} y1="76" x2={costX} y2="35" />
        <path d={`M ${costX - 5} 76 L ${costX} 68 L ${costX + 5} 76 Z`} />
        <text x={costX} y="20">成本</text>
        <text className="hdvp-axis-value" x={costX} y="32">NT$2,566.67</text>
      </g>
      {showTarget && (
        <g className="hdvp-axis-marker hdvp-axis-target" style={{ '--marker-delay': '300ms' } as React.CSSProperties}>
          <line x1={targetX} y1="102" x2={targetX} y2="137" />
          <rect x={targetX - 4} y="87" width="8" height="8" />
          <text x={targetX} y="151">目標</text>
          <text className="hdvp-axis-value" x={targetX} y="164">NT$3,429</text>
        </g>
      )}
      <g className="hdvp-axis-marker hdvp-axis-now" style={{ '--marker-delay': '420ms' } as React.CSSProperties}>
        <line x1={priceX} y1="76" x2={priceX} y2="30" />
        <circle cx={priceX} cy="91" r="5.5" />
        <text x={priceX} y="16">現價</text>
        <text className="hdvp-axis-value" x={priceX} y="29">NT$4,229.3</text>
      </g>
      <text className="hdvp-axis-bound" x="28" y="121">NT$2,400</text>
      <text className="hdvp-axis-bound" x="372" y="121" textAnchor="end">NT$4,500</text>
    </svg>
  );
}

function InstitutionalFlow({ bars }: { bars: boolean }) {
  const max = 3718;
  return (
    <section className="hdvp-section" aria-label="三大法人買賣超">
      <header className="hdvp-section-heading">
        <div><span>三大法人</span><small>{bars ? '由零線讀取方向與幅度' : '買賣超 · 張'}</small></div>
        <time>1／5／20／60 日</time>
      </header>
      {bars ? (
        <div className="hdvp-flow-bars">
          {INSTITUTIONAL.map((row, rowIndex) => (
            <div className={`hdvp-flow-row is-${row.tone}`} key={row.name}>
              <strong><i aria-hidden="true" />{row.name}</strong>
              <div className="hdvp-flow-track">
                <i className="hdvp-flow-zero" />
                {row.values.map((value, index) => {
                  const width = Math.max(2, Math.abs(value) / max * 46);
                  return <span key={`${row.name}-${index}`} className={value >= 0 ? 'is-positive' : 'is-negative'}
                    style={{ '--size': `${width}%`, '--bar-delay': `${(rowIndex * 4 + index) * 45}ms` } as React.CSSProperties}>
                    <b style={{ width: `${width}%` }} />
                    <em>{value > 0 ? '+' : ''}{value}</em>
                  </span>;
                })}
              </div>
            </div>
          ))}
          <div className="hdvp-flow-periods"><span>1日</span><span>5日</span><span>20日</span><span>60日</span></div>
        </div>
      ) : (
        <table className="hdvp-flow-table">
          <thead><tr><th>類別</th><th>1日</th><th>5日</th><th>20日</th><th>60日</th></tr></thead>
          <tbody>{INSTITUTIONAL.map((row) => <tr className={`is-${row.tone}`} key={row.name}><th><i aria-hidden="true" />{row.name}</th>{row.values.map((value, index) => <td key={index}>{value > 0 ? '+' : ''}{value}</td>)}</tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

function PriceSection() {
  const [mode, setMode] = useState<ScaleMode>('target');
  const hasEstimate = mode === 'target';
  return (
    <section className="hdvp-section hdvp-price" aria-label="目標價與估值三尺共用價格軸">
      <header className="hdvp-section-heading">
        <div><span>價格與估值</span><small>新台幣 · 單一等比例軸</small></div>
        <time>LIVE · 2026/10/05</time>
      </header>
      <div className="hdvp-scale-switch" role="group" aria-label="切換估值尺">
        {SCALE_MODES.map((item) => (
          <Button key={item.key} type="button" variant="ghost" size="sm"
            aria-pressed={mode === item.key} onClick={() => setMode(item.key)}>
            {item.label}
          </Button>
        ))}
      </div>
      <div key={mode} className="hdvp-spectrum-transition" data-testid={`unified-spectrum-${mode}`}>
        <LieflatPriceAxis showTarget={hasEstimate} />
        <div className="hdvp-scale-status" aria-live="polite">
          {hasEstimate ? <><strong>目標價 NT$3,429</strong><span>沿用持倉設定</span></> : <><strong>{mode.toUpperCase()} 無法估算</strong><span>缺可核實分母與同期間倍數，價格軸不畫假區間</span></>}
        </div>
      </div>
      <div className="hdvp-yield"><span>現金殖利率</span><span>僅列輔助 · 資料不足</span></div>
    </section>
  );
}

function MarketChart() {
  const bars = useMemo(makeOhlc, []);
  return (
    <section className="hdvp-section hdvp-market" aria-label="30日 K 線與量能">
      <RangeBand WB={WB} price={PRICE} low={3175} high={5345} spark={bars.map((bar) => bar.close)} ohlc={bars}
        va={null} symbol="3443" priceSource="原型固定資料" priceUpdatedAt="2026-10-05T13:40:00+08:00" />
    </section>
  );
}

function Drawer() {
  return (
    <article className="hdvp-drawer" data-testid="drawer-visual-prototype" data-direction="lieflat">
      <header className="hdvp-toolbar"><span>持倉判讀</span><span>LIEFLAT · WIRE</span></header>
      <main>
        <section className="hdvp-identity">
          <div><span>3443 · 半導體業</span><h1>創意</h1><small>持有中 · 成本 NT$2,566.67</small></div>
          <div className="hdvp-return"><span>未實現損益</span><strong>+64.78%</strong><small>+4,988</small></div>
        </section>
        <section className="hdvp-decision"><span>目前觀察</span><strong>續抱，等待量價確認</strong><small>關注程度 · 中</small><i aria-hidden="true" /></section>
        <PriceSection />
        <MarketChart />
        <InstitutionalFlow bars />
        <footer className="hdvp-source">固定原型資料 · 僅比較構圖與動畫語法 · 不改金融計算</footer>
      </main>
    </article>
  );
}

export default function HoldingsDrawerVisualPrototype() {
  return (
    <div className="hdvp-page">
      <Drawer />
    </div>
  );
}