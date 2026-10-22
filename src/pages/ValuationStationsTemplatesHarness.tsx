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
  const rows: { name: string; group: Mark['group'] }[] = [{ name: '過去一年行情', group: 'hist' }, { name: '前瞻', group: 'fwd' }, { name: '同業', group: 'peer' }];
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

/* ── 合併版：三把尺＋同業＋前瞻共用一條軸（PS 為主尺取截圖值；PE／PB 為示範） ── */
type Rule = { key: string; name: string; main?: boolean; lo: number; mid: number; hi: number } | { key: string; name: string; missing: string };
const RULERS: Rule[] = [
  { key: 'ps', name: 'PS 營收比', main: true, lo: 396.89, mid: 751.05, hi: 1109.67 },
  { key: 'pe', name: 'PE 本益比', lo: 330, mid: 520, hi: 780 },
  { key: 'pb', name: 'PB 淨值比', missing: '分母未核實' },
];
const PEER = 211.57;
const FWD = { lo: 380.17, mid: 719.42, hi: 1062.93 };
const TARGET = 900;
const pct = (lo: number, hi: number) => Math.round(((PRICE - lo) / (hi - lo)) * 100);
const ready = (r: Rule): r is Extract<Rule, { lo: number }> => 'lo' in r;

/** D｜疊列啞鈴 */
function TemplateD({ sel, setSel }) {
  const [ref, w] = useWidth();
  const rv = useReveal();
  const lw = 74, pad = 16, rowH = 34, rows = [...RULERS, { key: 'fwd', name: '前瞻參考', ...FWD }, { key: 'peer', name: '同業平均', lo: PEER, mid: PEER, hi: PEER }] as Rule[];
  const h = rows.length * rowH + 34;
  const x = (v: number) => lw + ((v - AXIS.lo) / (AXIS.hi - AXIS.lo)) * (w - lw - pad);
  return (
    <div ref={(el) => { (ref as any).current = el; (rv.ref as any).current = el; }} onClick={rv.replay} key={rv.k}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="估值疊列啞鈴">
        {rows.map((r, i) => {
          const cy = 14 + i * rowH + rowH / 2;
          const main = ready(r) && r.main, ink = main ? C.ink : C.sub, active = sel === r.key;
          return <g key={r.key} cursor="pointer" onClick={(e) => { e.stopPropagation(); setSel(active ? null : r.key); }}>
            <text x={0} y={cy + 4} fontSize={12} fontWeight={main ? 800 : 600} fill={active ? C.accent : ink}>{r.name}</text>
            {main && <text x={0} y={cy + 16} fontSize={10} fontWeight={700} fill={C.accent}>主尺</text>}
            <line x1={lw} x2={w - pad} y1={cy} y2={cy} stroke={C.hair} strokeWidth={0.6} />
            {!ready(r) ? <text x={lw + 4} y={cy + 4} fontSize={11} fill={C.mute}>資料不足（{r.missing}）</text> : <>
              {r.hi > r.lo && <line x1={x(r.lo)} x2={rv.on ? x(r.hi) : x(r.lo)} y1={cy} y2={cy} stroke={main ? C.ink : C.light} strokeWidth={main ? 4 : 3} strokeLinecap="round" style={{ transition: `x2 600ms cubic-bezier(.165,.84,.44,1) ${i * 110}ms` }} />}
              {(r.hi > r.lo ? [r.lo, r.mid, r.hi] : [r.mid]).map((v, j) => <g key={j} style={tr(rv.on, i * 2 + j)}>
                <circle cx={x(v)} cy={cy} r={j === 1 || r.hi === r.lo ? 5 : 3.5} fill={j === 1 || r.hi === r.lo ? ink : C.paper} stroke={ink} strokeWidth={1.2} />
                <text x={x(v)} y={cy - 8} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={ink} style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(v)}</text>
              </g>)}
            </>}
          </g>;
        })}
        <path d={`M${x(TARGET) - 5},${h - 26} L${x(TARGET) + 5},${h - 26} L${x(TARGET)},${h - 19} Z`} fill={C.sub} />
        <text x={x(TARGET)} y={h - 6} textAnchor="middle" fontSize={10.5} fill={C.sub}>目標 {TARGET}</text>
        <circle cx={x(COST)} cy={h - 22} r={4} fill={C.paper} stroke={C.ink} strokeWidth={1.2} />
        <text x={x(COST)} y={h - 6} textAnchor="middle" fontSize={10.5} fill={C.ink}>成本 {COST}</text>
        <line x1={x(PRICE)} x2={x(PRICE)} y1={8} y2={h - 18} stroke={C.accent} strokeWidth={1.4} style={tr(rv.on, 12)} />
        <text x={x(PRICE)} y={10} textAnchor="middle" fontSize={11} fontWeight={800} fill={C.accent}>現價 {PRICE}</text>
      </svg>
    </div>
  );
}

