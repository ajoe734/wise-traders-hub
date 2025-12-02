import { useParams, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { getSystemWithPerson } from '@/data/mockData';
import { PersonRole } from '@/types';
import { ArrowLeft, Target, Shield, BookOpen } from 'lucide-react';

const SystemDetail = () => {
  const { id } = useParams<{ id: string }>();
  const data = id ? getSystemWithPerson(id) : undefined;

  if (!data) {
    return <AppLayout><div className="p-4 text-center">找不到此交易系統</div></AppLayout>;
  }

  const { system, person } = data;
  const isAdvisor = person.role === PersonRole.ADVISOR;

  return (
    <AppLayout>
      <div className="p-4 space-y-4">
        <Link to="/app" className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
          <ArrowLeft className="h-4 w-4" /> 返回首頁
        </Link>

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold mb-2">{system.name}</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{person.name}</span>
            <RoleBadge role={person.role} size="sm" />
          </div>
        </div>

        <p className="text-sm text-muted-foreground">{system.teachingIntro || system.description}</p>

        {/* Tags */}
        <div className="flex flex-wrap gap-2">
          {system.styleTags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          {system.holdingPeriod && <Badge variant="outline">持有週期: {system.holdingPeriod}</Badge>}
        </div>

        {/* Teaching Sections */}
        {system.teachingSections?.map((section, idx) => (
          <Card key={idx}>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-2 flex items-center gap-2">
                {idx === 0 && <Target className="h-4 w-4 text-primary" />}
                {idx === 1 && <BookOpen className="h-4 w-4 text-primary" />}
                {idx === 2 && <Shield className="h-4 w-4 text-warning" />}
                {section.title}
              </h2>
              <ul className="space-y-2">
                {section.bullets.map((bullet, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary">•</span> {bullet}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}

        {/* Usage Note */}
        <Card className={isAdvisor ? "bg-advisor-light/30 border-advisor/20" : "bg-mentor-light/30 border-mentor/20"}>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-2">使用說明</h2>
            <p className="text-sm text-muted-foreground">
              {isAdvisor 
                ? '本策略教學為投顧服務的一部分，實際採用前仍需評估個人風險承受度與適合度。'
                : '本策略教學來自歷史操作紀錄，所有案例至少延遲一週，僅用於學習與檢討，不構成即時投資建議。'
              }
            </p>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" asChild>
            <Link to="/app">回到我的服務</Link>
          </Button>
          <Button variant={isAdvisor ? 'advisor' : 'mentor'} className="flex-1" asChild>
            <Link to={isAdvisor ? '/app/signals' : '/app/journals'}>
              {isAdvisor ? '看即時訊號' : '看週記'}
            </Link>
          </Button>
        </div>
      </div>
    </AppLayout>
  );
};

export default SystemDetail;
