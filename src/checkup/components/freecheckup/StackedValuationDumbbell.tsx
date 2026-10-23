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
      : { key, name: RULER_NAME[key], main: key === mainKey, missing: '資料不足' };
  });
  if (forward?.status === 'ready' && ok(forward.price)) {
    rows.push(forward.mode === 'historical' && ok(forward.low) && ok(forward.high)
      ? { key: 'forward', name: '前瞻參考', lo: forward.low, mid: forward.price, hi: forward.high }
      : { key: 'forward', name: '前瞻參考', lo: forward.price, mid: forward.price, hi: forward.price, single: true });
  } else rows.push({ key: 'forward', name: '前瞻參考', missing: '資料不足' });
  if (peer?.status === 'ready' && ok(peer.price)) rows.push({ key: 'peer', name: '同業平均', lo: peer.price, mid: peer.price, hi: peer.price, single: true });
  else rows.push({ key: 'peer', name: '同業平均', missing: '資料不足' });
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
    const ro = new ResizeObserver(([e]) => setW(Math.max(180, Math.round(e.contentRect.width))));
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

  // 軸以三把尺＋前瞻＋現價為核心；同業／成本／目標若遠在外側，釘在邊緣並照寫數字，不壓扁主圖
  const coreVals = [price, ...rows.filter((r) => r.key !== 'peer').flatMap((r) => (ready(r) ? [r.lo, r.hi] : []))].filter(ok) as number[];
  const c0 = Math.min(...coreVals), c1 = Math.max(...coreVals), cSpan = Math.max(c1 - c0, c1 * 0.05);
  const reach = { lo: c0 - cSpan * 0.6, hi: c1 + cSpan * 0.6 };
  const extra = [cost, target, custom?.low, custom?.high, ...rows.filter((r) => r.key === 'peer').flatMap((r) => (ready(r) ? [r.mid] : []))].filter(ok) as number[];
  const vals = [...coreVals, ...extra.map((v) => Math.min(Math.max(v, reach.lo), reach.hi))];
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), span = Math.max(hi0 - lo0, hi0 * 0.05);
  const dom = { lo: lo0 - span * 0.06, hi: hi0 + span * 0.06 };
  const lw = 62, pad = 28, rowH = 36, top = 10;
  const h = top + rows.length * rowH + 12;
  const x = (v: number) => lw + ((Math.min(Math.max(v, dom.lo), dom.hi) - dom.lo) / (dom.hi - dom.lo)) * (w - lw - pad);
  const outside = (v: number) => v < dom.lo || v > dom.hi;
  const ease = 'cubic-bezier(.165,.84,.44,1)';
  const fade = (i: number) => ({ transition: `opacity 520ms ${ease} ${i * 90}ms`, opacity: on ? 1 : 0 });
  const selRow = rows.find((r) => r.key === sel);
  const showCost = ok(cost), showTarget = ok(target);
  const markers = [
    ...(ok(price) ? [{ key: 'price', symbol: '│', name: '現', value: price }] : []),
    ...(typeof cost === 'number' && showCost ? [{ key: 'cost', symbol: '○', name: '成本', value: cost }] : []),
    ...(typeof target === 'number' && showTarget ? [{ key: 'target', symbol: '▽', name: '目標', value: target }] : []),
  ];

  return (
    <div data-testid="valuation-dumbbell" ref={ref} style={{ minWidth: 0, margin: '4px 0 6px' }}>
      <div className="grid grid-cols-3 gap-2 text-xs mb-1" style={{ color: WB.ink, fontVariantNumeric: 'tabular-nums' }}>
        {markers.map((m) => <div key={m.key} data-testid={`dumbbell-legend-${m.key}`} className="min-w-0" style={{ color: m.key === 'price' ? WB.accent : WB.ink }}>
          <span title={m.key === 'price' ? '現價' : m.key === 'target' ? '目標價' : '成本'}>{m.symbol} {m.name}</span>
          <strong className="block font-bold break-all">{n0(m.value)}</strong>
        </div>)}
      </div>
      <svg key={k} width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="估值疊列啞鈴" onClick={() => setK((v) => v + 1)} style={{ display: 'block', cursor: 'pointer' }}>
        {rows.map((r, i) => {
          const cy = top + i * rowH + rowH / 2 + 4;
          const ink = r.main ? WB.ink : WB.inkSub, active = sel === r.key;
          const cu = custom && custom.key === r.key && ok(custom.low) && ok(custom.high) ? custom : null;
          return <g key={r.key} data-testid={`dumbbell-row-${r.key}`} data-status={ready(r) ? 'ready' : 'missing'}
            onClick={(e) => { e.stopPropagation(); setSel(active ? null : r.key); }}>
            <rect x={0} y={cy - rowH / 2} width={w} height={rowH} fill="transparent" />
            <text x={0} y={cy + 4} fontSize={12} fontWeight={r.main ? 800 : 600} fill={ink}>{['pe', 'pb', 'ps'].includes(r.key) ? r.key.toUpperCase() : r.key === 'forward' ? '前瞻' : '同業'}</text>
            {r.main && <path d={`M35,${cy - 4} L40,${cy} L35,${cy + 4} Z`} fill={WB.ink}><title>主尺</title></path>}
            <line x1={lw} x2={w - pad} y1={cy} y2={cy} stroke={WB.hair} strokeWidth={0.6} />
            {!ready(r) ? <text x={lw + 4} y={cy + 4} fontSize={11} fill={WB.inkMute}>資料不足</text> : <>
              {!r.single && <line x1={x(r.lo)} x2={on ? x(r.hi) : x(r.lo)} y1={cy} y2={cy} stroke={r.main ? WB.ink : WB.inkLight} strokeWidth={r.main ? 4 : 3} strokeLinecap="round" style={{ transition: `x2 600ms ${ease} ${i * 110}ms` }} />}
              {cu && <line data-testid="dumbbell-custom" x1={x(cu.low)} x2={x(cu.high)} y1={cy + 7} y2={cy + 7} stroke={WB.accent} strokeWidth={1.4} strokeDasharray="3 3" style={fade(i)} />}
              {(r.single ? [r.mid] : [r.lo, r.mid, r.hi]).map((v, j) => {
                const big = r.single || j === 1;
                return <g key={j} style={fade(i * 2 + j)}>
                  <circle cx={x(v)} cy={cy} r={big ? 5 : 3.5} fill={big ? ink : 'var(--background)'} stroke={ink} strokeWidth={1.2} />
                  {(() => {
                    // 端點離中點太近就移到線下、向外對齊，避免數字互壓
                    // 每列只標中點；兩端完整價格保留在點選明細，避免窄螢幕疊字。
                    if (!big) return null;
                    return <text x={Math.min(Math.max(x(v), lw + 24), w - pad)} y={cy - 9} textAnchor={x(v) > w - pad - 24 ? 'end' : 'middle'} fontSize={10.5} fontWeight={700} fill={ink} style={{ fontVariantNumeric: 'tabular-nums' }}>{outside(v) ? (v > dom.hi ? `${n0(v)} ›` : `‹ ${n0(v)}`) : n0(v)}</text>;
                  })()}
                </g>;
              })}
            </>}
          </g>;
        })}
        {typeof target === 'number' && showTarget && <g data-testid="dumbbell-target" style={fade(10)}>
          <title>目標價 {n0(target)}</title>
          <path d={`M${x(target) - 4},3 L${x(target) + 4},3 L${x(target)},9 Z`} fill={WB.inkSub} />
        </g>}
        {typeof cost === 'number' && showCost && <g data-testid="dumbbell-cost" style={fade(11)}>
          <title>成本 {n0(cost)}</title>
          <circle cx={x(cost)} cy={h - 4} r={3.5} fill="var(--background)" stroke={WB.ink} strokeWidth={1.2} />
        </g>}
        {ok(price) && <g data-testid="dumbbell-price" style={fade(12)}>
          <title>現價 {n0(price)}</title>
          <line x1={x(price)} x2={x(price)} y1={12} y2={h - 16} stroke={WB.accent} strokeWidth={1.4} />
        </g>}
      </svg>
      {selRow && <div data-testid="dumbbell-selected" className="break-words" style={{ fontSize: 12, color: WB.ink, fontVariantNumeric: 'tabular-nums' }}>
        <strong>{selRow.name}</strong>{' '}
        {ready(selRow) ? (selRow.single ? `NT$${n0(selRow.mid)}` : `便宜 NT$${n0(selRow.lo)}／中間 NT$${n0(selRow.mid)}／偏熱 NT$${n0(selRow.hi)}`) : '資料不足'}
      </div>}
    </div>
  );
}