/** E｜單軸色帶 */
function TemplateE({ sel, setSel }) {
  const [ref, w] = useWidth();
  const rv = useReveal();
  const pad = 16, y = 72, h = 150;
  const x = (v: number) => pad + ((v - AXIS.lo) / (AXIS.hi - AXIS.lo)) * (w - pad * 2);
  const m = RULERS[0] as Extract<Rule, { lo: number }>;
  const seg = [[AXIS.lo, m.lo, C.hair, '便宜'], [m.lo, m.mid, C.light, '合理'], [m.mid, m.hi, C.mute, '偏熱'], [m.hi, AXIS.hi, C.sub, '過熱']] as const;
  const pins = [
    ...RULERS.slice(1).filter(ready).map((r) => ({ key: r.key, s: r.name.slice(0, 2) + '中', v: r.mid })),
    { key: 'fwd', s: '前瞻', v: FWD.mid }, { key: 'peer', s: '同業', v: PEER }, { key: 'target', s: '目標', v: TARGET },
  ];
  return (
    <div ref={(el) => { (ref as any).current = el; (rv.ref as any).current = el; }} onClick={rv.replay} key={rv.k}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="估值單軸色帶">
        <text x={pad} y={14} fontSize={11} fontWeight={700} fill={C.ink}>主尺 PS 近一年</text>
        {seg.map(([a, b, c, t], i) => <g key={t} style={tr(rv.on, i)}>
          <rect x={x(a)} y={y - 8} width={Math.max(0, x(b) - x(a))} height={16} fill={c} />
          <text x={(x(a) + x(b)) / 2} y={y + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={i >= 2 ? C.paper : C.ink}>{t}</text>
        </g>)}
        {[m.lo, m.mid, m.hi].map((v, i) => <text key={i} x={x(v)} y={y + 22} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={C.ink} style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(v)}</text>)}
        {pins.map((p, i) => { const up = i % 2 === 0, active = sel === p.key; return <g key={p.key} cursor="pointer" style={tr(rv.on, 4 + i)} onClick={(e) => { e.stopPropagation(); setSel(active ? null : p.key); }}>
          <line x1={x(p.v)} x2={x(p.v)} y1={up ? y - 10 : y + 26} y2={up ? y - 22 : y + 36} stroke={C.sub} strokeWidth={1} />
          <text x={x(p.v)} y={up ? y - 34 : y + 48} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={active ? C.accent : C.sub}>{p.s}</text>
          <text x={x(p.v)} y={up ? y - 24 : y + 60} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={C.ink}>{Math.round(p.v)}</text>
        </g>; })}
        <line x1={x(PRICE)} x2={x(PRICE)} y1={y - 14} y2={y + 12} stroke={C.accent} strokeWidth={2.4} style={tr(rv.on, 10)} />
        <text x={x(PRICE)} y={y - 46} textAnchor="middle" fontSize={11} fontWeight={800} fill={C.accent}>現價 {PRICE}</text>
        <text x={pad} y={h - 4} fontSize={10.5} fill={C.mute}>PB 資料不足 · 成本 {COST}</text>
      </svg>
    </div>
  );
}

