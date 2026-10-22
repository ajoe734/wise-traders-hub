import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Summary } from '@/lib/holdingsSummaryViz';
import { summaryGaugeRange } from '../../lib/liveHoldingsSummary';
import '../../styles/holdingsVisualSummary.css';

const money = (n: number) => Math.round(n).toLocaleString('zh-TW');
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;
const percent = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
const shades = ['var(--hs-accent)', 'var(--hs-ink)', 'var(--hs-gray-1)', 'var(--hs-gray-2)', 'var(--hs-gray-3)', 'var(--hs-gray-4)'];

/** obsReveal lifecycle: observe once, replay safely, no overlapping timers. */
export function useSummaryReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [on, setOn] = useState(false);
  const replay = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setOn(true); return; }
    setOn(false);
    timer.current = setTimeout(() => { setOn(true); timer.current = null; }, 60);
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node) return () => { if (timer.current !== null) clearTimeout(timer.current); };
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setOn(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { replay(); observer.disconnect(); }
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => { observer.disconnect(); if (timer.current !== null) clearTimeout(timer.current); };
  }, [replay]);
  return { ref, on, replay };
}

function Replay({ name, onClick }: { name: string; onClick: () => void }) {
  return <Button variant="ghost" size="icon" className="hs-replay" aria-label={`重播${name}動畫`} title={`重播${name}動畫`} onClick={onClick}><RotateCcw size={13} /></Button>;
}

