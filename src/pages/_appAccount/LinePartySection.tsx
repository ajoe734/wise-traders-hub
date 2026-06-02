import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LineBindingCard } from '@/components/LineBindingCard';
import type { ExpertLineRow } from './types';

interface Props {
  title: string;
  subtitle: string;
  experts: ExpertLineRow[];
  subscribedExpertIds: Set<string>;
  variant: 'advisor' | 'mentor';
}

export function LinePartySection({ title, subtitle, experts, subscribedExpertIds, variant }: Props) {
  const [show, setShow] = useState(false);
  const borderClass = variant === 'advisor' ? 'border-advisor/30' : 'border-mentor/30';
  const headingClass = variant === 'advisor' ? 'text-advisor' : 'text-mentor';
  const btnClass = variant === 'advisor' ? 'bg-advisor hover:bg-advisor/90' : 'bg-mentor hover:bg-mentor/90';

  if (!show) {
    return (
      <Card className={borderClass}>
        <CardContent className="p-4 space-y-3">
          <h3 className={`text-lg font-bold ${headingClass} text-center`}>{title}</h3>
          <p className="text-xs text-muted-foreground text-center">{subtitle}</p>
          <Button variant="default" className={`w-full ${btnClass}`} onClick={() => setShow(true)}>查看所有老師</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={borderClass}>
      <CardContent className="p-4 space-y-3">
        <h3 className={`text-lg font-bold ${headingClass} text-center mb-2`}>{title}</h3>
        <div className="space-y-3">
          {experts.map(expert => (
            <LineBindingCard
              key={expert.id}
              expertId={expert.id}
              expertSlug={expert.slug}
              expertName={expert.name}
              expertAvatarUrl={expert.avatar_url || undefined}
              lineOaId={expert.line_oa_id || undefined}
              lineChannelName={expert.channel_name || undefined}
              qrCodeUrl={expert.qr_code_url || undefined}
              isAdvisor={variant === 'advisor'}
              isSubscribed={subscribedExpertIds.has(expert.id)}
            />
          ))}
        </div>
        <Button variant="outline" className="w-full mt-2" onClick={() => setShow(false)}>收起</Button>
      </CardContent>
    </Card>
  );
}
