import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSummaryReveal } from './HoldingsVisualSummary';
import '../../styles/holdingsValuationVisual.css';

export type SpectrumRuler = { key: string; label: string; weightedPremium: number | null; text: string; coverage?: number };
export const formatPremium = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${(Math.sign(v) * Math.round(Math.abs(v * 100) * 10) / 10).toFixed(1)}%`;

/** L7 Brand Spectrum: independent bipolar rows; zero is the peer median, no connecting ribbon between unrelated rulers. */
export default function ValuationSpectrum({ rulers, name }: { rulers: SpectrumRuler[]; name: string }) {
  const { ref, on, replay } = useSummaryReveal();
  const extent = Math.max(1, ...rulers.map(r => Math.abs(r.weightedPremium ?? 0)));
  const px = (v: number) => 210 + v / extent * 158;
  return <div ref={ref}>
    <Button variant="ghost" size="icon" aria-label={`重播${name}動畫`} title={`重播${name}動畫`} onClick={replay}><RotateCcw size={13} /></Button>
    <svg className="hv-spectrum" data-on={on ? '1' : '0'} viewBox={`0 0 420 ${rulers.length * 48 + 38}`} role="img" aria-label={`${name}，零線為同業中位數`} onClick={replay}>
      <text x="52" y="12" fontSize="10" fill="var(--hs-gray-1)">低於同業</text><text x="210" y="12" textAnchor="middle" fontSize="10" fill="var(--hs-gray-1)">0</text><text x="368" y="12" textAnchor="end" fontSize="10" fill="var(--hs-gray-1)">高於同業</text>
      {rulers.map((r,i) => { const y = 40 + i * 48; return <g key={r.key}>
        <text x="10" y={y + 4} fontSize="10" fontWeight="700" fill="var(--hs-ink)">{r.label}</text>
        <line x1="52" x2="368" y1={y} y2={y} stroke="var(--hs-gray-3)" />
        {[52,131,210,289,368].map(x => <line key={x} x1={x} x2={x} y1={y-4} y2={y+4} stroke={x===210 ? 'var(--hs-ink)' : 'var(--hs-gray-3)'} />)}
        {r.weightedPremium !== null && Number.isFinite(r.weightedPremium) && <circle className="hv-point" cx={px(r.weightedPremium)} cy={y} r="5" fill="var(--hs-ink)" style={{transitionDelay:`${i*100}ms`}}><title>{r.label} {formatPremium(r.weightedPremium)} · {r.text}</title></circle>}
      </g>; })}
      <text x="52" y={rulers.length*48+30} fontSize="9" fill="var(--hs-gray-1)">{formatPremium(-extent)}</text><text x="368" y={rulers.length*48+30} textAnchor="end" fontSize="9" fill="var(--hs-gray-1)">{formatPremium(extent)}</text>
    </svg>
  </div>;
}