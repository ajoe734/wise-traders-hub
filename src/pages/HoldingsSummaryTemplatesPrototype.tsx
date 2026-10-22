/**
 * 持倉看板上方摘要 — 三個 lieflat wire 視覺模板預覽（僅 /e2e harness）。
 * 固定示範資料，不讀任何真實使用者資料；選定前不影響正式持倉看板。
 * A 帳本總覽：F12 Dumbbell + L14 Hundred Field
 * B 權重地圖：F13 Nested Treemap
 * C 一頁儀表：F11 Tick Gauge + F5 Tick Rows
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HoldingsVisualSummary } from '@/checkup/modules/holdings';
import { buildSummary, type DemoHolding, type Summary } from '@/lib/holdingsSummaryViz';

const W = {
  bg: '#F5F3EF', card: '#FBFAF7', ink: '#292520', g1: '#4A4640', g2: '#7A756C',
  g3: '#A8A298', g4: '#CFC9BF', g5: '#E4DFD6', hero: '#EC662D',
};
const FONT = '"Source Serif 4", "Noto Serif TC", serif';

const DEMO: DemoHolding[] = [
  { code: '2330', name: '台積電', industry: '晶圓代工', strategy: '趨勢', period: '中長', position: '核心', cost: 520000, value: 612000 },
  { code: '3443', name: '創意', industry: 'IC 設計', strategy: '趨勢', period: '中', position: '核心', cost: 310000, value: 286000 },
  { code: '2454', name: '聯發科', industry: 'IC 設計', strategy: '價值', period: '中長', position: '核心', cost: 240000, value: 262000 },
  { code: '3017', name: '奇鋐', industry: '散熱', strategy: '題材', period: '短', position: '衛星', cost: 150000, value: 181000 },
  { code: '3324', name: '雙鴻', industry: '散熱', strategy: '題材', period: '短中', position: '衛星', cost: 120000, value: 109000 },
  { code: '2382', name: '廣達', industry: 'AI 伺服器', strategy: '趨勢', period: '中', position: '衛星', cost: 180000, value: 196000 },
  { code: '2881', name: '富邦金', industry: '金融', strategy: '價值', period: '中長', position: '防守', cost: 140000, value: 151000 },
  { code: '0056', name: '元大高股息', industry: 'ETF', strategy: '價值', period: '中長', position: '防守', cost: 100000, value: 98000 },
];

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const pnlColor = (n: number) => (n >= 0 ? W.hero : W.g1);

function useReveal() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setOn(true); return; }
    const t = window.setTimeout(() => setOn(true), 60);
    return () => window.clearTimeout(t);
  }, []);
  return on;
}

/** skill obsReveal：滾入視野（threshold .3）才播；點擊重播；timer 清理；減少動態直接顯示 */
function useObsReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [on, setOn] = useState(false);
  const timer = useRef<number | null>(null);
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const play = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (reduce) { setOn(true); return; }
    setOn(false);
    timer.current = window.setTimeout(() => setOn(true), 60);
  }, [reduce]);
  useEffect(() => {
    const n = ref.current; if (!n) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { play(); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(n);
    return () => { io.disconnect(); if (timer.current) window.clearTimeout(timer.current); };
  }, [play]);
  return { ref, on, replay: play };
}
const ease = 'cubic-bezier(0.165,0.84,0.44,1)'; // quarticOut

function Card({ title, sub, src, children, testid }: { title: string; sub: React.ReactNode; src: string; children: React.ReactNode; testid: string }) {
  return (
    <section data-testid={testid} style={{ background: W.card, borderRadius: 8, padding: '20px 18px 14px', marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: W.ink, margin: 0, lineHeight: 1.4 }}>{title}</h2>
      <div style={{ fontSize: 11, color: W.g2, marginTop: 4, marginBottom: 14, lineHeight: 1.5 }}>{sub}</div>
      {children}
      <div style={{ fontSize: 9, color: W.g3, letterSpacing: '0.12em', marginTop: 12, textTransform: 'uppercase' }}>{src}</div>
    </section>
  );
}

function BigPnl({ s }: { s: Summary }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
      <span className="tn" style={{ fontSize: 22, fontWeight: 700, color: pnlColor(s.pnl) }}>{signed(s.pnl)}</span>
      <span style={{ fontSize: 12, color: pnlColor(s.pnl) }}>{pct(s.pnlPct)}</span>
      <span style={{ fontSize: 11, color: W.g2 }}>{`${s.count} 檔 · 市值 ${fmt(s.value)}`}</span>
    </div>
  );
}

