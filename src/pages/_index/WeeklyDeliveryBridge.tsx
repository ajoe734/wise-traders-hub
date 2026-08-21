import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { EvidenceCard } from '@/components/evidence/EvidenceCard';
import { DELIVERY_STRUCTURE, FUNNEL_ONE_LINER, DISCLAIMER_TEACHING } from '@/lib/complianceCopy';

/**
 * 首頁最小橋接：把「每週交付結構」講清楚，導向 /experts。
 * 只用 complianceCopy 靜態字串，不查任何資料。
 */
export function WeeklyDeliveryBridge() {
  return (
    <section className="container py-12 md:py-16" aria-label="每週交付">
      <div className="max-w-3xl">
        <h2 className="text-h3 md:text-h2 mb-3">每週固定交付，不是零散喊單</h2>
        <p className="text-muted-foreground leading-relaxed">{FUNNEL_ONE_LINER}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3 mt-6">
        {DELIVERY_STRUCTURE.map((d) => (
          <EvidenceCard key={d.key} title={d.title} description={d.desc} />
        ))}
      </div>
      <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Button size="lg" className="w-full sm:w-auto" asChild>
          <Link to="/experts">看看有哪些老師<ArrowRight className="h-4 w-4 ml-2" /></Link>
        </Button>
        <span className="text-xs text-muted-foreground">{DISCLAIMER_TEACHING}</span>
      </div>
    </section>
  );
}
