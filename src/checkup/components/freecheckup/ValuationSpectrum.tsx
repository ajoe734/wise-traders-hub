import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSummaryReveal } from './HoldingsVisualSummary';
import '../../styles/holdingsValuationVisual.css';

export type SpectrumRuler = { key: string; label: string; weightedPremium: number | null; text: string; coverage?: number };
export const formatPremium = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${(Math.sign(v) * Math.round(Math.abs(v * 100) * 10) / 10).toFixed(1)}%`;

/** L7 Brand Spectrum: independent bipolar rows; zero is the peer median, no connecting ribbon between unrelated rulers.
 *  viewBox width follows the rendered width so SVG text stays at real CSS px on phones. */
export default function ValuationSpectrum({ rulers, name }: { rulers: SpectrumRuler[]; name: string }) {
  const { ref, on, replay } = useSummaryReveal();
  const [W, setW] = useState(500);
  useEffect(() => {
    const el = (ref as any).current as HTMLElement | null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w > 0) setW(Math.max(280, Math.min(560, w))); });
    ro.observe(el); return () => ro.disconnect();
  }, [ref]);
  const extent = Math.max(1, ...rulers.map(r => Math.abs(r.weightedPremium ?? 0)));
  const left = W < 400 ? 84 : 120, right = W - 14, mid = (left + right) / 2, half = (right - left) / 2;
  const px = (v: number) => mid + v / extent * half;
  const ticks = [left, (left + mid) / 2, mid, (mid + right) / 2, right];
  return <div ref={ref} className="hv-spectrum-wrap">
    <Button variant="ghost" size="icon" className="hv-replay" aria-label={`重播${name}動畫`} title={`重播${name}動畫`} onClick={replay}><RotateCcw size={13} /></Button>
    <svg className="hv-spectrum" data-on={on ? '1' : '0'} width="100%" viewBox={`0 0 ${W} ${rulers.length * 48 + 38}`} role="img" aria-label={`${name}，零線為同業中位數`} onClick={replay}>
      <text x={left} y="12" fontSize="11" fill="var(--hs-gray-1)">低於同業</text><text x={mid} y="12" textAnchor="middle" fontSize="11" fill="var(--hs-gray-1)">0</text><text x={right} y="12" textAnchor="end" fontSize="11" fill="var(--hs-gray-1)">高於同業</text>
      {rulers.map((r,i) => { const y = 40 + i * 48; return <g key={r.key}>
        <text x="0" y={y + 4} fontSize="12" fontWeight="700" fill="var(--hs-ink)">{r.label}</text>
        <line x1={left} x2={right} y1={y} y2={y} stroke="var(--hs-gray-3)" />
        {ticks.map((x,k) => <line key={k} x1={x} x2={x} y1={y-4} y2={y+4} stroke={k===2 ? 'var(--hs-ink)' : 'var(--hs-gray-3)'} />)}
        {r.weightedPremium !== null && Number.isFinite(r.weightedPremium) && <circle className="hv-point" cx={px(r.weightedPremium)} cy={y} r="5" fill="var(--hs-ink)" style={{transitionDelay:`${i*100}ms`}}><title>{r.label} {formatPremium(r.weightedPremium)} · {r.text}</title></circle>}
      </g>; })}
      <text x={left} y={rulers.length*48+30} fontSize="11" fill="var(--hs-gray-1)">{formatPremium(-extent)}</text><text x={right} y={rulers.length*48+30} textAnchor="end" fontSize="11" fill="var(--hs-gray-1)">{formatPremium(extent)}</text>
    </svg>
  </div>;
}
