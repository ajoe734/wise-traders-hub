import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { UnifiedAppLayout, markAppJournalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ActionBadge } from '@/components/ActionBadge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { format, startOfWeek, addDays } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Calendar, BookOpen, Shield, Loader2, ChevronDown, ChevronUp, Lightbulb, Target, AlertTriangle, Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { SafeRichHtml, richHtmlPreview } from '@/components/SafeRichHtml';
import { avatarUrl } from '@/lib/imageTransform';

interface SignalDetail {
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
  };
}

const TradeItem = ({ signal }: { signal: SignalDetail }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = signal.reason_summary || signal.reason_detail || signal.risk_notes;

  return (
    <div className="px-4 py-3">
      <div
        className={`flex items-center gap-3 ${hasDetails ? 'cursor-pointer' : ''}`}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <ActionBadge action={signal.action as any} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{signal.instrument}</span>
            <span className="text-xs text-muted-foreground">{format(new Date(signal.published_at), 'MM/dd')}</span>
          </div>
        </div>
        {hasDetails && (
          <button className="text-muted-foreground shrink-0">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {expanded && hasDetails && (
        <div className="mt-3 ml-9 space-y-3">
          {signal.reason_summary && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                <Lightbulb className="h-3.5 w-3.5 text-primary" /> 為什麼這樣操作？
              </h3>
              <SafeRichHtml html={signal.reason_summary} className="text-xs" />
            </div>
          )}
          {signal.reason_detail && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1">
                <Target className="h-3.5 w-3.5 text-primary" /> 部位控管想法
              </h3>
              <SafeRichHtml html={signal.reason_detail} className="text-xs" />
            </div>
          )}
          {signal.risk_notes && (
            <div>
              <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-1 text-warning">
                <AlertTriangle className="h-3.5 w-3.5" /> 風險提醒
              </h3>
              <SafeRichHtml html={signal.risk_notes} className="text-xs" />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const fetchJournalBundle = async (signalId: string) => {
  const { data, error } = await supabase
    .from('expert_signals')
    .select('id, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, expert_id, experts(name, slug, role, avatar_url)')
    .eq('id', signalId)
    .single();

  if (error || !data) return { signal: null, weekSignals: [] as SignalDetail[] };

  const s = data as any as SignalDetail;
  const pubDate = new Date(s.published_at);
  const ws = startOfWeek(pubDate, { weekStartsOn: 1 });
  const we = addDays(ws, 4);

  const { data: weekData } = await supabase
    .from('expert_signals')
    .select('id, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, expert_id, experts(name, slug, role, avatar_url)')
    .eq('expert_id', s.expert_id)
    .eq('status', 'published')
    .gte('published_at', ws.toISOString())
    .lte('published_at', new Date(we.getFullYear(), we.getMonth(), we.getDate(), 23, 59, 59).toISOString())
    .order('published_at', { ascending: false });

  return { signal: s, weekSignals: ((weekData as any) || []) as SignalDetail[] };
};

const JournalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { user, hasRole } = useAuth();

  const { data, isLoading: loading } = useQuery({
    queryKey: ['app-journal-detail', id],
    queryFn: () => fetchJournalBundle(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });

  const signal = data?.signal ?? null;
  const weekSignals = data?.weekSignals ?? [];

  const isPreview = searchParams.get('preview') === '1' && (
    (signal?.experts?.slug && user?.expertSlug === signal.experts.slug) || hasRole('company_admin')
  );

  useEffect(() => {
    markAppJournalsAsRead();
  }, []);

  if (loading) {
    return (
      <UnifiedAppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </UnifiedAppLayout>
    );
  }

  if (!signal) {
    return <UnifiedAppLayout><div className="p-4 text-center">找不到此週記</div></UnifiedAppLayout>;
  }

  const pubDate = new Date(signal.published_at);
  const ws = startOfWeek(pubDate, { weekStartsOn: 1 });
  const we = addDays(ws, 4);

  const weekTitle = richHtmlPreview(signal.reason_summary, 80) || '本週操作回顧';

  const allLearningPoints = weekSignals
    .map(s => richHtmlPreview(s.learning_points, 500))
    .filter(Boolean)
    .flatMap(lp => lp!.split(/\\n|\n/).filter(l => l.trim()));

  return (
    <UnifiedAppLayout>
      {isPreview && (
        <div className="sticky top-0 z-50 bg-amber-500 text-amber-50 px-4 py-2 text-sm flex items-center justify-center gap-2 shadow">
          <Eye className="h-4 w-4" />
          <span className="font-medium">🔍 訂閱者預覽模式</span>
          <Button size="sm" variant="outline" className="ml-2 h-7 bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100" onClick={() => window.close()}>
            退出預覽
          </Button>
        </div>
      )}
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <img src={avatarUrl(signal.experts.avatar_url, 80)} alt={signal.experts.name} loading="lazy" decoding="async" className="shrink-0 h-10 w-10 rounded-full object-cover object-[center_15%]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{signal.experts.name}</span>
              <Badge variant="secondary" className="text-[10px]">
                {signal.experts.role === 'mentor' ? '實戰導師' : '分析師'}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{format(ws, 'MM/dd', { locale: zhTW })} ~ {format(we, 'MM/dd', { locale: zhTW })}</span>
          <Badge variant="mentor-light" className="text-[10px]">T+7 歷史</Badge>
        </div>

        <h1 className="text-xl font-bold">{weekTitle}</h1>

        {/* Summary */}
        {signal.reason_detail && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2">本週整體摘要</h2>
              <SafeRichHtml html={signal.reason_detail} />
            </CardContent>
          </Card>
        )}

        {/* Trades with expandable details */}
        {weekSignals.length > 0 && (
          <div>
            <h2 className="font-semibold mb-3">本週操作列表</h2>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {weekSignals.map(ws => (
                    <TradeItem key={ws.id} signal={ws} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Learning Points */}
        {allLearningPoints.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-mentor" /> 本週教學重點
              </h2>
              <ul className="space-y-2">
                {allLearningPoints.map((point, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-mentor">•</span> {point}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Disclaimer */}
        <Card className="bg-muted/30">
          <CardContent className="p-4 flex items-start gap-2">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              本頁內容為一週前之操作回顧（T+7），僅供教學用途，不構成任何即時投資建議。
            </p>
          </CardContent>
        </Card>
      </div>
    </UnifiedAppLayout>
  );
};

export default JournalDetail;
