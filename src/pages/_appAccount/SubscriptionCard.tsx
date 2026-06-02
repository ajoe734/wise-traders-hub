import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Loader2, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { avatarUrl } from '@/lib/imageTransform';
import { calcRefund } from '@/lib/refundCalc';
import { getPlanTypeLabel, isAdvisorPlan, type DbSubscription } from './types';

interface Props {
  sub: DbSubscription;
  cancelingId: string | null;
  onCancel: (id: string) => void;
}

export function SubscriptionCard({ sub, cancelingId, onCancel }: Props) {
  const advisor = isAdvisorPlan(sub.plan.plan_type);
  const isCanceling = !!sub.canceled_at;

  return (
    <Card className={cn(
      "overflow-hidden border-2",
      isCanceling ? "border-amber-400/50" : advisor ? "border-advisor/50" : "border-mentor/50"
    )}>
      <div className={cn("h-1 bg-gradient-to-r", advisor ? "from-advisor to-advisor/50" : "from-mentor to-mentor/50")} />
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {sub.expert.slug ? (
            <Link to={`/app/expert/${sub.expert.slug}`} className="shrink-0 rounded-full ring-2 ring-transparent hover:ring-primary/40 transition">
              <img src={avatarUrl(sub.expert.avatar_url, 96)} alt={sub.expert.name} loading="lazy" decoding="async"
                className="h-12 w-12 rounded-full object-cover object-[center_15%]" />
            </Link>
          ) : (
            <img src={avatarUrl(sub.expert.avatar_url, 96)} alt={sub.expert.name} loading="lazy" decoding="async"
              className="shrink-0 h-12 w-12 rounded-full object-cover object-[center_15%]" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {sub.expert.slug ? (
                <Link to={`/app/expert/${sub.expert.slug}`} className="font-semibold hover:underline">{sub.expert.name}</Link>
              ) : (
                <h3 className="font-semibold">{sub.expert.name}</h3>
              )}
              {isCanceling ? (
                <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                  已取消（服務至月底）
                </Badge>
              ) : (
                <Badge variant="secondary" className={cn(
                  advisor ? "bg-advisor/20 text-advisor border-advisor/30" : "bg-mentor/20 text-mentor border-mentor/30"
                )}>有效</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{sub.plan.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {getPlanTypeLabel(sub.plan.plan_type)} · NT$ {sub.plan.price_monthly.toLocaleString()}/月
            </p>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              <span>
                {format(new Date(sub.started_at), 'yyyy/MM/dd')}
                {sub.expires_at && ` - ${format(new Date(sub.expires_at), 'yyyy/MM/dd')}`}
              </span>
              {isCanceling ? (
                <span className="text-amber-600 dark:text-amber-400">下月起不再扣款</span>
              ) : (
                <span className={cn(advisor ? "text-advisor/70" : "text-mentor/70")}>手動續訂</span>
              )}
            </div>
            {(() => {
              if (!sub.expires_at || isCanceling) return null;
              const msLeft = new Date(sub.expires_at).getTime() - Date.now();
              const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
              if (daysLeft > 14 || daysLeft < 0) return null;
              return (
                <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-amber-800 dark:text-amber-300">
                    將於 {format(new Date(sub.expires_at), 'yyyy/MM/dd')} 到期，{daysLeft <= 0 ? '今日內請完成續訂' : `剩 ${daysLeft} 天`}
                  </span>
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link to={`/${sub.expert.slug}/checkout?plan=${sub.plan_id}`}>立即續訂</Link>
                  </Button>
                </div>
              );
            })()}
          </div>
        </div>

        {!isCanceling && (
          <div className="mt-3 pt-3 border-t flex justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                  disabled={cancelingId === sub.id}>
                  {cancelingId === sub.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  取消訂閱
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>確認取消訂閱?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-3">
                      <p>您確定要取消 <span className="font-semibold">{sub.expert.name}</span> 的 {sub.plan.name} 訂閱嗎?</p>
                      {(() => {
                        const r = calcRefund(sub);
                        return (
                          <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
                            {r.isYearly ? (
                              <>
                                <div className="flex justify-between"><span className="text-muted-foreground">計費方式</span><span className="font-medium">年繳</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">剩餘月數</span><span>{r.remainingMonths} 個月</span></div>
                                <div className="border-t pt-1 flex justify-between font-semibold">
                                  <span>預計退款</span>
                                  <span className={r.refundAmount > 0 ? "text-green-600 dark:text-green-400" : ""}>
                                    NT$ {r.refundAmount.toLocaleString()}
                                  </span>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="flex justify-between"><span className="text-muted-foreground">計費方式</span><span className="font-medium">月繳</span></div>
                                <p className="text-xs text-muted-foreground">月繳不退款,本月服務持續至月底。</p>
                              </>
                            )}
                          </div>
                        );
                      })()}
                      <p className="text-sm text-muted-foreground">取消後,服務將持續提供至本月底。</p>
                      <p className="text-xs text-muted-foreground">LINE 綁定不會自動解除,您仍會收到推播通知。</p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>返回</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onCancel(sub.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    確認取消
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
