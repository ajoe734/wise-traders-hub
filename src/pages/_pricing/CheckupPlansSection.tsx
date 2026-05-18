import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, CheckCircle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useCheckupPlans } from '@/hooks/useCheckupPlans';

export function CheckupPlansSection() {
  const { data: plans = [] } = useCheckupPlans();
  const [quota, setQuota] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // 滾動到 #checkup 錨點 — 等 plans 載入完成
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#checkup') return;
    if (plans.length === 0) return;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const el = document.getElementById('checkup');
        if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
      });
    });
    return () => { cancelled = true; };
  }, [plans.length]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        if (mounted) setUserId(uid);
        const { data, error } = await supabase.rpc('check_checkup_quota', { _user_id: uid });
        if (!error && data && mounted) setQuota(data);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  if (plans.length === 0) return null;

  const currentTier = quota?.tier || (userId ? 'free' : null);
  const tierLabel = (t: string) => t === 'pro' ? 'Pro' : t === 'basic' ? 'Basic' : t === 'free' ? '免費版' : '訪客';

  return (
    <div id="checkup" className="max-w-4xl mx-auto mb-12 scroll-mt-24">
      <div className="flex items-center gap-2 mb-2">
        <Stethoscope className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold">持股健檢</h2>
        <Badge variant="secondary" className="ml-2">平台自營</Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        AI 幫你看手上的股票：風險、事件、調整建議。可獨立訂閱，無需綁定老師。
      </p>

      {userId && quota && (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">目前方案</span>
          <Badge variant="outline">{tierLabel(currentTier)}</Badge>
          <span className="text-muted-foreground">·</span>
          <span>
            {quota.period === 'week' ? '本週' : '本月'}剩餘
            <span className="font-semibold text-foreground mx-1">{quota.remaining}</span>
            <span className="text-muted-foreground">/ {quota.limit} 次</span>
          </span>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <Card className={cn('border-2', currentTier === 'free' ? 'border-primary/40' : 'border-border')}>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold">免費版</h3>
                <p className="text-sm text-muted-foreground mt-0.5">先試試 AI 健檢</p>
              </div>
              {currentTier === 'free' && <Badge variant="secondary">目前方案</Badge>}
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm text-muted-foreground">NT$</span>
              <span className="text-3xl font-bold">0</span>
              <span className="text-muted-foreground text-sm">／月</span>
            </div>
            <p className="text-xs text-muted-foreground">登入即可使用</p>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                <span>每月 1 次 AI 健檢</span>
              </li>
              <li className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                <span>截圖解析 / 收盤分析 / 事件預測共用</span>
              </li>
            </ul>
            {!userId ? (
              <Button asChild className="w-full" variant="outline">
                <Link to="/auth/login">登入解鎖</Link>
              </Button>
            ) : (
              <Button className="w-full" variant="outline" disabled>
                {currentTier === 'free' ? '目前方案' : '已是更高方案'}
              </Button>
            )}
          </CardContent>
        </Card>

        {plans.map((p) => {
          const yearlySave = Math.round((1 - p.price_yearly / (p.price_monthly * 12)) * 100);
          const isPro = p.tier === 'pro';
          const isCurrent = currentTier === p.tier;
          return (
            <Card key={p.id} className={cn('border-2', isCurrent ? 'border-primary/60' : isPro ? 'border-primary/40' : 'border-border')}>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold">{p.name}</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">{p.description}</p>
                  </div>
                  {isCurrent ? <Badge variant="secondary">目前方案</Badge> : isPro && <Badge>推薦</Badge>}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm text-muted-foreground">NT$</span>
                  <span className="text-3xl font-bold">{p.price_monthly.toLocaleString()}</span>
                  <span className="text-muted-foreground text-sm">／月</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  年繳 NT$ {p.price_yearly.toLocaleString()}（省 {yearlySave}%）
                </p>
                <ul className="space-y-1.5">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="w-full" variant={isPro ? 'default' : 'outline'} disabled={isCurrent}>
                  <Link to={isCurrent ? '#' : `/checkout/checkup/${p.id}`}>
                    {isCurrent ? '目前方案' : <>立即訂閱 <ArrowRight className="h-4 w-4 ml-2" /></>}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
