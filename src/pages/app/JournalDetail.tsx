import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { UnifiedAppLayout, markAppJournalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ActionBadge } from '@/components/ActionBadge';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Calendar, BookOpen, Shield, TrendingUp, Loader2 } from 'lucide-react';

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

interface TwseStockData {
  Code: string;
  Name: string;
  ClosingPrice: string;
  Change: string;
  TradeVolume: string;
  OpeningPrice?: string;
  HighestPrice?: string;
  LowestPrice?: string;
}

interface TwseFundamental {
  Code: string;
  Name: string;
  PEratio: string;
  DividendYield: string;
  PBratio: string;
}

const actionLabels: Record<string, string> = {
  buy: '買進', sell: '賣出', add: '加碼', trim: '減碼', exit: '出場',
};

const JournalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [signal, setSignal] = useState<SignalDetail | null>(null);
  const [weekSignals, setWeekSignals] = useState<SignalDetail[]>([]);
  const [stockData, setStockData] = useState<TwseStockData[]>([]);
  const [fundamentals, setFundamentals] = useState<TwseFundamental[]>([]);
  const [loading, setLoading] = useState(true);
  const [twseLoading, setTwseLoading] = useState(false);

  useEffect(() => {
    markAppJournalsAsRead();
  }, []);

  useEffect(() => {
    if (id) fetchSignal(id);
  }, [id]);

  const fetchSignal = async (signalId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('expert_signals')
      .select('id, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, expert_id, experts(name, slug, role, avatar_url)')
      .eq('id', signalId)
      .single();

    if (error || !data) {
      setLoading(false);
      return;
    }

    const s = data as any as SignalDetail;
    setSignal(s);

    // Fetch same-week signals from same expert
    const pubDate = new Date(s.published_at);
    const ws = startOfWeek(pubDate, { weekStartsOn: 1 });
    const we = endOfWeek(pubDate, { weekStartsOn: 1 });

    const { data: weekData } = await supabase
      .from('expert_signals')
      .select('id, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, expert_id, experts(name, slug, role, avatar_url)')
      .eq('expert_id', s.expert_id)
      .eq('status', 'published')
      .gte('published_at', ws.toISOString())
      .lte('published_at', we.toISOString())
      .order('published_at', { ascending: true });

    const allWeek = (weekData as any) || [];
    setWeekSignals(allWeek);
    setLoading(false);

    // Fetch TWSE data for instruments in this week
    const instruments = [...new Set(allWeek.map((sig: SignalDetail) => sig.instrument))];
    // Extract stock codes (remove .TW suffix)
    const codes = instruments.map((i: string) => i.replace('.TW', '').replace('.TWO', ''));
    if (codes.length > 0) {
      fetchTwseData(codes);
    }
  };

  const fetchTwseData = async (codes: string[]) => {
    setTwseLoading(true);
    const codesStr = codes.join(',');
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;

    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const headers = { apikey: anonKey };
    try {
      const [priceRes, fundRes] = await Promise.all([
        fetch(`https://${projectId}.supabase.co/functions/v1/twse-proxy?endpoint=STOCK_DAY_ALL&codes=${codesStr}`, { headers }),
        fetch(`https://${projectId}.supabase.co/functions/v1/twse-proxy?endpoint=BWIBBU_ALL&codes=${codesStr}`, { headers }),
      ]);

      if (priceRes.ok) {
        const priceData = await priceRes.json();
        if (Array.isArray(priceData)) setStockData(priceData);
      }
      if (fundRes.ok) {
        const fundData = await fundRes.json();
        if (Array.isArray(fundData)) setFundamentals(fundData);
      }
    } catch (e) {
      console.error('TWSE data fetch error:', e);
    }
    setTwseLoading(false);
  };

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
  const we = endOfWeek(pubDate, { weekStartsOn: 1 });

  // Collect all learning points from week signals
  const allLearningPoints = weekSignals
    .map(s => s.learning_points)
    .filter(Boolean)
    .flatMap(lp => lp!.split('\n').filter(l => l.trim()));

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <img src={signal.experts.avatar_url || '/placeholder.svg'} alt={signal.experts.name} className="h-10 w-10 rounded-full object-cover" />
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
          <Badge variant="mentor-light" className="text-[10px]">T+7 歷史週記</Badge>
        </div>

        <h1 className="text-xl font-bold">本週操作回顧</h1>

        {/* Summary from first signal */}
        {signal.reason_detail && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2">本週整體摘要</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{signal.reason_detail}</p>
            </CardContent>
          </Card>
        )}

        {/* Trades */}
        {weekSignals.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3">本週操作列表</h2>
              <div className="space-y-3">
                {weekSignals.map(ws => (
                  <div key={ws.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                    <ActionBadge action={ws.action as any} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{ws.instrument}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(ws.published_at), 'MM/dd')}</span>
                        {ws.price_hint && (
                          <span className="text-xs text-muted-foreground">@{ws.price_hint}</span>
                        )}
                      </div>
                      {ws.reason_summary && (
                        <p className="text-xs text-muted-foreground truncate">{ws.reason_summary}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
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

        {/* TWSE Market Data */}
        {(stockData.length > 0 || fundamentals.length > 0) && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-mentor" /> 本週相關個股數據（TWSE）
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 pr-3">代碼</th>
                      <th className="pb-2 pr-3">名稱</th>
                      <th className="pb-2 pr-3 text-right">收盤價</th>
                      <th className="pb-2 pr-3 text-right">漲跌</th>
                      <th className="pb-2 pr-3 text-right">本益比</th>
                      <th className="pb-2 pr-3 text-right">殖利率</th>
                      <th className="pb-2 text-right">股淨比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Merge price + fundamental data by Code
                      const allCodes = new Set([
                        ...stockData.map(d => d.Code),
                        ...fundamentals.map(d => d.Code),
                      ]);
                      return Array.from(allCodes).map(code => {
                        const price = stockData.find(d => d.Code === code);
                        const fund = fundamentals.find(d => d.Code === code);
                        const change = parseFloat(price?.Change || '0');
                        return (
                          <tr key={code} className="border-b last:border-0">
                            <td className="py-2 pr-3 font-mono text-xs">{code}</td>
                            <td className="py-2 pr-3">{price?.Name || fund?.Name || '-'}</td>
                            <td className="py-2 pr-3 text-right">{price?.ClosingPrice || '-'}</td>
                            <td className={`py-2 pr-3 text-right ${change > 0 ? 'text-red-500' : change < 0 ? 'text-green-500' : ''}`}>
                              {change > 0 ? '+' : ''}{price?.Change || '-'}
                            </td>
                            <td className="py-2 pr-3 text-right">{fund?.PEratio || '-'}</td>
                            <td className="py-2 pr-3 text-right">{fund?.DividendYield ? `${fund.DividendYield}%` : '-'}</td>
                            <td className="py-2 text-right">{fund?.PBratio || '-'}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                資料來源：臺灣證券交易所 OpenAPI（收盤後更新）
              </p>
            </CardContent>
          </Card>
        )}

        {twseLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">載入市場數據中...</span>
          </div>
        )}

        {/* Disclaimer */}
        <Card className="bg-muted/30">
          <CardContent className="p-4 flex items-start gap-2">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              本頁內容均延遲 7 天以上（T+7），僅作為歷史案例教學用途，不構成任何即時投資建議。
            </p>
          </CardContent>
        </Card>
      </div>
    </UnifiedAppLayout>
  );
};

export default JournalDetail;