/** 三組計數小點陣（1 點 = 1 檔） */
function CountDots({ s, on }: { s: Summary; on: boolean }) {
  const groups: [string, [string, number][]][] = [['策略', s.strategy], ['週期', s.period], ['定位', s.position]];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))', gap: 12 }}>
      {groups.map(([label, rows]) => (
        <div key={label}>
          <div style={{ fontSize: 10, color: W.g2, letterSpacing: '0.1em', marginBottom: 6 }}>{label}</div>
          {rows.map(([k, n], ri) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: W.ink, minWidth: 36 }}>{k}</span>
              <span style={{ display: 'flex', gap: 3 }}>
                {Array.from({ length: n }).map((_, i) => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: 4, background: ri === 0 ? W.ink : W.g3, opacity: on ? 1 : 0, transform: on ? 'scale(1)' : 'scale(0)', transition: on ? `opacity 300ms ${ease} ${(ri * 4 + i) * 12}ms, transform 360ms ${ease} ${(ri * 4 + i) * 12}ms` : 'none' }} />
                ))}
              </span>
              <span className="tn" style={{ fontSize: 10, color: W.g2 }}>{n}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ═══ A：F12 Dumbbell + L14 Hundred Field ═══
function TemplateA({ s }: { s: Summary }) {
  const on = useReveal();
  const lo = Math.min(s.cost, s.value) * 0.9, hi = Math.max(s.cost, s.value) * 1.05;
  const max = hi;
  const x = (v: number) => 16 + ((v - lo) / (hi - lo)) * 328;
  const cells: { ind: string; idx: number }[] = [];
  s.industries.forEach((r, idx) => { for (let i = 0; i < r.cells; i++) cells.push({ ind: r.name, idx }); });
  return (
    <>
      <Card testid="tpl-a-dumbbell" title={`投入 ${fmt(s.cost)}，現在值 ${fmt(s.value)}`} sub="軸線不從 0 起算 · 空心點 = 總成本 · 實心點 = 總市值 · 兩點距離 = 未實現損益" src="F12 Dumbbell · 示範資料">
        <BigPnl s={s} />
        <svg viewBox="0 0 360 64" width="100%" style={{ marginTop: 10, overflow: 'visible' }} role="img" aria-label="成本到市值">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}><line x1={x(lo + (hi - lo) * t)} x2={x(lo + (hi - lo) * t)} y1={18} y2={46} stroke={W.g5} strokeWidth={0.6} strokeDasharray="2 2" />
              <text x={x(lo + (hi - lo) * t)} y={60} fontSize={7} fill={W.g3} textAnchor="middle">{`${Math.round((lo + (hi - lo) * t) / 10000)}萬`}</text></g>
          ))}
          <line x1={x(s.cost)} x2={on ? x(s.value) : x(s.cost)} y1={32} y2={32} stroke={pnlColor(s.pnl)} strokeWidth={2} style={{ transition: `all 700ms ${ease}` }} />
          <circle cx={x(s.cost)} cy={32} r={5} fill={W.card} stroke={W.ink} strokeWidth={1.2} />
          <circle cx={on ? x(s.value) : x(s.cost)} cy={32} r={5} fill={W.ink} style={{ transition: `all 700ms ${ease}` }} />
          <text x={x(s.cost)} y={14} fontSize={8} fill={W.g2} textAnchor="middle">成本</text>
          <text x={x(s.value)} y={14} fontSize={8} fill={W.ink} textAnchor="middle" fontWeight={700}>市值</text>
        </svg>
      </Card>
      <Card testid="tpl-a-field" title={`${s.industries[0]?.name} 佔了 ${s.industries[0]?.cells} 格`} sub="1 格 = 1% 持股市值 · 橘 = 最大產業 · 灰階深淺 = 佔比排序" src="L14 Hundred Field · 示範資料">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <svg viewBox="0 0 120 120" width={160} style={{ flexShrink: 0 }} role="img" aria-label="產業佔比方陣">
            {cells.map((c, i) => {
              const col = i % 10, row = Math.floor(i / 10);
              const fill = c.idx === 0 ? W.hero : [W.ink, W.g1, W.g2, W.g3, W.g4][Math.min(c.idx - 1, 4)];
              return <rect key={i} x={col * 12 + 1} y={row * 12 + 1} width={10} height={10} rx={2} fill={fill} style={{ opacity: on ? 1 : 0, transition: `opacity 260ms ${ease} ${i * 9}ms` }} />;
            })}
          </svg>
          <div style={{ flex: 1, minWidth: 140 }}>
            {s.industries.map((r, i) => (
              <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: i === 0 ? W.ink : W.g1, fontWeight: i === 0 ? 700 : 400, padding: '3px 0', borderBottom: `0.5px solid ${W.g5}` }}>
                <span>{r.name}<span style={{ color: W.g3, marginLeft: 6 }}>{r.count}檔</span></span><span className="tn">{r.cells}%</span>
              </div>
            ))}
            {s.warnings.length > 0 && <div style={{ fontSize: 10, color: W.g1, marginTop: 8 }}>{`↳ 集中提醒：${s.warnings.join('、')}`}</div>}
          </div>
        </div>
      </Card>
      <Card testid="tpl-a-counts" title="怎麼持有：策略、週期、定位" sub="分段條長度 = 檔數 · 最深段 = 該組最多" src="F7 Stacked Rungs · 示範資料">
        {([['策略', s.strategy], ['週期', s.period], ['定位', s.position]] as [string, [string, number][]][]).map(([label, rows]) => (
          <div key={label} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: W.g2, marginBottom: 4 }}>{label}</div>
            <div style={{ display: 'flex', gap: 2, height: 14 }}>
              {rows.map(([k, n], i) => (
                <div key={k} title={`${k} ${n}`} style={{ flex: on ? n : 0.0001, background: [W.ink, W.g2, W.g3, W.g4][Math.min(i, 3)], borderRadius: 3, transition: `flex 600ms ${ease} ${i * 100}ms`, color: i < 2 ? W.card : W.ink, fontSize: 9, display: 'flex', alignItems: 'center', paddingLeft: 4, overflow: 'hidden', whiteSpace: 'nowrap' }}>{`${k} ${n}`}</div>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}

// ═══ B：F13 Nested Treemap（slice-and-dice，兩層） ═══
type Rect = { x: number; y: number; w: number; h: number };
function slice<T extends { v: number }>(items: T[], r: Rect, horiz: boolean): (T & Rect)[] {
  const total = items.reduce((a, b) => a + b.v, 0) || 1;
  let off = 0;
  return items.map((it) => {
    const f = it.v / total;
    const out = horiz ? { ...it, x: r.x + off, y: r.y, w: r.w * f, h: r.h } : { ...it, x: r.x, y: r.y + off, w: r.w, h: r.h * f };
    off += horiz ? r.w * f : r.h * f;
    return out;
  });
}
function TemplateB({ s }: { s: Summary }) {
  const on = useReveal();
  const [hover, setHover] = useState<string | null>(null);
  const groups = slice(s.tree.map((g) => ({ ...g, v: g.value })), { x: 0, y: 0, w: 360, h: 220 }, true);
  const top = groups[0]?.name;
  return (
    <>
      <Card testid="tpl-b-treemap" title={`${top} 撐起最大一塊`} sub="面積 = 持股市值 · 外框 = 產業 · 格內 = 個股損益 % · 橘框 = 最大產業" src="F13 Nested Treemap · 示範資料">
        <BigPnl s={s} />
        <svg viewBox="0 0 360 220" width="100%" style={{ marginTop: 12 }} role="img" aria-label="產業與個股市值矩形樹圖">
          {groups.map((g, gi) => {
            const inner = { x: g.x + 2, y: g.y + 14, w: Math.max(g.w - 4, 0), h: g.h - 16 };
            const leaves = slice(g.children.map((c) => ({ ...c, v: c.value })), inner, false);
            return (
              <g key={g.name} style={{ opacity: on ? 1 : 0, transition: `opacity 400ms ${ease} ${gi * 110}ms` }}>
                <rect x={g.x + 0.5} y={g.y + 0.5} width={g.w - 1} height={g.h - 1} rx={3} fill="none" stroke={gi === 0 ? W.hero : W.g4} strokeWidth={gi === 0 ? 1.4 : 0.7} />
                {g.w > 52 && <text x={g.x + 4} y={g.y + 10} fontSize={8} fontWeight={700} fill={W.ink}>{g.name}</text>}
                {leaves.map((l) => {
                  const k = `${g.name}/${l.name}`;
                  return (
                    <g key={l.code} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
                      <rect x={l.x + 1} y={l.y + 1} width={Math.max(l.w - 2, 0)} height={Math.max(l.h - 2, 0)} rx={2} fill={hover === k ? W.g4 : W.g5} />
                      {l.w > 36 && l.h > 24 && (<>
                        <text x={l.x + 5} y={l.y + 13} fontSize={8} fill={W.ink}>{l.name}</text>
                        <text x={l.x + 5} y={l.y + 24} fontSize={8} fontWeight={700} fill={pnlColor(l.pct)}>{pct(l.pct)}</text>
                      </>)}
                      <title>{`${g.name} › ${l.name}　市值 ${fmt(l.value)}（${((l.value / s.value) * 100).toFixed(1)}%）　${pct(l.pct)}`}</title>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </Card>
      <Card testid="tpl-b-counts" title="怎麼持有：策略、週期、定位" sub="1 點 = 1 檔 · 黑點 = 該組最多" src="L15 Ballot Tally · 示範資料">
        <CountDots s={s} on={on} />
      </Card>
    </>
  );
}

// ═══ C：F11 Tick Gauge + F5 Tick Rows ═══
function TemplateC({ s }: { s: Summary }) {
  const on = useReveal();
  const range = 30; // ±30%
  const ticks = 31;
  const val = Math.max(-range, Math.min(range, s.pnlPct));
  const lit = Math.round(((val + range) / (2 * range)) * (ticks - 1));
  const mid = (ticks - 1) / 2;
  const rows = s.industries.slice(0, 6);
  const maxPct = Math.max(...rows.map((r) => r.share), 1);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 20 }}>
        <Card testid="tpl-c-gauge" title={`總報酬 ${pct(s.pnlPct)}`} sub="刻度 = 每格 2% · 中線 = 損益兩平 · 範圍 ±30%" src="F11 Tick Gauge · 示範資料">
          <GaugeSvg s={s} on={on} />
          <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 11, color: W.g1 }}>
            <span>成本 <b className="tn">{fmt(s.cost)}</b></span><span>市值 <b className="tn">{fmt(s.value)}</b></span><span><b>{s.count}</b> 檔</span>
          </div>
        </Card>
        <Card testid="tpl-c-rows" title={`${rows[0]?.name} 一個產業就佔 ${rows[0]?.cells}%`} sub="刻度長度 = 市值佔比 · 橘 = 最大產業" src="F5 Tick Rows · 示範資料">
          {rows.map((r, i) => (
            <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '68px 1fr 34px', alignItems: 'center', gap: 6, marginBottom: 7 }}>
              <span style={{ fontSize: 11, color: W.ink, fontWeight: i === 0 ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              <div style={{ position: 'relative', height: 10 }}>
                <div style={{ position: 'absolute', top: 5, left: 0, right: 0, height: 0.5, background: W.g5 }} />
                <div style={{ position: 'absolute', top: 2, left: 0, height: 6, borderRadius: 3, width: on ? `${(r.share / maxPct) * 100}%` : 0, background: i === 0 ? W.hero : W.g1, transition: `width 600ms ${ease} ${i * 100}ms` }} />
              </div>
              <span className="tn" style={{ fontSize: 10, color: W.g1, textAlign: 'right' }}>{`${r.cells}%`}</span>
            </div>
          ))}
          {s.warnings.length > 0 && <div style={{ fontSize: 10, color: W.g1, marginTop: 4 }}>{`↳ 集中提醒：${s.warnings.join('、')}`}</div>}
        </Card>
      </div>
      <Card testid="tpl-c-counts" title="怎麼持有：策略、週期、定位" sub="1 點 = 1 檔 · 黑點 = 該組最多" src="L15 Ballot Tally · 示範資料">
        <CountDots s={s} on={on} />
      </Card>
    </>
  );
}


// ═══ 重組用積木：F11 刻度半環 / L14 百格方陣 / L15 點陣計數 ═══
function GaugeSvg({ s, on, width = '100%', hover }: { s: Summary; on: boolean; width?: number | string; hover?: boolean }) {
  const [hv, setHv] = useState<number | null>(null);
  const range = 30, ticks = 31, mid = (ticks - 1) / 2;
  const val = Math.max(-range, Math.min(range, s.pnlPct));
  const lit = Math.round(((val + range) / (2 * range)) * (ticks - 1));
  return (
    <svg viewBox="0 0 220 124" width={width} role="img" aria-label="總報酬率刻度" style={{ display: 'block', margin: '0 auto' }}>
      {Array.from({ length: ticks }).map((_, i) => {
        const a = Math.PI - (i / (ticks - 1)) * Math.PI;
        const r1 = 84, r2 = i % 5 === 0 ? 102 : 96;
        const inRange = i >= Math.min(lit, mid) && i <= Math.max(lit, mid) && i !== mid;
        const tv = -range + i * 2;
        return <g key={i}>{hover && <line x1={110 + 76 * Math.cos(a)} y1={112 - 76 * Math.sin(a)} x2={110 + 108 * Math.cos(a)} y2={112 - 108 * Math.sin(a)} stroke="transparent" strokeWidth={9} onMouseEnter={() => setHv(tv)} onMouseLeave={() => setHv(null)} />}<line pointerEvents="none" x1={110 + r1 * Math.cos(a)} y1={112 - r1 * Math.sin(a)} x2={110 + r2 * Math.cos(a)} y2={112 - r2 * Math.sin(a)} stroke={i === mid ? W.ink : inRange ? pnlColor(s.pnlPct) : W.g4} strokeWidth={i % 5 === 0 ? 2 : 1.4} strokeLinecap="round" style={{ opacity: on || !inRange ? 1 : 0, transition: on ? `opacity 200ms ${ease} ${Math.abs(i - mid) * 40}ms` : 'none' }} /></g>;
      })}
      {hv != null && <text x={110} y={60} fontSize={8} fill={W.g2} textAnchor="middle">{`刻度 ${hv >= 0 ? '+' : ''}${hv}%`}</text>}
      <text x={110} y={92} fontSize={20} fontWeight={800} fill={pnlColor(s.pnl)} textAnchor="middle">{pct(s.pnlPct)}</text>
      <text x={110} y={108} fontSize={8} fill={W.g2} textAnchor="middle">{`${signed(s.pnl)} 元`}</text>
      <text x={16} y={122} fontSize={7} fill={W.g3}>-30%</text><text x={204} y={122} fontSize={7} fill={W.g3} textAnchor="end">+30%</text>
    </svg>
  );
}
function Totals({ s }: { s: Summary }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8, flexWrap: 'wrap', fontSize: 11, color: W.g1, marginTop: 6 }}>
      <span>成本 <b className="tn">{fmt(s.cost)}</b></span><span>市值 <b className="tn">{fmt(s.value)}</b></span><span><b>{s.count}</b> 檔</span>
    </div>
  );
}
function FieldGrid({ s, on, size = 160, hi = null, onHi }: { s: Summary; on: boolean; size?: number; hi?: number | null; onHi?: (i: number | null) => void }) {
  const cells: number[] = [];
  s.industries.forEach((r, idx) => { for (let i = 0; i < r.cells; i++) cells.push(idx); });
  return (
    <svg viewBox="0 0 120 120" width={size} style={{ flexShrink: 0, display: 'block' }} role="img" aria-label="產業佔比方陣">
      {cells.map((idx, i) => (
        <rect key={i} x={(i % 10) * 12 + 1} y={Math.floor(i / 10) * 12 + 1} width={10} height={10} rx={2} fill={idx === 0 ? W.hero : [W.ink, W.g1, W.g2, W.g3, W.g4][Math.min(idx - 1, 4)]} onMouseEnter={onHi ? () => onHi(idx) : undefined} onMouseLeave={onHi ? () => onHi(null) : undefined} style={{ opacity: on ? (hi == null || hi === idx ? 1 : 0.18) : 0, transform: on ? 'scale(1)' : 'scale(0.4)', transformOrigin: `${(i % 10) * 12 + 6}px ${Math.floor(i / 10) * 12 + 6}px`, transition: !on ? 'none' : `opacity 160ms ${ease} ${hi == null ? i * 9 : 0}ms, transform 360ms ${ease} ${i * 9}ms` }}><title>{`${s.industries[idx].name} ${s.industries[idx].cells}%`}</title></rect>
      ))}
    </svg>
  );
}
function FieldLegend({ s, compact, hi = null, onHi }: { s: Summary; compact?: boolean; hi?: number | null; onHi?: (i: number | null) => void }) {
  const sw = (i: number) => (i === 0 ? W.hero : [W.ink, W.g1, W.g2, W.g3, W.g4][Math.min(i - 1, 4)]);
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      {s.industries.map((r, i) => (
        <div key={r.name} data-testid="field-legend-row" onMouseEnter={onHi ? () => onHi(i) : undefined} onMouseLeave={onHi ? () => onHi(null) : undefined} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: i === 0 ? W.ink : W.g1, fontWeight: i === 0 ? 700 : 400, padding: compact ? '2px 0' : '3px 0', borderBottom: `0.5px solid ${W.g5}`, opacity: hi == null || hi === i ? 1 : 0.35, transition: 'opacity 160ms', cursor: onHi ? 'default' : undefined }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: sw(i), flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{r.name}<span style={{ color: W.g3, marginLeft: 6, fontWeight: 400 }}>{r.count}檔</span></span><span className="tn">{r.cells}%</span>
        </div>
      ))}
      {s.warnings.length > 0 && <div style={{ fontSize: 10, color: W.g1, marginTop: 8 }}>{`↳ 集中提醒：${s.warnings.join('、')}`}</div>}
    </div>
  );
}
const lbl = { fontSize: 10, color: W.g2, letterSpacing: '0.12em', marginBottom: 8 } as const;

// ═══ D 並肩：半環＋方陣同列，點陣在下 ═══
function TemplateD({ s }: { s: Summary }) {
  const g = useObsReveal<HTMLDivElement>();
  const f = useObsReveal<HTMLDivElement>();
  const c = useObsReveal<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const hint = <span style={{ color: W.g3 }}> · 點圖重播</span>;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20 }}>
        <Card testid="tpl-d-gauge" title={`總報酬 ${pct(s.pnlPct)}`} sub={<>刻度 = 每格 2% · 中線 = 損益兩平 · 範圍 ±30%{hint}</>} src="F11 Tick Gauge · 示範資料">
          <div ref={g.ref} data-testid="d-gauge-stage" data-on={g.on ? '1' : '0'} onClick={g.replay} style={{ cursor: 'pointer' }}><GaugeSvg s={s} on={g.on} hover /></div><Totals s={s} />
        </Card>
        <Card testid="tpl-d-field" title={hi == null ? `${s.industries[0]?.name} 佔了 ${s.industries[0]?.cells} 格` : `${s.industries[hi].name} 佔 ${s.industries[hi].cells} 格 · ${s.industries[hi].count} 檔`} sub={<>1 格 = 1% 持股市值 · 橘 = 最大產業 · 滑過格子或清單同步標示{hint}</>} src="L14 Hundred Field · 示範資料">
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div ref={f.ref} data-testid="d-field-stage" data-on={f.on ? '1' : '0'} onClick={f.replay} style={{ cursor: 'pointer' }}><FieldGrid s={s} on={f.on} size={130} hi={hi} onHi={setHi} /></div>
            <FieldLegend s={s} compact hi={hi} onHi={setHi} />
          </div>
        </Card>
      </div>
      <Card testid="tpl-d-counts" title="怎麼持有：策略、週期、定位" sub={<>1 點 = 1 檔 · 黑點 = 該組最多{hint}</>} src="L15 Ballot Tally · 示範資料">
        <div ref={c.ref} data-on={c.on ? '1' : '0'} onClick={c.replay} style={{ cursor: 'pointer' }}><CountDots s={s} on={c.on} /></div>
      </Card>
    </>
  );
}

