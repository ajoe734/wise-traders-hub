/**
 * 抽屜估值 D 版：疊列啞鈴（lieflat F12）。PE／PB／PS、前瞻、同業共用一條 NT$ 軸，
 * 橘線貫穿標現價。只投影既有結果（selectedRulerBand／buildDrawerStations／自訂情境），不另算。
 */
import { useEffect, useRef, useState } from 'react';

export type DumbbellRow =
  | { key: string; name: string; main?: boolean; lo: number; mid: number; hi: number; single?: boolean }
  | { key: string; name: string; main?: boolean; missing: string };

const RULER_NAME = { pe: 'PE 本益比', pb: 'PB 淨值比', ps: 'PS 營收比' };
const ok = (n) => Number.isFinite(n) && n > 0;

/** 純函式：把既有估值結果排成列；無值的列只標「資料不足」，不畫假區間。 */
export function buildDumbbellRows({ mainKey, rulerOf, forward, peer }): DumbbellRow[] {
  const order = [mainKey, ...['ps', 'pe', 'pb'].filter((k) => k !== mainKey)];
  const rows: DumbbellRow[] = order.map((key) => {
    const r = rulerOf(key);
    return r && ok(r.low) && ok(r.mid) && ok(r.high)
      ? { key, name: RULER_NAME[key], main: key === mainKey, lo: r.low, mid: r.mid, hi: r.high }
      : { key, name: RULER_NAME[key], main: key === mainKey, missing: r?.reason ? String(r.reason) : '資料不足' };
  });
  if (forward?.status === 'ready' && ok(forward.price)) {
    rows.push(forward.mode === 'historical' && ok(forward.low) && ok(forward.high)
      ? { key: 'forward', name: '前瞻參考', lo: forward.low, mid: forward.price, hi: forward.high }
      : { key: 'forward', name: '前瞻參考', lo: forward.price, mid: forward.price, hi: forward.price, single: true });
  } else rows.push({ key: 'forward', name: '前瞻參考', missing: forward?.reason ? String(forward.reason) : '資料不足' });
  if (peer?.status === 'ready' && ok(peer.price)) rows.push({ key: 'peer', name: '同業平均', lo: peer.price, mid: peer.price, hi: peer.price, single: true });
  else rows.push({ key: 'peer', name: '同業平均', missing: peer?.reason ? String(peer.reason) : '資料不足' });
  return rows;
}

const ready = (r: DumbbellRow): r is Extract<DumbbellRow, { lo: number }> => 'lo' in r;
const n0 = (v) => Math.round(v).toLocaleString('zh-TW');