/** Approved D geometry: F11-derived bipolar ticks, L14-derived 100 units, count-dot rows. */
export default function HoldingsVisualSummary({ summary: s, onIndustry, onStrategy, isIndustrySelected, source = '目前持倉', pendingCount = 0 }: {
  summary: Summary; onIndustry?: (name: string) => void; onStrategy?: (name: string) => void;
  isIndustrySelected?: (name: string) => boolean; source?: string; pendingCount?: number;
}) {
  const gauge = useSummaryReveal(), field = useSummaryReveal(), dots = useSummaryReveal();
  const [hover, setHover] = useState<string | null>(null);
  const [tickHover, setTickHover] = useState<number | null>(null);
  const range = summaryGaugeRange(s.pnlPct);
  const lit = Math.round((s.pnlPct + range) / (range * 2) * 30);
  const cells = s.industries.flatMap((r, idx) => Array.from({ length: r.cells }, () => ({ row: r, idx })));
  const active = s.industries.find((r) => r.name === hover) || s.industries[0];
  const groups: [string, [string, number][]][] = [['策略', s.strategy], ['週期', s.period], ['定位', s.position]];
  return <div className="hs-summary" data-testid="holdings-visual-summary" data-cost={s.cost} data-value={s.value} data-count={s.count}>
    <div className="hs-top">
      <section className="hs-section" aria-label="持倉報酬摘要">
        <header><h2>總報酬 {s.cost > 0 ? percent(s.pnlPct) : '—'}</h2><Replay name="報酬刻度" onClick={gauge.replay} /></header>
        <p className="hs-sub">每格 {range / 15}% · 中線 = 損益兩平 · ±{range}%</p>
        <div ref={gauge.ref} data-testid="live-gauge-stage" data-on={gauge.on ? '1' : '0'} className="hs-stage" onClick={gauge.replay}>
          <svg viewBox="0 0 220 134" className="hs-gauge" role="img" aria-label={`總報酬 ${s.cost > 0 ? percent(s.pnlPct) : '尚無可用成本'}，損益 ${signed(s.pnl)}`}>
            {Array.from({ length: 31 }, (_, i) => {
              const a = Math.PI - i / 30 * Math.PI;
              const selected = s.cost > 0 && i !== 15 && i >= Math.min(lit, 15) && i <= Math.max(lit, 15);
              const value = -range + i * range / 15;
              return <g key={i} onMouseEnter={() => setTickHover(value)} onMouseLeave={() => setTickHover(null)}>
                <line x1={110 + 76 * Math.cos(a)} y1={112 - 76 * Math.sin(a)} x2={110 + 108 * Math.cos(a)} y2={112 - 108 * Math.sin(a)} stroke="transparent" strokeWidth={9}><title>{percent(value)}</title></line>
                <line pointerEvents="none" x1={110 + 84 * Math.cos(a)} y1={112 - 84 * Math.sin(a)} x2={110 + (i % 5 === 0 ? 102 : 96) * Math.cos(a)} y2={112 - (i % 5 === 0 ? 102 : 96) * Math.sin(a)} stroke={i === 15 ? 'var(--hs-ink)' : selected ? s.pnl >= 0 ? 'var(--hs-accent)' : 'var(--hs-gray-1)' : 'var(--hs-gray-4)'} strokeWidth={i % 5 === 0 ? 2 : 1.4} strokeLinecap="round" className="hs-tick" style={{ opacity: gauge.on || !selected ? 1 : 0, transitionDelay: `${Math.abs(i - 15) * 40}ms` }} />
              </g>;
            })}
            {tickHover !== null && <text x={110} y={60} fontSize={9} textAnchor="middle" fill="var(--hs-gray-1)">{percent(tickHover)}</text>}
            <text x={110} y={91} fontSize={20} fontWeight={800} textAnchor="middle" fill={s.pnl >= 0 ? 'var(--hs-accent)' : 'var(--hs-ink)'}>{s.cost > 0 ? percent(s.pnlPct) : '—'}</text>
            <text x={110} y={108} fontSize={9} textAnchor="middle" fill="var(--hs-ink)">{signed(s.pnl)} 元</text>
            <text x={8} y={130} fontSize={8} fill="var(--hs-gray-1)">−{range}%</text><text x={212} y={130} fontSize={8} textAnchor="end" fill="var(--hs-gray-1)">+{range}%</text>
          </svg>
        </div>
        <dl className="hs-totals"><div><dt>成本</dt><dd>{money(s.cost)}</dd></div><div><dt>市值</dt><dd>{money(s.value)}</dd></div><div><dt>持股</dt><dd>{s.count} 檔</dd></div></dl>
        {pendingCount > 0 && <p className="hs-sub">{pendingCount} 檔缺價，金額依既有可用持倉統計</p>}
        <p className="hs-source">{source} · 未實現損益</p>
      </section>
      <section className="hs-section" aria-label="產業百格摘要">
        <header><h2>{active ? `${active.name} 佔 ${active.cells} 格` : '產業市值尚無資料'}</h2><Replay name="產業百格" onClick={field.replay} /></header>
        <p className="hs-sub">1 格 ≈ 1% 市值 · 橘 = 最大產業 · 格數取整</p>
        <div className="hs-field-layout">
          <div ref={field.ref} data-testid="live-field-stage" data-on={field.on ? '1' : '0'} className="hs-stage" onClick={field.replay}>
            <svg viewBox="0 0 120 120" className="hs-field" role="img" aria-label="產業市值百格方陣">
              {cells.map(({ row, idx }, i) => <rect key={i} data-industry={row.name} x={i % 10 * 12 + 1} y={Math.floor(i / 10) * 12 + 1} width={10} height={10} rx={2} fill={shades[Math.min(idx, 5)]} onMouseEnter={() => setHover(row.name)} onMouseLeave={() => setHover(null)} className="hs-cell" style={{ opacity: field.on ? hover === null || hover === row.name ? 1 : 0.18 : 0, transform: field.on ? 'scale(1)' : 'scale(.4)', transformOrigin: `${i % 10 * 12 + 6}px ${Math.floor(i / 10) * 12 + 6}px`, transitionDelay: hover === null ? `${i * 9}ms` : '0ms' }}><title>{row.name}：{row.share.toFixed(2)}% · {row.count} 檔 · {money(row.value)} 元</title></rect>)}
              {cells.length === 0 && <text x={60} y={62} fontSize={10} textAnchor="middle" fill="var(--hs-ink)">尚無可用市值</text>}
            </svg>
          </div>
          <div className="hs-legend">{s.industries.map((r, i) => <Button variant="ghost" key={r.name} className="hs-legend-row" data-testid="live-field-legend" aria-label={`${r.name} ${r.share.toFixed(2)}% ${r.count}檔`} aria-pressed={isIndustrySelected?.(r.name) || false} onMouseEnter={() => setHover(r.name)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(r.name)} onBlur={() => setHover(null)} onClick={() => { onIndustry?.(r.name); field.replay(); }} style={{ opacity: hover === null || hover === r.name ? 1 : 0.35 }}>
            <span className="hs-swatch" style={{ background: shades[Math.min(i, 5)] }} /><span className="hs-name">{r.name} <small>{r.count}檔</small></span><b>{r.share.toFixed(1)}%</b>
          </Button>)}</div>
        </div>
        {s.warnings.length > 0 && <p className="hs-warning">↳ 集中提醒：{s.warnings.join('、')}</p>}
        <p className="hs-source">{source} · 產業按市值加權</p>
      </section>
    </div>
    <section className="hs-section hs-count-section" aria-label="持有分類摘要">
      <header><h2>怎麼持有：策略、週期、定位</h2><Replay name="持有分類" onClick={dots.replay} /></header>
      <p className="hs-sub">1 點 = 1 檔 · 黑點 = 該組最多 · 無標籤列為未分類</p>
      <div ref={dots.ref} data-testid="live-count-stage" data-on={dots.on ? '1' : '0'} className="hs-counts" onClick={dots.replay}>
        {groups.map(([label, rows]) => <div key={label}><h3>{label}</h3>{rows.map(([name, count], ri) => <div className="hs-count-row" key={name}>
          {label === '策略' && onStrategy ? <Button variant="ghost" className="hs-count-name" onClick={() => onStrategy(name)}>{name}</Button> : <span className="hs-count-name">{name}</span>}
          <span className="hs-dot-list" aria-hidden="true">{Array.from({ length: count }, (_, i) => <span key={i} className="hs-dot" style={{ background: ri === 0 ? 'var(--hs-ink)' : 'var(--hs-gray-3)', opacity: dots.on ? 1 : 0, transform: dots.on ? 'scale(1)' : 'scale(0)', transitionDelay: `${(ri * 4 + i) * 12}ms` }} />)}</span><b>{count}</b>
        </div>)}</div>)}
      </div><p className="hs-source">{source} · 分類檔數</p>
    </section>
  </div>;
}