// ═══ E 一卡三欄：損益｜產業｜持有方式，全部收進一張 ═══
function TemplateE({ s }: { s: Summary }) {
  const on = useReveal();
  return (
    <Card testid="tpl-e-panel" title={`總報酬 ${pct(s.pnlPct)}，${s.industries[0]?.name} 佔 ${s.industries[0]?.cells}%`} sub="左：刻度每格 2% · 中：1 格 = 1% 市值，橘 = 最大產業 · 右：1 點 = 1 檔" src="F11 · L14 · L15 · 示範資料">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 20, alignItems: 'start' }}>
        <div><div style={lbl}>損益</div><GaugeSvg s={s} on={on} /><Totals s={s} /></div>
        <div><div style={lbl}>產業佔比</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><FieldGrid s={s} on={on} size={96} />
            <div style={{ flex: 1 }}>{s.industries.slice(0, 4).map((r, i) => (<div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: i === 0 ? W.ink : W.g1, fontWeight: i === 0 ? 700 : 400, padding: '2px 0' }}><span>{r.name}</span><span className="tn">{r.cells}%</span></div>))}
              {s.industries.length > 4 && <div style={{ fontSize: 10, color: W.g3 }}>{`其他 ${s.industries.slice(4).reduce((a, r) => a + r.cells, 0)}%`}</div>}</div>
          </div>
          {s.warnings.length > 0 && <div style={{ fontSize: 10, color: W.g1, marginTop: 8 }}>{`↳ 集中：${s.warnings.join('、')}`}</div>}
        </div>
        <div><div style={lbl}>持有方式</div><div style={{ display: 'grid', gap: 10 }}><CountDots s={s} on={on} /></div></div>
      </div>
    </Card>
  );
}

