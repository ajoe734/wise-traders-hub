import { useParams, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { LineLayout, markSignalsAsRead } from '@/components/layouts/LineLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getSignalById, getPersonBySlug } from '@/data/mockData';
import { PersonRole, SignalAction } from '@/types';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, BookOpen, Target, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';

const LineSignalDetail = () => {
  const { expertSlug, signalId } = useParams<{ expertSlug: string; signalId: string }>();
  const { user } = useAuth();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const signal = signalId ? getSignalById(signalId) : undefined;

  // Mark as read when viewing signal detail
  useEffect(() => {
    if (user && expertSlug && expert) {
      const isAdvisor = expert.role === PersonRole.ADVISOR;
      markSignalsAsRead(user.id, expertSlug, isAdvisor);
    }
  }, [user, expertSlug, expert]);

  if (!expert || !signal) {
    return (
      <LineLayout>
        <div className="p-4 text-center py-12">
          <p className="text-muted-foreground mb-4">找不到此訊號</p>
          <Button asChild>
            <Link to={`/line/${expertSlug}/signals`}>返回訊號牆</Link>
          </Button>
        </div>
      </LineLayout>
    );
  }

  const isAdvisor = expert.role === PersonRole.ADVISOR;

  const getActionLabel = (action: SignalAction) => {
    switch (action) {
      case SignalAction.BUY: return '買進';
      case SignalAction.SELL: return '賣出';
      case SignalAction.ADD: return '加碼';
      case SignalAction.TRIM: return '減碼';
      case SignalAction.EXIT: return '出場';
    }
  };

  const getActionColor = (action: SignalAction) => {
    switch (action) {
      case SignalAction.BUY:
      case SignalAction.ADD:
        return 'text-success bg-success/10';
      case SignalAction.SELL:
      case SignalAction.TRIM:
      case SignalAction.EXIT:
        return 'text-destructive bg-destructive/10';
    }
  };

  return (
    <LineLayout>
      <div className="p-4 space-y-4">
        {/* Back Link */}
        <Link 
          to={`/line/${expertSlug}/signals`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          返回訊號牆
        </Link>

        {/* Header */}
        <div className={cn(
          "p-4 rounded-xl",
          isAdvisor ? "bg-advisor/5" : "bg-mentor/5"
        )}>
          <div className="flex items-center gap-2 mb-2">
            <Badge className={cn("text-sm", getActionColor(signal.action))}>
              {getActionLabel(signal.action)}
            </Badge>
            {signal.action === SignalAction.BUY || signal.action === SignalAction.ADD ? (
              <TrendingUp className="h-5 w-5 text-success" />
            ) : (
              <TrendingDown className="h-5 w-5 text-destructive" />
            )}
          </div>
          <h1 className="text-2xl font-bold mb-1">{signal.instrument}</h1>
          <p className="text-sm text-muted-foreground">
            {format(signal.timeTrade, 'yyyy/MM/dd HH:mm')} • {signal.strategyName}
          </p>
          {signal.priceHint && (
            <p className="text-sm mt-2">建議價位：{signal.priceHint}</p>
          )}
        </div>

        {/* Plan Badge */}
        <div className="text-xs text-muted-foreground">
          透過「{isAdvisor ? '投顧策略訂閱' : '修煉派週記教學訂閱'}」取得此{isAdvisor ? '訊號' : '案例'}
        </div>

        {/* Why Section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" />
              為什麼這樣操作？
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-line">
              {signal.reasonDetail}
            </p>
          </CardContent>
        </Card>

        {/* Position Notes */}
        {signal.positionNotes.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                部位控管想法
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {signal.positionNotes.map((note, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className={cn(
                      "shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs",
                      isAdvisor ? "bg-advisor/10 text-advisor" : "bg-mentor/10 text-mentor"
                    )}>
                      {idx + 1}
                    </span>
                    <span className="text-muted-foreground">{note}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Risk Notes */}
        {signal.riskNotes.length > 0 && (
          <Card className="border-warning/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4" />
                風險提醒
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {signal.riskNotes.map((note, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-warning">⚠️</span>
                    <span className="text-muted-foreground">{note}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Learning Points */}
        {signal.learningPoints.length > 0 && (
          <Card className={cn(
            "border-2",
            isAdvisor ? "border-advisor/20" : "border-mentor/20"
          )}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                學習重點
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {signal.learningPoints.map((point, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span>📚</span>
                    <span className="text-muted-foreground">{point}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Link to Teaching */}
        <Button 
          variant={isAdvisor ? 'advisor' : 'mentor'}
          className="w-full"
          asChild
        >
          <Link to={`/line/${expertSlug}/teaching`}>
            看完整交易系統教學
          </Link>
        </Button>

        {/* Compliance */}
        <div className="compliance-disclaimer">
          {isAdvisor ? (
            <>
              本訊號為投顧服務的一部分，提供之分析意見僅供參考，不保證獲利。
              投資一定有風險，請謹慎評估。
            </>
          ) : (
            <>
              本內容為歷史案例教學，不構成任何即時投資建議。
              所有操作已延遲至少 7 天，僅供學習參考。
            </>
          )}
        </div>
      </div>
    </LineLayout>
  );
};

export default LineSignalDetail;