export function StackedValuationDumbbell({ WB, rows, price, cost, target, custom = null }: {
  WB: any; rows: DumbbellRow[]; price: number; cost?: number | null; target?: number | null;
  custom?: { key: string; low: number; high: number } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [k, setK] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setOn(true); return; }
    setOn(false);
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { requestAnimationFrame(() => setOn(true)); io.disconnect(); } });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [k]);

  const vals = [price, cost, target, custom?.low, custom?.high, ...rows.flatMap((r) => (ready(r) ? [r.lo, r.hi] : []))].filter(ok) as number[];
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), span = Math.max(hi0 - lo0, hi0 * 0.05);
  const dom = { lo: lo0 - span * 0.06, hi: hi0 + span * 0.06 };
  const lw = 76, pad = 18, rowH = 36, top = 18;
  const h = top + rows.length * rowH + 30;
  const x = (v: number) => lw + ((v - dom.lo) / (dom.hi - dom.lo)) * (w - lw - pad);
  const ease = 'cubic-bezier(.165,.84,.44,1)';
  const fade = (i: number) => ({ transition: `opacity 520ms ${ease} ${i * 90}ms`, opacity: on ? 1 : 0 });
  const selRow = rows.find((r) => r.key === sel);
  const showCost = ok(cost), showTarget = ok(target);
  // 成本與目標標籤太近時，各自往外側對齊
  const near = showCost && showTarget && Math.abs(x(cost!) - x(target!)) < 76;
  const costLeft = near && cost! <= target!;
  const lbl = (v: number, left: boolean) => (near ? { x: x(v) + (left ? 4 : -4), anchor: left ? 'end' : 'start' } : { x: x(v), anchor: 'middle' });

  return (
    <div data-testid="valuation-dumbbell" ref={ref} style={{ minWidth: 0, margin: '4px 0 6px' }}>
      <svg key={k} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="估值疊列啞鈴" onClick={() => setK((v) => v + 1)} style={{ display: 'block', cursor: 'pointer' }}>
        {rows.map((r, i) => {
          const cy = top + i * rowH + rowH / 2 + 4;
          const ink = r.main ? WB.ink : WB.inkSub, active = sel === r.key;
          const cu = custom && custom.key === r.key && ok(custom.low) && ok(custom.high) ? custom : null;
          return <g key={r.key} data-testid={`dumbbell-row-${r.key}`} data-status={ready(r) ? 'ready' : 'missing'}
            onClick={(e) => { e.stopPropagation(); setSel(active ? null : r.key); }}>
            <rect x={0} y={cy - rowH / 2} width={w} height={rowH} fill="transparent" />
            <text x={0} y={cy + 4} fontSize={12} fontWeight={r.main ? 800 : 600} fill={active ? WB.accent : ink}>{r.name}</text>
            {r.main && <text x={0} y={cy - 10} fontSize={10} fontWeight={700} fill={WB.accent}>主尺</text>}
            <line x1={lw} x2={w - pad} y1={cy} y2={cy} stroke={WB.hair} strokeWidth={0.6} />
            {!ready(r) ? <text x={lw + 4} y={cy + 4} fontSize={11} fill={WB.inkMute}>資料不足</text> : <>
              {!r.single && <line x1={x(r.lo)} x2={on ? x(r.hi) : x(r.lo)} y1={cy} y2={cy} stroke={r.main ? WB.ink : WB.inkLight} strokeWidth={r.main ? 4 : 3} strokeLinecap="round" style={{ transition: `x2 600ms ${ease} ${i * 110}ms` }} />}
              {cu && <line data-testid="dumbbell-custom" x1={x(cu.low)} x2={x(cu.high)} y1={cy + 7} y2={cy + 7} stroke={WB.accent} strokeWidth={1.4} strokeDasharray="3 3" style={fade(i)} />}
              {(r.single ? [r.mid] : [r.lo, r.mid, r.hi]).map((v, j) => {
                const big = r.single || j === 1;
                return <g key={j} style={fade(i * 2 + j)}>
                  <circle cx={x(v)} cy={cy} r={big ? 5 : 3.5} fill={big ? ink : WB.surface || '#F5F3EF'} stroke={ink} strokeWidth={1.2} />
                  {(() => {
                    // 端點離中點太近就移到線下、向外對齊，避免數字互壓
                    const tight = !r.single && j !== 1 && Math.abs(x(v) - x(r.mid)) < 40;
                    const anchor = tight ? (j === 0 ? 'end' : 'start') : 'middle';
                    const tx = tight ? x(v) + (j === 0 ? 2 : -2) : x(v);
                    return <text x={tx} y={tight ? cy + 15 : cy - 8} textAnchor={anchor} fontSize={10.5} fontWeight={700} fill={ink} style={{ fontVariantNumeric: 'tabular-nums' }}>{n0(v)}</text>;
                  })()}
                </g>;
              })}
            </>}
          </g>;
        })}
        {showTarget && <g data-testid="dumbbell-target" style={fade(10)}>
          <path d={`M${x(target!) - 5},${h - 24} L${x(target!) + 5},${h - 24} L${x(target!)},${h - 17} Z`} fill={WB.inkSub} />
          <text x={lbl(target!, !costLeft).x} y={h - 4} textAnchor={lbl(target!, !costLeft).anchor as any} fontSize={10.5} fill={WB.inkSub}>目標 {n0(target!)}</text>
        </g>}
        {showCost && <g style={fade(11)}>
          <circle cx={x(cost!)} cy={h - 20} r={4} fill={WB.surface || '#F5F3EF'} stroke={WB.ink} strokeWidth={1.2} />
          <text x={lbl(cost!, costLeft).x} y={h - 4} textAnchor={lbl(cost!, costLeft).anchor as any} fontSize={10.5} fill={WB.ink}>成本 {n0(cost!)}</text>
        </g>}
        {ok(price) && <g data-testid="dumbbell-price" style={fade(12)}>
          <line x1={x(price)} x2={x(price)} y1={12} y2={h - 16} stroke={WB.accent} strokeWidth={1.4} />
          <text x={Math.min(Math.max(x(price), lw + 24), w - 30)} y={10} textAnchor="middle" fontSize={11} fontWeight={800} fill={WB.accent}>現價 {n0(price)}</text>
        </g>}
      </svg>
      {selRow && <div data-testid="dumbbell-selected" style={{ fontSize: 12, color: WB.ink, fontVariantNumeric: 'tabular-nums' }}>
        <strong>{selRow.name}</strong>{' '}
        {ready(selRow) ? (selRow.single ? `NT$${n0(selRow.mid)}` : `便宜 NT$${n0(selRow.lo)}／中間 NT$${n0(selRow.mid)}／偏熱 NT$${n0(selRow.hi)}`) : `資料不足（${selRow.missing}）`}
      </div>}
    </div>
  );
}
