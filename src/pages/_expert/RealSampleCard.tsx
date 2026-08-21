import { useEffect, useRef } from 'react';
import { useExpertPublicSample } from '@/hooks/useExpertPublicSample';
import { SampleStructureCard } from '@/pages/_expert/SampleStructureCard';
import {
  REAL_SAMPLE_TITLE, REAL_SAMPLE_NOTE, REAL_SAMPLE_MASK_NOTE, SAMPLE_LOCKED_LABEL,
} from '@/lib/complianceCopy';
import { taipeiWeekRangeLabelMD } from '@/lib/taipeiWeek';
import { track } from '@/lib/analytics/events';

interface RealSampleCardProps {
  expertSlug: string;
  utmCampaign?: string;
}

/**
 * 已核准的過去週記節錄（伺服器端遮罩後的 immutable snapshot）。
 * 沒有已核准範例時，回退為欄位骨架卡（不顯示任何老師原文）。
 */
export function RealSampleCard({ expertSlug, utmCampaign }: RealSampleCardProps) {
  const { data, isLoading } = useExpertPublicSample(expertSlug);
  const ref = useRef<HTMLDivElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !fired.current) {
          fired.current = true;
          track('view_weekly_sample', {
            expert_slug: expertSlug, utm_campaign: utmCampaign, sample_kind: 'real',
          });
          io.disconnect();
        }
      }
    }, { rootMargin: '0px 0px -20% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [data, expertSlug, utmCampaign]);

  if (isLoading) {
    return (
      <div className="evidence-surface rounded-[10px] p-4 md:p-5" data-testid="real-sample-loading">
        <div className="ev-card p-4 md:p-5">
          <h3 className="ev-title">{REAL_SAMPLE_TITLE}</h3>
          <div className="mt-3 space-y-1.5" aria-hidden="true">
            <div className="ev-masked" style={{ width: '88%' }} />
            <div className="ev-masked" style={{ width: '62%' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return <SampleStructureCard expertSlug={expertSlug} utmCampaign={utmCampaign} />;
  }

  return (
    <div
      ref={ref}
      className="evidence-surface rounded-[10px] p-4 md:p-5"
      data-testid="real-sample"
      data-week={data.weekStart}
    >
      <div className="ev-card p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="ev-title">{REAL_SAMPLE_TITLE}</h3>
          <span className="ev-mute shrink-0">{taipeiWeekRangeLabelMD(data.weekStart)}</span>
        </div>
        <p className="ev-mute mt-2">{REAL_SAMPLE_NOTE}</p>
        <hr className="ev-rule my-4" />
        <ul className="space-y-4">
          {data.sections.map((s, i) => (
            <li key={`${s.key}-${i}`}>
              <div className="ev-body" style={{ fontWeight: 600 }}>{s.label}</div>
              <p className="ev-body mt-1.5 whitespace-pre-wrap">
                {s.text}{s.truncated ? '…' : ''}
              </p>
            </li>
          ))}
        </ul>
        <hr className="ev-rule my-4" />
        <div className="flex items-start justify-between gap-3">
          <p className="ev-mute">{REAL_SAMPLE_MASK_NOTE}</p>
          <span className="ev-mute shrink-0">{SAMPLE_LOCKED_LABEL}</span>
        </div>
      </div>
    </div>
  );
}
