/**
 * 持倉看板「已反映程度」清單：尚未反映 → 部分反映 → 已大幅反映 → 無法判斷。
 * 只用文字與字重分級，不用紅綠（紅綠保留給行情漲跌）。
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSummaryReveal } from './HoldingsVisualSummary';
import '../../styles/holdingsValuationVisual.css';
import { usePricedInList, weightByLevel } from './usePricedInList';

const pctW = (w: number | null) => (w == null ? '—' : `${(w * 100).toFixed(1)}%`);

export default function PricedInList({ holdings, WB }: { holdings: any[] | null | undefined; WB: any }) {
  const { items, loading } = usePricedInList(holdings);
  const [open, setOpen] = useState(false);
  const ring = useSummaryReveal();
  if (!items.length) return null;
  const lv = weightByLevel(items);
  const levels = [ ['under', '尚未反映', 'var(--hs-ink)'], ['partial', '部分反映', 'var(--hs-gray-1)'], ['heavy', '已大幅反映', 'var(--hs-accent)'], ['unknown', '無法判斷', 'var(--hs-gray-3)'] ] as const;
  let cursor = 0;
  const segments = levels.map(([key,label,tone]) => { const start = cursor; cursor += lv[key]; return { key,label,tone,start,weight:lv[key] }; });
  return (
    <section className="hs-summary hv-section" data-testid="priced-in-list">
      <header><h2>已反映程度</h2></header>
      <p className="hv-sub">現價 ÷ 站牌下車安全帶 · 近三季＋月營收推估一季{loading ? ' · 計算中…' : ''}</p>
      <div className="hv-composition" ref={ring.ref}>
        <svg className="hv-ring hv-spectrum" data-on={ring.on ? '1' : '0'} viewBox="0 0 180 180" role="img" aria-label="已反映程度持股比例" onClick={ring.replay}>
          {Array.from({length:100},(_,i) => {
            const a = (i/100*360-90)*Math.PI/180;
            const seg = segments.find(s => i/100 >= s.start && i/100 < s.start+s.weight);
            return <g key={i}><line className="hv-point" x1={90+62*Math.cos(a)} y1={90+62*Math.sin(a)} x2={90+(i%10===0?78:73)*Math.cos(a)} y2={90+(i%10===0?78:73)*Math.sin(a)} stroke={seg?.tone || 'var(--hs-line)'} strokeWidth="1.5" style={{transitionDelay:`${i*12}ms`}}><title>{seg ? `${seg.label} ${pctW(seg.weight)}` : '尚未完成判定'}</title></line></g>;
          })}
          <text x="90" y="88" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--hs-ink)">{pctW(cursor)}</text>
          <text x="90" y="107" textAnchor="middle" fontSize="10" fill="var(--hs-gray-1)">已完成判定市值</text>
        </svg>
        <div className="hv-legend" data-testid="priced-in-weight-summary">{segments.map(seg => <div key={seg.key}><span style={{background:seg.tone}} />{seg.label} <b>{pctW(seg.weight)}</b></div>)}</div>
      </div>
      <p className="hv-sub">1 刻度 ≈ 1% 市值 · 精確比例見旁列 · 未完成部分留灰</p>
      <Button variant="ghost" className="hv-toggle" aria-expanded={open} onClick={() => setOpen(v=>!v)}>{open ? '收合個股判定' : `個股判定 · ${items.length} 檔`}</Button>
      {open && <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((i) => (
          <div key={i.code} data-testid={`priced-in-${i.code}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline', minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: WB.ink, minWidth: 96 }}>{i.name} {i.code}</span>
            <span data-testid={`priced-in-weight-${i.code}`} style={{ fontSize: 12, fontWeight: 700, color: WB.ink, minWidth: 48, fontVariantNumeric: 'tabular-nums' }}>持股 {pctW(i.weight)}</span>
            {!i.pricedIn ? <span style={{ fontSize: 11, color: WB.inkMute }}>計算中…</span>
              : i.pricedIn.level === 'unknown' ? <span style={{ fontSize: 11, color: WB.inkSub }}>無法判斷（{i.pricedIn.reason}）</span>
              : <>
                <span style={{ fontSize: 13, fontWeight: i.pricedIn.level === 'heavy' ? 700 : 600, color: i.pricedIn.level === 'heavy' ? WB.accent : WB.ink }}>{i.pricedIn.label}</span>
                <span style={{ fontSize: 12, color: WB.inkSub }}>{Math.round(i.pricedIn.ratioToBelt * 100)}%{i.pricedIn.impliedPercentile != null ? `・隱含倍數落在近一年第 ${Math.round(i.pricedIn.impliedPercentile * 100)}%` : ''}</span>
              </>}
          </div>
        ))}
      </div>
      </div>}
    </section>
  );
}
