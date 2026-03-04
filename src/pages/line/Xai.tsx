import { useParams, useSearchParams, Link } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getPersonBySlug, getSignalById } from '@/data/mockData';
import { PersonRole, SignalAction } from '@/types';
import { Brain, Target, BarChart3, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const LineXai = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const [searchParams] = useSearchParams();
  const signalId = searchParams.get('signalId');
  
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const signal = signalId ? getSignalById(signalId) : undefined;

  const isAdvisor = expert?.role === PersonRole.ADVISOR;

  // Mock factor contributions
  const factorContributions = [
    { name: '動能突破', value: 46, direction: 'positive' },
    { name: 'EPS 上修', value: 31, direction: 'positive' },
    { name: '產業資金流入', value: 18, direction: 'positive' },
    { name: '波動回落', value: 5, direction: 'neutral' },
  ];

  const getActionLabel = (action: SignalAction) => {
    switch (action) {
      case SignalAction.BUY: return '買進';
      case SignalAction.SELL: return '賣出';
      case SignalAction.ADD: return '加碼';
      case SignalAction.TRIM: return '減碼';
      case SignalAction.EXIT: return '平損';
    }
  };

  return (
    <LineLayout>
      {expert && (
      <div className="p-4 space-y-4">
        {/* Back Link if from signal */}
        {signal && (
          <Link 
            to={`/line/${expertSlug}/signal/${signalId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回訊號詳情
          </Link>
        )}

        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {signal ? '訊號解釋' : '因子分析'}
          </h1>
          <p className="text-sm text-muted-foreground">
            了解策略的決策因子與邏輯
          </p>
        </div>

        {/* Signal-specific content */}
        {signal && (
          <Card className={cn(
            "border-2",
            isAdvisor ? "border-advisor/30" : "border-mentor/30"
          )}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={isAdvisor ? 'advisor' : 'mentor'}>
                  {getActionLabel(signal.action)}
                </Badge>
                <span className="font-bold">{signal.instrument}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {format(signal.timeTrade, 'yyyy/MM/dd HH:mm')}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Why Section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4" />
              為什麼
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {signal 
                ? signal.reasonDetail
                : '本策略綜合多個因子進行決策，包含動能、價值、品質、資金流向等面向。以下為各因子的典型貢獻度分佈。'
              }
            </p>
          </CardContent>
        </Card>

        {/* Factor Contributions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              因子貢獻度
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {factorContributions.map((factor, idx) => (
                <div key={idx}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm">{factor.name}</span>
                    <span className={cn(
                      "text-sm font-medium",
                      factor.direction === 'positive' ? "text-success" :
                      factor.direction === 'negative' ? "text-destructive" :
                      "text-muted-foreground"
                    )}>
                      {factor.value}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full",
                        factor.direction === 'positive' ? "bg-success" :
                        factor.direction === 'negative' ? "bg-destructive" :
                        "bg-muted-foreground"
                      )}
                      style={{ width: `${factor.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Sensitivity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">情境敏感度</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="bg-warning/10 text-warning">
                指數急跌：中
              </Badge>
              <Badge variant="secondary" className="bg-destructive/10 text-destructive">
                量能萎縮：高
              </Badge>
              <Badge variant="secondary" className="bg-warning/10 text-warning">
                利空消息：中
              </Badge>
              <Badge variant="secondary" className="bg-success/10 text-success">
                外資買超：低
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Risk Check */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">風險護欄檢查</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-muted/30 rounded">
                <span className="text-sm">單一標的上限</span>
                <Badge className="bg-success/10 text-success">✓ 通過</Badge>
              </div>
              <div className="flex items-center justify-between p-2 bg-muted/30 rounded">
                <span className="text-sm">產業曝險</span>
                <Badge className="bg-success/10 text-success">✓ 通過</Badge>
              </div>
              <div className="flex items-center justify-between p-2 bg-muted/30 rounded">
                <span className="text-sm">整體持股水位</span>
                <Badge className="bg-warning/10 text-warning">⚠ 偏高</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Alternative Actions */}
        <Card className="bg-muted/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">替代方案</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              若不執行此操作，替代選項包括：
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• 觀望：等待更明確的突破訊號</li>
              <li>• 降低部位：以一半的量進場</li>
              <li>• 換股：考慮同產業其他標的</li>
            </ul>
          </CardContent>
        </Card>

        {/* Back to Teaching */}
        <Button 
          variant="outline"
          className="w-full"
          asChild
        >
          <Link to={`/line/${expertSlug}/teaching`}>
            查看完整策略教學
          </Link>
        </Button>

        {/* Compliance */}
        <div className="compliance-disclaimer">
          以上分析由 AI 系統輔助產出，僅供教學參考，不構成投資建議。
        </div>
      </div>
      )}
    </LineLayout>
  );
};

export default LineXai;