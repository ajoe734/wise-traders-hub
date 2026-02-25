import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { UnifiedAppLayout, markAppSignalsAsRead } from '@/components/layouts/UnifiedAppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { AlertTriangle, BookOpen, Lightbulb, Shield, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStockQuote } from '@/hooks/useStockQuote';

const actionConfig: Record<string, { label: string; className: string }> = {
  buy: { label: '買進', className: 'bg-success text-white border-success' },
  sell: { label: '賣出', className: 'bg-destructive text-white border-destructive' },
  add: { label: '加碼', className: 'bg-blue-500 text-blue-50 border-blue-500' },
  trim: { label: '減碼', className: 'bg-amber-500 text-amber-50 border-amber-500' },
  exit: { label: '出場', className: 'bg-slate-500 text-slate-50 border-slate-500' },
};

interface DbSignal {
  id: string;
  instrument: string;
  action: string;
  price_hint: number | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string | null;
  experts: {
    name: string;
    slug: string;
    role: string;
    avatar_url: string | null;
  } | null;
}

const BulletList = ({ text, dotClassName }: { text: string; dotClassName: string }) => {
  const lines = text.split('\n').map(l => l.replace(/^[•·]\s*/, '').trim()).filter(Boolean);
  return (
    <ul className="space-y-1.5">
      {lines.map((line, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
          <span className={cn('mt-[6px] ml-1 h-1 w-1 rounded-full flex-shrink-0', dotClassName)} />
          {line}
        </li>
      ))}
    </ul>
  );
};

const SignalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [signal, setSignal] = useState<DbSignal | null>(null);
  const [loading, setLoading] = useState(true);

  // Extract stock ticker for price lookup (e.g. "2330 台積電" → "2330")
  const ticker = signal?.instrument?.match(/^\d+/)?.[0];
  const twSymbol = ticker ? `${ticker}.TW` : '';
  const { quote } = useStockQuote(twSymbol || '2330.TW');

  useEffect(() => {
    markAppSignalsAsRead();
    if (id) fetchSignal(id);
  }, [id]);

  const fetchSignal = async (signalId: string) => {
    setLoading(true);
    const { data } = await supabase
      .from('expert_signals')
      .select('id, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, experts(name, slug, role, avatar_url)')
      .eq('id', signalId)
      .single();
    setSignal(data as unknown as DbSignal | null);
    setLoading(false);
  };

  if (loading) {
    return <UnifiedAppLayout><div className="p-4 text-center text-muted-foreground">載入中...</div></UnifiedAppLayout>;
  }

  if (!signal) {
    return <UnifiedAppLayout><div className="p-4 text-center text-muted-foreground">找不到此訊號</div></UnifiedAppLayout>;
  }

  const ac = actionConfig[signal.action] || actionConfig.buy;
  const publishedAt = signal.published_at ? new Date(signal.published_at) : null;
  const priceDisplay = twSymbol && quote ? `${twSymbol} $${quote.price}` : twSymbol || '';

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-4">
        {/* Header: instrument + expert name + stock price */}
        {/* Row 1: Badge + ticker.TW */}
        <div className="flex items-center gap-3">
          <Badge className={cn(ac.className, 'text-xs px-2 py-0.5')}>{ac.label}</Badge>
          <span className="text-2xl font-bold">{twSymbol || signal.instrument}</span>
        </div>
        {/* Row 2: date + expert name + role badge */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {publishedAt && <span>{format(publishedAt, 'yyyy/MM/dd HH:mm', { locale: zhTW })}</span>}
          {signal.experts && (
            <>
              <span>•</span>
              <span className="font-medium text-foreground">{signal.experts.name}</span>
              <Badge className="text-[10px] bg-[hsl(0,35%,10%)] text-white/70 border border-[hsl(0,45%,20%)] px-2 py-0.5">
                {signal.experts.role === 'advisor' ? '投顧分析師' : '實戰導師'}
              </Badge>
            </>
          )}
        </div>

        {/* Price hint */}
        {signal.price_hint != null && (
          <div className="text-sm text-muted-foreground">
            參考價位：<span className="font-medium text-foreground">{signal.price_hint}</span>
          </div>
        )}

        {/* 1. 為什麼這樣操作？ */}
        {signal.reason_detail && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" /> 為什麼這樣操作？
              </h2>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{signal.reason_detail}</p>
            </CardContent>
          </Card>
        )}

        {/* 2. 部位控管想法 */}
        {signal.reason_summary && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" /> 部位控管想法
              </h2>
              <BulletList text={signal.reason_summary} dotClassName="bg-primary" />
            </CardContent>
          </Card>
        )}

        {/* 3. 風險提醒 */}
        {signal.risk_notes && (
          <Card className="bg-warning-light/30 border-warning/20">
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" /> 風險提醒
              </h2>
              <BulletList text={signal.risk_notes} dotClassName="bg-warning" />
            </CardContent>
          </Card>
        )}

        {/* 4. 延伸學習 */}
        {signal.learning_points && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-mentor" /> 延伸學習
              </h2>
              <BulletList text={signal.learning_points} dotClassName="bg-mentor" />
            </CardContent>
          </Card>
        )}

        {/* Disclaimer */}
        <Card className="bg-muted/30">
          <CardContent className="p-4 flex items-start gap-2">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              本訊號為投顧服務的一部分，提供之分析意見僅供參考，不保證獲利。投資有風險，請審慎評估。
            </p>
          </CardContent>
        </Card>
      </div>
    </UnifiedAppLayout>
  );
};

export default SignalDetail;
