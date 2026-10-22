/**
 * 估值站牌三模板試看（Preview-only fixture）。
 * 站牌價位取自使用者截圖；現價／成本為示範值，不代表正式報價。
 */
import { useEffect, useRef, useState } from 'react';

const C = { ink: '#292520', sub: '#5a5148', mute: '#9a9088', light: '#c9c2b8', hair: '#e6e1d8', paper: '#F5F3EF', accent: '#EC662D' };
const AXIS = { lo: 200.99, hi: 1165.16 };
const PRICE = 560; // 示範
const COST = 480; // 示範
type Mark = { key: string; label: string; short: string; v: number; group: 'hist' | 'fwd' | 'peer'; dashed?: boolean };
const MARKS: Mark[] = [
  { key: 'peer', label: '同業參考', short: '同業', v: 211.57, group: 'peer' },
  { key: 'fl', label: '前瞻低（P20）', short: '前瞻低', v: 380.17, group: 'fwd' },
  { key: 'p20', label: '上車站', short: '上車', v: 396.89, group: 'hist' },
  { key: 'stress', label: '壓力測試', short: '壓測', v: 575.54, group: 'fwd', dashed: true },
  { key: 'fm', label: '前瞻參考（歷史倍數）', short: '前瞻', v: 719.42, group: 'fwd' },
  { key: 'p50', label: '下車安全帶', short: '安全帶', v: 751.05, group: 'hist' },
  { key: 'fh', label: '前瞻高（P80）', short: '前瞻高', v: 1062.93, group: 'fwd' },
  { key: 'p80', label: '高壓站', short: '高壓', v: 1109.67, group: 'hist' },
];
const fmt = (v: number) => `NT$${v.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function useReveal() {
  const [k, setK] = useState(0);
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setOn(true); return; }
    setOn(false);
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { requestAnimationFrame(() => setOn(true)); io.disconnect(); } });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [k]);
  return { ref, on, replay: () => setK((x) => x + 1), k };
}

const tr = (on: boolean, i: number) => ({ transition: `all 520ms cubic-bezier(.165,.84,.44,1) ${i * 90}ms`, opacity: on ? 1 : 0 });

/** A｜L7 站牌刻度尺 */
function TemplateA({ sel, setSel }) {
  const [ref, w] = useWidth();
  const rv = useReveal();
  const pad = 14, h = 118, y = 58;
  const x = (v: number) => pad + ((v - AXIS.lo) / (AXIS.hi - AXIS.lo)) * (w - pad * 2);
  // 交錯上下 + 同側最小間距
  const placed: { m: Mark; up: boolean; lx: number }[] = [];
  MARKS.forEach((m, i) => {
    const up = i % 2 === 0;
    let lx = x(m.v);
    const prev = [...placed].reverse().find((p) => p.up === up);
    if (prev && lx - prev.lx < 44) lx = prev.lx + 44;
    placed.push({ m, up, lx: Math.min(lx, w - pad - 16) });
  });
  return (
    <div ref={(el) => { (ref as any).current = el; (rv.ref as any).current = el; }} onClick={rv.replay} key={rv.k}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="估值站牌刻度尺">
        <line x1={pad} x2={w - pad} y1={y} y2={y} stroke={C.ink} strokeWidth={1} />
        {placed.map(({ m, up, lx }, i) => {
          const mx = x(m.v), hist = m.group === 'hist';
          const active = sel === m.key;
          return <g key={m.key} style={tr(rv.on, i)} onClick={(e) => { e.stopPropagation(); setSel(active ? null : m.key); }} cursor="pointer">
            <line x1={mx} x2={mx} y1={y - (hist ? 9 : 6)} y2={y + (hist ? 9 : 6)} stroke={hist ? C.ink : C.sub} strokeWidth={hist ? 1.6 : 1} strokeDasharray={m.dashed ? '2 2' : undefined} />
            <line x1={mx} x2={lx} y1={up ? y - 10 : y + 10} y2={up ? y - 22 : y + 22} stroke={C.light} strokeWidth={0.6} />
            <text x={lx} y={up ? y - 36 : y + 34} textAnchor="middle" fontSize={11} fontWeight={hist ? 700 : 500} fill={active ? C.accent : hist ? C.ink : C.sub}>{m.short}</text>
            <text x={lx} y={up ? y - 24 : y + 46} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={C.ink} style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(m.v)}</text>
          </g>;
        })}
        <circle cx={x(COST)} cy={y} r={4.5} fill={C.paper} stroke={C.ink} strokeWidth={1.2} style={tr(rv.on, 9)} />
        <circle cx={x(PRICE)} cy={y} r={6} fill={C.accent} style={tr(rv.on, 10)} />
      </svg>
    </div>
  );
}

/** B｜F12 三列啞鈴 */
function TemplateB({ sel, setSel }) {
  const [ref, w] = useWidth();
  const rv = useReveal();
  const lw = 56, pad = 14, rowH = 40, h = rowH * 3 + 28;
  const x = (v: number) => lw + ((v - AXIS.lo) / (AXIS.hi - AXIS.lo)) * (w - lw - pad);
  const rows: { name: string; group: Mark['group'] }[] = [{ name: '歷史站牌', group: 'hist' }, { name: '前瞻', group: 'fwd' }, { name: '同業', group: 'peer' }];
  return (
    <div ref={(el) => { (ref as any).current = el; (rv.ref as any).current = el; }} onClick={rv.replay} key={rv.k}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="估值三列啞鈴">
        {rows.map((r, ri) => {
          const ms = MARKS.filter((m) => m.group === r.group && !m.dashed);
          const cy = 18 + ri * rowH + rowH / 2;
          const lo = Math.min(...ms.map((m) => m.v)), hi = Math.max(...ms.map((m) => m.v));
          return <g key={r.name}>
            <text x={0} y={cy + 4} fontSize={12} fontWeight={700} fill={C.ink}>{r.name}</text>
            <line x1={lw} x2={w - pad} y1={cy} y2={cy} stroke={C.hair} strokeWidth={0.6} />
            {ms.length > 1 && <line x1={x(lo)} x2={rv.on ? x(hi) : x(lo)} y1={cy} y2={cy} stroke={C.light} strokeWidth={4} strokeLinecap="round" style={{ transition: `x2 600ms cubic-bezier(.165,.84,.44,1) ${ri * 120}ms` }} />}
            {MARKS.filter((m) => m.group === r.group).map((m, i) => {
              const active = sel === m.key;
              return <g key={m.key} style={tr(rv.on, ri * 3 + i)} cursor="pointer" onClick={(e) => { e.stopPropagation(); setSel(active ? null : m.key); }}>
                <circle cx={x(m.v)} cy={cy} r={m.dashed ? 4 : 5} fill={m.dashed ? C.paper : C.ink} stroke={C.ink} strokeWidth={1} strokeDasharray={m.dashed ? '2 1.5' : undefined} />
                <text x={x(m.v)} y={cy - 9} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={active ? C.accent : C.ink} style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(m.v)}</text>
                <text x={x(m.v)} y={cy + 17} textAnchor="middle" fontSize={10} fill={C.sub}>{m.short}</text>
              </g>;
            })}
          </g>;
        })}
        <line x1={x(PRICE)} x2={x(PRICE)} y1={12} y2={h - 12} stroke={C.accent} strokeWidth={1.4} style={tr(rv.on, 10)} />
        <text x={x(PRICE)} y={h - 2} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.accent}>現價 {PRICE}</text>
      </svg>
    </div>
  );
}

/** C｜F5 刻度橫條 */
function TemplateC({ sel, setSel }) {
  const [ref, w] = useWidth();
  const rv = useReveal();
  const lw = 72, nw = 46, rowH = 20, h = MARKS.length * rowH + 22;
  const x = (v: number) => lw + ((v - AXIS.lo) / (AXIS.hi - AXIS.lo)) * (w - lw - nw);
  return (
    <div ref={(el) => { (ref as any).current = el; (rv.ref as any).current = el; }} onClick={rv.replay} key={rv.k}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="估值刻度橫條">
        {MARKS.map((m, i) => {
          const cy = 8 + i * rowH + rowH / 2, hist = m.group === 'hist', active = sel === m.key;
          return <g key={m.key} cursor="pointer" onClick={(e) => { e.stopPropagation(); setSel(active ? null : m.key); }}>
            <text x={0} y={cy + 4} fontSize={11.5} fontWeight={hist ? 700 : 500} fill={active ? C.accent : hist ? C.ink : C.sub}>{m.short}</text>
            <line x1={lw} x2={rv.on ? x(m.v) : lw} y1={cy} y2={cy} stroke={hist ? C.ink : C.light} strokeWidth={hist ? 3 : 2} strokeLinecap="round" strokeDasharray={m.dashed ? '3 3' : undefined} style={{ transition: `x2 560ms cubic-bezier(.165,.84,.44,1) ${i * 90}ms` }} />
            <text x={x(m.v) + 6} y={cy + 4} fontSize={11} fontWeight={700} fill={C.ink} style={{ fontVariantNumeric: 'tabular-nums', ...tr(rv.on, i) }}>{Math.round(m.v)}</text>
          </g>;
        })}
        <line x1={x(PRICE)} x2={x(PRICE)} y1={4} y2={h - 14} stroke={C.accent} strokeWidth={1.4} />
        <text x={x(PRICE)} y={h - 2} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.accent}>現價 {PRICE}</text>
      </svg>
    </div>
  );
}

const VARIANTS = { a: { t: 'A｜站牌刻度尺', C: TemplateA }, b: { t: 'B｜三列啞鈴', C: TemplateB }, c: { t: 'C｜刻度橫條', C: TemplateC } };

export default function ValuationStationsTemplatesHarness() {
  const v = (new URLSearchParams(window.location.search).get('v') || 'all').toLowerCase();
  const keys = v in VARIANTS ? [v] : Object.keys(VARIANTS);
  const [sel, setSel] = useState<string | null>(null);
  const picked = MARKS.find((m) => m.key === sel);
  return (
    <main style={{ background: C.paper, minHeight: '100vh', padding: '20px 16px', color: C.ink, fontFamily: "'Noto Sans TC', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>估值站牌模板試看</h1>
        <p style={{ fontSize: 12, color: C.sub, margin: '0 0 16px' }}>站牌價位取自截圖；現價 {PRICE}／成本 {COST} 為示範值 · 點圖重播 · 點價位看完整名稱</p>
        {keys.map((k) => { const { t, C: T } = VARIANTS[k]; return (
          <section key={k} data-testid={`stations-template-${k}`} style={{ borderTop: `1px solid ${C.ink}`, padding: '12px 0 16px' }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>{t}</h2>
            <T sel={sel} setSel={setSel} />
          </section>
        ); })}
        <div aria-live="polite" style={{ fontSize: 13, minHeight: 20, color: C.ink, fontWeight: 700 }}>{picked ? `${picked.label} ${fmt(picked.v)}` : ''}</div>
      </div>
    </main>
  );
}
