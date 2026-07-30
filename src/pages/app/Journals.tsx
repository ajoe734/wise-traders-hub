import { SEO } from '@/components/SEO';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { UnifiedAppLayout, markAppJournalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { JournalCard } from '@/components/JournalCard';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveUserId } from '@/hooks/useEffectiveUserId';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { BookOpen, CalendarDays, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { taipeiMondayOf } from '@/lib/taipeiWeek';
import { zhTW } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { usePreviewMode } from '@/hooks/usePreviewMode';
import { intentHandlers } from '@/lib/routePrefetch';
import * as journalRepo from '@/lib/journalRepository';
import { AssetFilterChips } from '@/components/AssetFilterChips';
import { resolveAssetClass, type AssetClass } from '@/lib/asset';
import { SubscriptionTimeline } from '@/components/SubscriptionTimeline';
import { useSubscriptionTimeline } from '@/hooks/useSubscriptionTimeline';

interface JournalSignal {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string;
  expert_id: string;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
    asset_class: string | null;
    currency: string | null;
  };
}

interface WeekGroup {
  /** Taipei 週一 YYYY-MM-DD */
  weekStart: string;
  signals: JournalSignal[];
  expert: JournalSignal['experts'];
}

interface SubscribedExpertDiag {
  expert_id: string;
  name: string | null;
  role: string | null;
  status: string | null;
  published_count: number;
  included: boolean;
  reason: string;
}

interface JournalsDiagnostics {
  userId: string | null;
  isTester: boolean;
  expectedStatus: 'active' | 'draft';
  rawSubscriptionCount: number;
  subscribedExperts: SubscribedExpertDiag[];
}

const fetchJournalsData = async (userId: string | undefined, isTester: boolean, previewExpertId: string | null) => {
  const diag: JournalsDiagnostics = {
    userId: userId ?? null,
    isTester,
    expectedStatus: isTester ? 'draft' : 'active',
    rawSubscriptionCount: 0,
    subscribedExperts: [],
  };
  if (!userId) return { signals: [] as JournalSignal[], hasSubscription: false, diag };

  const { data: subs } = await supabase
    .rpc('has_active_subscription', { _user_id: userId });

  const expertIds: string[] = (subs || []).map((s: any) => s.expert_id);
  diag.rawSubscriptionCount = expertIds.length;

  if (previewExpertId && !expertIds.includes(previewExpertId)) {
    expertIds.push(previewExpertId);
  }

  if (expertIds.length === 0) {
    return { signals: [] as JournalSignal[], hasSubscription: false, diag };
  }

  // 拉所有訂閱 expert 完整資訊（不過濾 role/status）以便診斷
  const { data: allExperts } = await supabase
    .from('experts')
    .select('id, name, role, status')
    .in('id', expertIds);

  const expectedStatus = diag.expectedStatus;
  const expertsMap = new Map<string, { id: string; name: string; role: string; status: string }>();
  (allExperts || []).forEach((e: any) => expertsMap.set(e.id, e));

  const mentorIds: string[] = [];
  for (const id of expertIds) {
    const e = expertsMap.get(id);
    if (!e) {
      diag.subscribedExperts.push({ expert_id: id, name: null, role: null, status: null, published_count: 0, included: false, reason: '在 experts 找不到（資料可能已刪除）' });
      continue;
    }
    if (e.role !== 'mentor') {
      diag.subscribedExperts.push({ expert_id: id, name: e.name, role: e.role, status: e.status, published_count: 0, included: false, reason: `角色為 ${e.role}，週記僅顯示 mentor（修煉派）` });
      continue;
    }
    if (e.status !== expectedStatus) {
      diag.subscribedExperts.push({ expert_id: id, name: e.name, role: e.role, status: e.status, published_count: 0, included: false, reason: `導師狀態為 ${e.status}，目前需要 ${expectedStatus}${isTester ? '（您是測試者）' : ''}` });
      continue;
    }
    mentorIds.push(id);
    diag.subscribedExperts.push({ expert_id: id, name: e.name, role: e.role, status: e.status, published_count: 0, included: true, reason: '已納入查詢' });
  }

  if (mentorIds.length === 0) {
    return { signals: [] as JournalSignal[], hasSubscription: true, diag };
  }

  const { signals: fetched, error } = await journalRepo.forSubscriber<JournalSignal>(
    supabase as any,
    { mentorIds, limit: 100 },
  );

  if (error) {
    console.error('Error fetching journals:', error);
  }


  const signals = fetched;
  const countMap = new Map<string, number>();
  signals.forEach(s => countMap.set(s.expert_id, (countMap.get(s.expert_id) || 0) + 1));
  diag.subscribedExperts.forEach(s => { if (s.included) s.published_count = countMap.get(s.expert_id) || 0; });

  return { signals, hasSubscription: true, diag };
};