/** F｜刻度橫條對照 */
function TemplateF({ sel, setSel }) {
  const [ref, w] = useWidth();
  const rv = useReveal();
  const rows = [...RULERS, { key: 'fwd', name: '前瞻參考', ...FWD }] as Rule[];
  const lw = 74, nw = 54, rowH = 46, h = rows.length * rowH + 30;
  const bx0 = lw, bx1 = w - nw;
  return (
    <div ref={(el) => { (ref as any).current = el; (rv.ref as any).current = el; }} onClick={rv.replay} key={rv.k}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="估值刻度橫條對照">
        {rows.map((r, i) => {
          const cy = 8 + i * rowH + 20, main = ready(r) && r.main, ink = main ? C.ink : C.sub, active = sel === r.key;
          return <g key={r.key} cursor="pointer" onClick={(e) => { e.stopPropagation(); setSel(active ? null : r.key); }}>
            <text x={0} y={cy + 4} fontSize={12} fontWeight={main ? 800 : 600} fill={active ? C.accent : ink}>{r.name}</text>
            {!ready(r) ? <text x={bx0} y={cy + 4} fontSize={11} fill={C.mute}>資料不足（{r.missing}）</text> : (() => {
              const p = Math.max(0, Math.min(100, pct(r.lo, r.hi))), px = bx0 + (bx1 - bx0) * p / 100;
              return <>
                {Array.from({ length: 11 }, (_, k) => <line key={k} x1={bx0 + (bx1 - bx0) * k / 10} x2={bx0 + (bx1 - bx0) * k / 10} y1={cy - 5} y2={cy + 5} stroke={C.light} strokeWidth={0.7} />)}
                <line x1={bx0} x2={rv.on ? px : bx0} y1={cy} y2={cy} stroke={main ? C.ink : C.mute} strokeWidth={4} strokeLinecap="round" style={{ transition: `x2 600ms cubic-bezier(.165,.84,.44,1) ${i * 110}ms` }} />
                <circle cx={rv.on ? px : bx0} cy={cy} r={5} fill={C.accent} style={{ transition: `cx 600ms cubic-bezier(.165,.84,.44,1) ${i * 110}ms` }} />
                <text x={bx1 + 6} y={cy + 4} fontSize={12} fontWeight={800} fill={C.accent}>第{p}%</text>
                <text x={bx0} y={cy + 19} fontSize={10.5} fill={C.sub} style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(r.lo)}</text>
                <text x={(bx0 + bx1) / 2} y={cy + 19} textAnchor="middle" fontSize={10.5} fill={C.sub}>{Math.round(r.mid)}</text>
                <text x={bx1} y={cy + 19} textAnchor="end" fontSize={10.5} fill={C.sub}>{Math.round(r.hi)}</text>
              </>;
            })()}
          </g>;
        })}
        <text x={0} y={h - 6} fontSize={11} fill={C.sub}>現價 <tspan fill={C.accent} fontWeight={800}>{PRICE}</tspan> · 同業平均 {Math.round(PEER)} · 目標 {TARGET} · 成本 {COST}</text>
      </svg>
    </div>
  );
}

const VARIANTS = {
  a: { t: 'A｜站牌刻度尺', C: TemplateA }, b: { t: 'B｜三列啞鈴', C: TemplateB }, c: { t: 'C｜刻度橫條', C: TemplateC },
  d: { t: 'D｜合併・疊列啞鈴', C: TemplateD }, e: { t: 'E｜合併・單軸色帶', C: TemplateE }, f: { t: 'F｜合併・刻度橫條對照', C: TemplateF },
};
const SEL_LABEL: Record<string, string> = { ps: 'PS 營收比 397／751／1,110', pe: 'PE 本益比 330／520／780（示範）', pb: 'PB 淨值比 資料不足', fwd: '前瞻參考 380／719／1,063', peer: '同業平均 NT$212', target: '分析師目標 NT$900（示範）' };

export default function ValuationStationsTemplatesHarness() {
  const init = (new URLSearchParams(window.location.search).get('v') || 'merged').toLowerCase();
  const [v, setV] = useState(init in VARIANTS || init === 'all' ? init : 'merged');
  const keys = v in VARIANTS ? [v] : v === 'merged' ? ['d', 'e', 'f'] : Object.keys(VARIANTS);
  const tabs = [['merged', '合併三版'], ['d', 'D 疊列'], ['e', 'E 色帶'], ['f', 'F 對照'], ['all', '全部'], ['a', 'A'], ['b', 'B'], ['c', 'C']];
  const [sel, setSel] = useState<string | null>(null);
  const picked = MARKS.find((m) => m.key === sel);
  return (
    <main style={{ background: C.paper, minHeight: '100vh', padding: '20px 16px', color: C.ink, fontFamily: "'Noto Sans TC', system-ui, sans-serif" }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>估值站牌模板試看</h1>
        <p style={{ fontSize: 12, color: C.sub, margin: '0 0 16px' }}>站牌價位取自截圖；現價 {PRICE}／成本 {COST} 為示範值 · 點圖重播 · 點價位看完整名稱</p>
        <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {tabs.map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={v === k} data-testid={`stations-tab-${k}`} onClick={() => setV(k)}
            style={{ fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.ink}`, background: v === k ? C.ink : 'transparent', color: v === k ? C.paper : C.ink }}>{t}</button>)}
        </div>
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
