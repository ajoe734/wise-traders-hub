import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EyeOff, CalendarClock, Compass, RefreshCcw } from 'lucide-react';

interface Props {
  kind: 'journal' | 'signal';
}

/**
 * Friendly fallback when a journal / signal cannot be loaded.
 *
 * RLS may block reads for three reasons and the client cannot distinguish them:
 *   1. 內容已被下架或刪除
 *   2. 目前沒有訂閱該老師
 *   3. 有訂閱、但這筆內容的發布時間不在你的「訂閱涵蓋期間」內
 *
 * So we show a single message covering all three cases and offer CTAs to
 * check subscriptions / explore mentors.
 */
export const UnavailableContent = ({ kind }: Props) => {
  const label = kind === 'journal' ? '週記' : '訊號';
  return (
    <div className="p-4">
      <Card className="border-dashed">
        <CardContent className="p-6 space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <EyeOff className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">這篇{label}目前無法顯示</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              可能原因：內容已下架，或它的發布日期不在你目前訂閱的涵蓋期間內。
            </p>
          </div>

          <div className="rounded-md bg-muted/40 p-3 text-left text-xs text-muted-foreground flex items-start gap-2">
            <CalendarClock className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              訂閱到期後，只能回看「訂閱有效期間內」發布的內容。續訂後歷史就會重新解鎖。
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/app/subscriptions" data-testid="unavailable-goto-subscriptions">
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                查看 / 續訂訂閱
              </Link>
            </Button>
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/app/explore" data-testid="unavailable-goto-explore">
                <Compass className="h-4 w-4" aria-hidden="true" />
                探索導師
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default UnavailableContent;