// ═══ F 直式敘事：半環置頂當主角，方陣與點陣依序展開 ═══
function TemplateF({ s }: { s: Summary }) {
  const on = useReveal();
  return (
    <Card testid="tpl-f-story" title={`這批持股目前 ${s.pnl >= 0 ? '賺' : '賠'} ${fmt(Math.abs(s.pnl))} 元`} sub="由上而下：賺多少 → 錢放在哪 → 怎麼持有" src="F11 · L14 · L15 · 示範資料">
      <div style={{ maxWidth: 360, margin: '0 auto' }}><GaugeSvg s={s} on={on} /><Totals s={s} /></div>
      <div style={{ borderTop: `0.5px solid ${W.g4}`, margin: '18px 0 14px' }} />
      <div style={lbl}>{`錢放在哪 · ${s.industries[0]?.name} 佔 ${s.industries[0]?.cells} 格`}</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}><FieldGrid s={s} on={on} size={150} /><FieldLegend s={s} /></div>
      <div style={{ borderTop: `0.5px solid ${W.g4}`, margin: '18px 0 14px' }} />
      <div style={lbl}>怎麼持有 · 1 點 = 1 檔</div>
      <CountDots s={s} on={on} />
    </Card>
  );
}

const TEMPLATES = {
  a: { label: 'A 帳本總覽', C: TemplateA },
  b: { label: 'B 權重地圖', C: TemplateB },
  c: { label: 'C 一頁儀表', C: TemplateC },
  d: { label: 'D 並肩', C: ({ s }: { s: Summary }) => <HoldingsVisualSummary summary={s} source="示範持倉" /> },
  e: { label: 'E 一卡三欄', C: TemplateE },
  f: { label: 'F 直式敘事', C: TemplateF },
} as const;
type Key = keyof typeof TEMPLATES;

