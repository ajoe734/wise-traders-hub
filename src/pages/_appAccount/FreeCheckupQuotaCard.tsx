import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatTaipeiYMDHM } from '@/checkup/utils/formatTaipeiDate';

interface QuotaSnapshot {
  tier: string;
  period: string;
  limit: number;
  base_limit?: number;
  entitlement_total?: number;
  used: number;
  remaining: number;
  resets_at: string | null;
  last_used_at: string | null;
}

/**
 * 顯示「免費／訂閱收盤分析」可用狀態與原因。
 * - 來源：public.check_checkup_quota(_user_id) RPC
 * - tier: line_free / basic / pro / none
 * - 解釋為何能或不能用、剩餘幾次、何時重置
 */
export function FreeCheckupQuotaCard() {
  const { user } = useAuth();
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    (async () => {
      setLoading(true); setErr(null);
      const { data, error } = await supabase.rpc('check_checkup_quota', { _user_id: user.id });
      if (!alive) return;
      if (error) setErr(error.message);
      else setQuota(data as unknown as QuotaSnapshot);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const reason = inferReason(quota, user?.isTester, user?.isLineUser);
  const canUse = (quota?.remaining ?? 0) > 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">免費收盤分析</h3>
          </div>
          {quota && (
            <span className={`text-xs px-2 py-0.5 rounded-full border ${
              canUse
                ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700'
                : 'border-muted-foreground/30 bg-muted text-muted-foreground'
            }`}>
              {canUse ? '可使用' : '已用完'}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> 載入額度中…
          </div>
        ) : err ? (
          <div className="text-sm text-destructive">無法載入額度：{err}</div>
        ) : quota ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="已使用" value={String(quota.used)} />
              <Stat label="總額度" value={quota.limit > 0 ? String(quota.limit) : '—'} />
              <Stat label="剩餘" value={String(quota.remaining)} highlight={canUse} />
            </div>

            <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
              <p><span className="text-foreground font-medium">為什麼{canUse ? '能' : '不能'}用：</span>{reason}</p>
              {quota.period !== 'lifetime' && quota.resets_at && quota.resets_at !== 'infinity' && (
                <p>下次重置時間：{formatTaipeiYMDHM(quota.resets_at) || '—'}</p>
              )}
              {quota.last_used_at && (
                <p>上次使用：{formatTaipeiYMDHM(quota.last_used_at) || '—'}</p>
              )}
            </div>

            <Button asChild size="sm" variant={canUse ? 'default' : 'outline'} className="w-full">
              <Link to="/holding-checkup">{canUse ? '前往收盤分析' : '查看健檢方案'}</Link>
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border rounded-md py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${highlight ? 'text-emerald-600' : ''}`}>{value}</div>
    </div>
  );
}

function inferReason(q: QuotaSnapshot | null, isTester?: boolean, isLine?: boolean): string {
  if (!q) return '尚未取得額度資訊。';
  if (isTester || q.tier === 'pro' && q.limit === 22 && q.period === 'month') {
    // tester path：check_checkup_quota 對 tester 直接給 pro/22/month
    if (isTester) return '您是內部測試帳號，每月 22 次額度。';
  }
  switch (q.tier) {
    case 'line_free':
      return q.remaining > 0
        ? '您是 LINE 註冊會員，享 1 次終身免費收盤分析。'
        : '您是 LINE 註冊會員的 1 次終身免費額度已使用完畢，如需更多分析請訂閱付費方案。';
    case 'basic':
    case 'pro':
      return q.remaining > 0
        ? `您已訂閱 ${q.tier === 'pro' ? '進階' : '基本'} 方案，本月還有 ${q.remaining} 次可用。`
        : `您已訂閱 ${q.tier === 'pro' ? '進階' : '基本'} 方案，本月配額已用完，下個週期會自動重置。`;
    case 'none':
    default:
      if (isLine) return '您的 LINE 帳號目前沒有可用額度，請聯絡客服協助核對。';
      return '您目前未訂閱付費方案，亦無免費額度（免費 1 次額度限 LINE 登入會員）。如需使用收盤分析請訂閱方案，或以 LINE 帳號登入。';
  }
}