const Journals = () => {
  const { user } = useAuth();
  const { userId: effectiveUserId, isViewAs } = useEffectiveUserId();
  const isTester = isViewAs ? false : (user?.isTester ?? false);
  const { previewExpertId } = usePreviewMode();
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [assetFilter, setAssetFilter] = useState<AssetClass | null>(null);

  useEffect(() => {
    markAppJournalsAsRead();
  }, []);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['app-journals', effectiveUserId, isTester, isViewAs, previewExpertId],
    queryFn: () => fetchJournalsData(effectiveUserId ?? undefined, isTester, previewExpertId),
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });

  const signals = data?.signals ?? [];
  const hasSubscription = data?.hasSubscription ?? null;
  const diag = data?.diag;

  const { data: timelines = [] } = useSubscriptionTimeline(effectiveUserId ?? undefined);




  // Group signals by week
  const weekGroups = useMemo(() => {
    const groups: Map<string, WeekGroup> = new Map();
    signals.forEach(signal => {
      const pubDate = new Date(signal.published_at);
      const ws = taipeiMondayOf(pubDate);
      const key = `${signal.expert_id}-${ws}`;
      if (!groups.has(key)) {
        groups.set(key, { weekStart: ws, signals: [], expert: signal.experts });
      }
      groups.get(key)!.signals.push(signal);
    });
    return Array.from(groups.values()).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }, [signals]);

  // Available months
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    weekGroups.forEach(g => {
      monthSet.add(g.weekStart.slice(0, 7));
    });
    return Array.from(monthSet).sort().reverse();
  }, [weekGroups]);

  // Filter by month + asset class
  const filteredGroups = useMemo(() => {
    let list = weekGroups;
    if (selectedMonth !== 'all') {
      list = list.filter(g => g.weekStart.slice(0, 7) === selectedMonth);
    }
    if (assetFilter) {
      list = list.filter(g => resolveAssetClass(g.expert as any) === assetFilter);
    }
    return list;
  }, [weekGroups, selectedMonth, assetFilter]);

  const availableAssets = useMemo(() => {
    const set = new Set<AssetClass>();
    weekGroups.forEach(g => set.add(resolveAssetClass(g.expert as any)));
    return Array.from(set);
  }, [weekGroups]);

  return (
    <UnifiedAppLayout>
      <SEO title="導師週記 | legendflow" description="檢視已訂閱實戰導師的最新週記教學與覆盤分享。" path="/app/journals" noindex />
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="h-5 w-5 text-mentor" />
          <h1 className="text-xl font-bold">修煉派週記教學</h1>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            來自您訂閱導師的修煉派週記
          </p>
          
          {weekGroups.length > 0 && (
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[140px] h-8 text-sm">
                <CalendarDays className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="選擇月份" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部月份</SelectItem>
                {availableMonths.map(month => (
                  <SelectItem key={month} value={month}>
                    {format(new Date(month + '-01'), 'yyyy 年 M 月', { locale: zhTW })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {availableAssets.length > 1 && (
          <AssetFilterChips
            value={assetFilter}
            onChange={setAssetFilter}
            available={availableAssets}
          />
        )}

        {timelines.length > 0 && (
          <div className="space-y-2">
            {timelines.map(t => (
              <SubscriptionTimeline
                key={t.expert_id}
                segments={t.segments ?? []}
                expertName={t.expert_name}
                expertAvatarUrl={t.expert_avatar_url}
                showMentorLookback
              />
            ))}
          </div>
        )}


        
        
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : weekGroups.length > 0 ? (
          filteredGroups.length > 0 ? (
            <div className="space-y-3">
              {filteredGroups.map(group => (
                <JournalCard
                  key={`${group.expert.slug}-${group.weekStart}`}
                  weekStart={group.weekStart}
                  signals={group.signals}
                  expert={group.expert}
                  to={`/app/journal/${group.signals[0].id}${previewExpertId ? '?preview=1' : ''}`}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <CalendarDays className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{format(new Date(selectedMonth + '-01'), 'yyyy 年 M 月', { locale: zhTW })} 沒有週記</p>
                <Button variant="ghost" size="sm" onClick={() => setSelectedMonth('all')} className="mt-2">
                  顯示全部週記
                </Button>
              </CardContent>
            </Card>
          )
        ) : hasSubscription === false ? (
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <p className="text-muted-foreground">您尚未訂閱任何實戰導師</p>
              <p className="text-sm text-muted-foreground">訂閱後即可在此查看修煉派週記教學</p>
              <Link to="/app/explore" {...intentHandlers('app-explore')}>
                <button className="mt-2 inline-flex items-center gap-2 rounded-md bg-learning-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-learning-accent/90">
                  前往探索導師
                </button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              目前沒有新的週記
            </CardContent>
          </Card>
        )}

        {/* 診斷面板：當週記為空時顯示，協助釐清為何看不到 */}
        {!loading && weekGroups.length === 0 && diag && (
          <Card>
            <CardContent className="p-4 space-y-3 text-sm">
              <div className="font-medium">為什麼看不到週記？</div>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>登入身分：{diag.userId ? <code className="text-xs">{diag.userId.slice(0, 8)}…</code> : '未登入'}{diag.isTester ? '（測試者，需 draft 導師）' : ''}</li>
                <li>有效訂閱數：{diag.rawSubscriptionCount}</li>
                <li>需要的導師狀態：<code className="text-xs">{diag.expectedStatus}</code></li>
              </ul>
              {diag.subscribedExperts.length > 0 ? (
                <div className="space-y-2">
                  <div className="font-medium text-foreground">您訂閱的導師清單</div>
                  <div className="space-y-1.5">
                    {diag.subscribedExperts.map(e => (
                      <div key={e.expert_id} className={`rounded-md border p-2 ${e.included ? 'border-green-500/40 bg-green-500/5' : 'border-orange-500/40 bg-orange-500/5'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{e.name ?? '（未知）'}</span>
                          <span className="text-xs text-muted-foreground">role: {e.role ?? '—'} / status: {e.status ?? '—'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {e.included ? `✓ 已納入；查到 ${e.published_count} 篇 published 信號` : `✗ ${e.reason}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">
                  目前查不到您的有效訂閱（<code className="text-xs">has_active_subscription</code> 回傳空）。可能原因：訂閱已過期、尚未審核通過、或您登入的帳號與訂閱帳號不同。
                </div>
              )}
              <div className="text-xs text-muted-foreground pt-1 border-t">
                若導師狀態正確（mentor + active）卻仍顯示 0 篇，代表該導師近期尚未發布 published 週記。
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </UnifiedAppLayout>
  );
};

export default Journals;
