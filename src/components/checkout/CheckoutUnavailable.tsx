import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export interface CheckoutUnavailableProps {
  /** 'suspended' | 'missing' | 'draft' | 'other' */
  reason: 'suspended' | 'missing' | 'draft' | 'other';
  expertName?: string | null;
  expertSlug?: string | null;
  /** override back button target (defaults differ by surface) */
  backTo?: string;
  backLabel?: string;
}

const TITLES: Record<CheckoutUnavailableProps['reason'], string> = {
  suspended: '此專家暫停服務',
  missing: '找不到此方案',
  draft: '此方案尚未上架',
  other: '無法載入此方案',
};

const DESCRIPTIONS: Record<CheckoutUnavailableProps['reason'], string> = {
  suspended:
    '此專家目前暫停服務，暫時無法接受新訂閱。若您原本即為訂閱者，原訂閱仍會持續至到期日。',
  missing: '此方案連結可能已失效或被移除，請回到專家列表重新選擇。',
  draft: '此方案目前仍在審核中，請稍後再回來查看。',
  other: '系統暫時無法載入此方案資料，請稍後再試。',
};

export function CheckoutUnavailable({
  reason,
  expertName,
  backTo = '/experts',
  backLabel = '返回專家列表',
}: CheckoutUnavailableProps) {
  return (
    <div className="container py-16 text-center max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-3" data-testid="checkout-unavailable-title">
        {TITLES[reason]}
      </h1>
      {expertName ? (
        <p className="text-sm text-muted-foreground mb-2">專家：{expertName}</p>
      ) : null}
      <p className="text-muted-foreground mb-6">{DESCRIPTIONS[reason]}</p>
      <Button asChild>
        <Link to={backTo}>{backLabel}</Link>
      </Button>
    </div>
  );
}
