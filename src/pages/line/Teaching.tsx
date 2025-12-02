import { useParams, Link } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug } from '@/data/mockData';
import { PersonRole } from '@/types';
import { BookOpen, Target, ShieldCheck, AlertTriangle, TrendingUp, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const LineTeaching = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  if (!expert) {
    return null;
  }

  const isAdvisor = expert.role === PersonRole.ADVISOR;
  const system = expert.tradingSystems[0]; // Primary system

  return (
    <LineLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="mb-4">
          <Badge variant={isAdvisor ? 'advisor' : 'mentor'} className="mb-2">
            交易系統教學
          </Badge>
          <h1 className="text-xl font-bold">{system?.name || '策略教學'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {expert.name} • {isAdvisor ? '投顧分析師' : '實戰導師'}
          </p>
        </div>

        {/* System Overview */}
        {system && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  策略總覽
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {system.teachingIntro || system.description}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground">主要市場</p>
                    <p className="font-medium">{system.markets.join('、')}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground">持有週期</p>
                    <p className="font-medium">{system.holdingPeriod || '視情況'}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground">風險屬性</p>
                    <p className="font-medium">{system.riskProfile || '中性'}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground">風格</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {system.styleTags.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Performance Demo */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  績效成績單（教育用）
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <p className="text-xs text-muted-foreground">累積報酬</p>
                    <p className="text-xl font-bold text-success">+68.5%</p>
                  </div>
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <p className="text-xs text-muted-foreground">年化報酬</p>
                    <p className="text-xl font-bold">24.5%</p>
                  </div>
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <p className="text-xs text-muted-foreground">最大回撤</p>
                    <p className="text-xl font-bold text-warning">-12.3%</p>
                  </div>
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <p className="text-xs text-muted-foreground">Sharpe</p>
                    <p className="text-xl font-bold">1.85</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  ⚠️ 僅供教育參考，非未來報酬保證
                </p>
              </CardContent>
            </Card>

            {/* Teaching Sections */}
            {system.teachingSections?.map((section, idx) => (
              <Card key={idx}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    {idx === 0 && <ShieldCheck className="h-4 w-4" />}
                    {idx === 1 && <Target className="h-4 w-4" />}
                    {idx === 2 && <AlertTriangle className="h-4 w-4" />}
                    {section.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {section.bullets.map((bullet, bulletIdx) => (
                      <li key={bulletIdx} className="flex items-start gap-2 text-sm">
                        <span className={cn(
                          "shrink-0 mt-1 w-1.5 h-1.5 rounded-full",
                          isAdvisor ? "bg-advisor" : "bg-mentor"
                        )} />
                        <span className="text-muted-foreground">{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {/* Target Audience */}
        <Card className={cn(
          "border-2",
          isAdvisor ? "border-advisor/20" : "border-mentor/20"
        )}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              適合對象
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• 有基本投資經驗，想學習系統化操作的投資人</li>
              <li>• 希望建立紀律與風險控管觀念的學員</li>
              <li>• 想了解專業交易者如何思考與決策</li>
            </ul>
          </CardContent>
        </Card>

        {/* Usage Note */}
        <div className={cn(
          "p-4 rounded-lg",
          isAdvisor ? "bg-advisor/5" : "bg-mentor/5"
        )}>
          <p className="text-sm">
            {isAdvisor ? (
              <>
                <strong>使用說明：</strong>
                本策略教學為投顧服務的一部分，實際採用前仍需評估個人風險承受度與適合度。
              </>
            ) : (
              <>
                <strong>使用說明：</strong>
                本策略教學來自歷史操作紀錄，所有案例至少延遲一週，僅用於學習與檢討，不構成即時投資建議。
              </>
            )}
          </p>
        </div>

        {/* AI Note */}
        <p className="text-xs text-muted-foreground text-center">
          本策略由 AI 系統輔助整理教學資料，並經專家審閱
        </p>

        {/* Compliance */}
        <div className="compliance-disclaimer">
          過去績效不代表未來表現，投資有風險，請謹慎評估。
        </div>
      </div>
    </LineLayout>
  );
};

export default LineTeaching;