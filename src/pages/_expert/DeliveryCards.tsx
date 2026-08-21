import { useEffect, useRef } from 'react';
import { EvidenceCard } from '@/components/evidence/EvidenceCard';
import { WeekTimelineItem } from '@/components/evidence/WeekTimelineItem';
import { StatusChip } from '@/components/evidence/StatusChip';
import { DELIVERY_STRUCTURE, DISCLAIMER_TEACHING } from '@/lib/complianceCopy';
import { track } from '@/lib/analytics/events';

interface DeliveryCardsProps {
  expertSlug: string;
  /** cadence 句；由父層以 `cadenceLabel(assetClass)` 產生。 */
  cadence: string;
  utmCampaign?: string;
}

/**
 * 「會員每週會得到的結構」三卡 + 節奏時間軸。
 * 全部字串來自 `complianceCopy`，不含任何老師實際內容、標的或成果。
 */
export function DeliveryCards({ expertSlug, cadence, utmCampaign }: DeliveryCardsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !fired.current) {
          fired.current = true;
          track('expert_delivery_section_view', { expert_slug: expertSlug, utm_campaign: utmCampaign });
          io.disconnect();
        }
      }
    }, { rootMargin: '0px 0px -20% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [expertSlug, utmCampaign]);

  return (
    <div ref={ref} className="space-y-4" data-testid="delivery-cards">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={cadence} tone="active" />
        <StatusChip label={DISCLAIMER_TEACHING} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {DELIVERY_STRUCTURE.map((d) => (
          <EvidenceCard key={d.key} title={d.title} description={d.desc} />
        ))}
      </div>

      <div className="evidence-surface rounded-[10px] p-4 md:p-5">
        <div className="ev-card p-4 md:p-5">
          <div className="ev-title mb-3">每週的順序</div>
          {DELIVERY_STRUCTURE.map((d, i) => (
            <WeekTimelineItem
              key={d.key}
              title={d.title}
              desc={d.desc}
              last={i === DELIVERY_STRUCTURE.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