export default function HoldingsSummaryTemplatesPrototype() {
  const s = useMemo(() => buildSummary(DEMO), []);
  const initial = (() => {
    const v = new URLSearchParams(window.location.search).get('v')?.toLowerCase() || 'a';
    return (['a', 'b', 'c', 'd', 'e', 'f'] as Key[]).find((k) => v.startsWith(k)) || 'a';
  })();
  const [cur, setCur] = useState<Key>(initial);
  const pick = (k: Key) => {
    setCur(k);
    const u = new URL(window.location.href); u.searchParams.set('v', k);
    window.history.replaceState(null, '', u.toString());
  };
  const T = TEMPLATES[cur].C;
  return (
    <div data-testid="holdings-summary-templates" style={{ background: W.bg, minHeight: '100vh', fontFamily: FONT, color: W.ink }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 48px' }}>
        <div style={{ fontSize: 11, color: W.g2, letterSpacing: '0.12em' }}>持倉看板 · 上方摘要 · 視覺模板預覽（示範資料）</div>
        <div role="tablist" style={{ display: 'flex', gap: 8, margin: '12px 0 20px', flexWrap: 'wrap' }}>
          {(Object.keys(TEMPLATES) as Key[]).map((k) => (
            <button key={k} role="tab" aria-selected={cur === k} onClick={() => pick(k)} style={{ fontFamily: FONT, fontSize: 13, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: cur === k ? W.ink : W.g2, border: `1px solid ${cur === k ? W.ink : W.g4}`, fontWeight: cur === k ? 700 : 400 }}>{TEMPLATES[k].label}</button>
          ))}
        </div>
        <T key={cur} s={s} />
      </div>
    </div>
  );
}
