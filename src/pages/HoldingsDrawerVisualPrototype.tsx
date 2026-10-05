import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PriceSpectrum } from '@/checkup/components/freecheckup/PriceSpectrum';
import { RangeBand } from '@/checkup/components/freecheckup/HoldingsDetailPanel';
import { WB } from '@/pages/_freeCheckup/constants.jsx';
import './holdingsDrawerVisualPrototype.css';

type Direction = 'research' | 'price' | 'balanced';

const DIRECTIONS: Array<{ key: Direction; label: string; note: string }> = [
  { key: 'research', label: 'A 研究手稿', note: '估值證據優先' },
  { key: 'price', label: 'B 價格先行', note: '價格位置優先' },
  { key: 'balanced', label: 'C 平衡判讀', note: '維持現行節奏' },
];

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
  { name: '外資', values: [-84, 88, -980, -3481] },
  { name: '投信', values: [19, 79, 107, 3718] },
  { name: '自營商', values: [5, -49, -199, -1239] },
];

type ScaleMode = 'target' | 'pe' | 'pb' | 'ps';

const SCALE_MODES: Array<{ key: ScaleMode; label: string }> = [
  { key: 'target', label: '目標價' },
  { key: 'pe', label: 'PE' },
  { key: 'pb', label: 'PB' },
  { key: 'ps', label: 'PS' },
];

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
            <div className="hdvp-flow-row" key={row.name}>
              <strong>{row.name}</strong>
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
          <tbody>{INSTITUTIONAL.map((row) => <tr key={row.name}><th>{row.name}</th>{row.values.map((value, index) => <td key={index} className={value >= 0 ? 'is-positive' : 'is-negative'}>{value > 0 ? '+' : ''}{value}</td>)}</tr>)}</tbody>
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
        <PriceSpectrum WB={WB} price={PRICE} cost={COST} target={hasEstimate ? TARGET : null} />
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

function Drawer({ direction }: { direction: Direction }) {
  const research = direction === 'research';
  return (
    <article className={`hdvp-drawer hdvp-${direction}`} data-testid="drawer-visual-prototype" data-direction={direction}>
      <header className="hdvp-toolbar"><span>持倉判讀</span><span>{DIRECTIONS.find((item) => item.key === direction)?.label}</span></header>
      <main>
        <section className="hdvp-identity">
          <div><span>3443 · 半導體業 · 持有中</span><h1>創意</h1></div>
          <div className="hdvp-return"><strong>+64.78%</strong><span>+4,988</span></div>
        </section>
        <section className="hdvp-decision"><span>目前觀察</span><strong>續抱，等待量價確認</strong><small>關注程度 · 中</small></section>
        <PriceSection />
        <MarketChart />
        <InstitutionalFlow bars={!research} />
        <footer className="hdvp-source">固定原型資料 · 僅比較構圖與動畫語法 · 不改金融計算</footer>
      </main>
    </article>
  );
}

export default function HoldingsDrawerVisualPrototype() {
  const [params] = useSearchParams();
  const raw = params.get('direction');
  const direction: Direction = raw === 'research' || raw === 'price' || raw === 'balanced' ? raw : 'research';
  return (
    <div className="hdvp-page">
      <nav aria-label="預覽方向" className="hdvp-switcher">
        {DIRECTIONS.map((item) => <Link key={item.key} to={`?direction=${item.key}`} aria-current={direction === item.key ? 'page' : undefined}><strong>{item.label}</strong><span>{item.note}</span></Link>)}
      </nav>
      <Drawer direction={direction} />
    </div>
  );
}