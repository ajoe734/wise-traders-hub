import { SEO } from '@/components/SEO';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UnifiedAppLayout, markAppSignalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';
import { supabase } from '@/integrations/supabase/client';
import { fetchSubscriberSignals } from '@/lib/subscriptionVisibility';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Radio, Clock, ChevronRight } from 'lucide-react';
import { format, isToday, differenceInHours } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { richHtmlPreview, PREVIEW_LIMITS } from '@/components/SafeRichHtml';
import { avatarUrl } from '@/lib/imageTransform';
import { intentHandlers } from '@/lib/routePrefetch';
import { usePreviewMode } from '@/hooks/usePreviewMode';
import { AssetBadge, AssetFilterChips } from '@/components/AssetFilterChips';
import { resolveAssetClass, type AssetClass } from '@/lib/asset';
import { getActionMeta, getSignalDisplayInstrument } from '@/lib/signalAction';

interface DbSignal {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  reason_summary: string | null;
  risk_notes: string | null;
  published_at: string | null;
  status: string;
  expert_id: string;
  plan_id: string | null;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
    asset_class: string | null;
    currency: string | null;
  } | null;
}

const fetchSignalsData = (userId: string | undefined, isTester: boolean, previewExpertId: string | null) =>
  fetchSubscriberSignals(supabase, userId, isTester, previewExpertId);

const Signals = () => {
  const { user } = useAuth();
  const { userId: effectiveUserId, isViewAs } = useEffectiveUserId();
  const isTester = isViewAs ? false : (user?.isTester ?? false);
  const { previewExpertId } = usePreviewMode();

  const { data, isLoading: loading } = useQuery({
    queryKey: ['app-signals', effectiveUserId, isTester, isViewAs, previewExpertId],
    queryFn: () => fetchSignalsData(effectiveUserId ?? undefined, isTester, previewExpertId),
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });

  const signals = data?.signals ?? [];
  const hasSubscription = data?.hasSubscription ?? null;

  const [assetFilter, setAssetFilter] = useState<AssetClass | null>(null);
  const availableAssets = useMemo(() => {
    const set = new Set<AssetClass>();
    signals.forEach((s: any) => set.add(resolveAssetClass(s.experts)));
    return Array.from(set);
  }, [signals]);
  const filteredSignals = useMemo(() => {
    if (!assetFilter) return signals;
    return signals.filter((s: any) => resolveAssetClass(s.experts) === assetFilter);
  }, [signals, assetFilter]);

  useEffect(() => {
    markAppSignalsAsRead();
  }, []);

  return (
    <UnifiedAppLayout>
      <SEO title="即時策略訊號 | legendflow" description="檢視已訂閱投顧分析師的最新買賣訊號與操作說明。" path="/app/signals" noindex />
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Radio className="h-5 w-5 text-signals-accent" />
          <h1 className="text-xl font-bold">我的投顧訊號牆</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          來自您訂閱的投顧分析師的即時策略訊號
        </p>

        {availableAssets.length > 1 && (
          <AssetFilterChips
            value={assetFilter}
            onChange={setAssetFilter}
            available={availableAssets}
            className="mb-2"
          />
        )}

        {loading ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">載入中...</CardContent>
          </Card>
        ) : filteredSignals.length > 0 ? (
          <div className="space-y-3">
            {filteredSignals.map(signal => {
              const ac = getActionMeta(signal.action);
              const publishedAt = signal.published_at ? new Date(signal.published_at) : new Date();
              const isRecent = differenceInHours(new Date(), publishedAt) < 24;

              return (
                <Link key={signal.id} to={`/app/signal/${signal.id}`}>
                  <Card variant="interactive" className="overflow-hidden mb-3">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{format(publishedAt, 'MM/dd HH:mm', { locale: zhTW })}</span>
                        </div>
                        {isToday(publishedAt) ? (
                          <Badge variant="success-light" className="text-[10px]">即時</Badge>
                        ) : isRecent ? (
                          <Badge variant="warning-light" className="text-[10px]">近期</Badge>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <Badge className={cn(ac.className, 'text-xs px-2 py-0.5')}>{ac.label}</Badge>
                        <span className="font-semibold text-lg">{getSignalDisplayInstrument(signal)}</span>
                        <AssetBadge source={signal.experts} />
                      </div>

                      {signal.experts && (
                        <div className="flex items-center gap-2 mb-3">
                          <img
                            src={avatarUrl(signal.experts.avatar_url, 48)}
                            alt={signal.experts.name}
                            loading="lazy"
                            decoding="async"
                            className="shrink-0 h-6 w-6 rounded-full object-cover object-[center_15%]"
                          />
                          <span className="text-sm text-muted-foreground">{signal.experts.name}</span>
                         <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
                            {signal.experts.role === 'advisor' ? '投顧分析師' : '實戰導師'}
                          </Badge>
                        </div>
                      )}

                      {signal.reason_summary && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{richHtmlPreview(signal.reason_summary, PREVIEW_LIMITS.listRow)}</p>
                      )}

                      {signal.risk_notes && (() => {
                        const riskTxt = richHtmlPreview(signal.risk_notes, PREVIEW_LIMITS.riskNoteShort);
                        return riskTxt ? (
                          <div className="bg-warning-light/50 rounded-lg p-2.5 text-xs text-warning mb-3">
                            💡 {riskTxt}
                          </div>
                        ) : null;
                      })()}

                      <div className="flex items-center justify-end text-sm text-muted-foreground font-medium">
                        查看詳解與教學
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : hasSubscription === false ? (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <p className="text-muted-foreground">您尚未訂閱任何分析師</p>
              <p className="text-sm text-muted-foreground">訂閱後即可在此查看即時投顧訊號</p>
              <Link to="/app/explore" {...intentHandlers('app-explore')}>
                <button className="mt-2 inline-flex items-center gap-2 rounded-md bg-signals-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-signals-accent/90">
                  前往探索分析師
                </button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              {assetFilter ? '目前該資產類別沒有訊號' : '目前沒有新的訊號'}
            </CardContent>
          </Card>
        )}
      </div>
    </UnifiedAppLayout>
  );
};

export default Signals;
