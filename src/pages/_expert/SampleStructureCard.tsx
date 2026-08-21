import { useEffect, useRef } from 'react';
import { SAMPLE_STRUCTURE_FIELDS, SAMPLE_LOCKED_LABEL, SAMPLE_STRUCTURE_NOTE } from '@/lib/complianceCopy';
import { track } from '@/lib/analytics/events';

interface SampleStructureCardProps {
  expertSlug: string;
  utmCampaign?: string;
}

/**
 * 結構樣本：欄位骨架 + 遮蔽塊 + 「訂閱後可見」。
 * 無任何老師原文、無匿名查詢、無假數字。
 */
export function SampleStructureCard({ expertSlug, utmCampaign }: SampleStructureCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !fired.current) {
          fired.current = true;
          track('view_weekly_sample', { expert_slug: expertSlug, utm_campaign: utmCampaign });
          io.disconnect();
        }
      }
    }, { rootMargin: '0px 0px -20% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [expertSlug, utmCampaign]);

  return (
    <div ref={ref} className="evidence-surface rounded-[10px] p-4 md:p-5" data-testid="sample-structure">
      <div className="ev-card p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="ev-title">每週交付內容結構</h3>
          <span className="ev-mute shrink-0">{SAMPLE_LOCKED_LABEL}</span>
        </div>
        <p className="ev-mute mt-2">{SAMPLE_STRUCTURE_NOTE}</p>
        <hr className="ev-rule my-4" />
        <ul className="space-y-3">
          {SAMPLE_STRUCTURE_FIELDS.map((field) => (
            <li key={field}>
              <div className="ev-body" style={{ fontWeight: 600 }}>{field}</div>
              <div className="mt-1.5 space-y-1.5" aria-hidden="true">
                <div className="ev-masked" style={{ width: '92%' }} />
                <div className="ev-masked" style={{ width: '68%' }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
