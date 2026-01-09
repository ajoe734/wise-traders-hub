import { useParams } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug } from '@/data/mockData';
import { PersonRole } from '@/types';
import { Trophy } from 'lucide-react';
import { MonthlyLimitUpRecord } from '@/components/strategy/MonthlyLimitUpRecord';

const LineHistory = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  const isAdvisor = expert?.role === PersonRole.ADVISOR;

  return (
    <LineLayout>
      {expert && (
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="mb-4">
          <Badge variant={isAdvisor ? 'advisor' : 'mentor'} className="mb-2">
            歷史戰績
          </Badge>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            漲停捕捉紀錄
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {expert.name} • 近 6 個月戰績統計
          </p>
        </div>

        {/* T+7 Notice for Mentors */}
        {!isAdvisor && (
          <div className="p-3 bg-mentor/5 rounded-lg text-sm">
            <p className="text-mentor font-medium">📋 T+7 教學用資料</p>
            <p className="text-muted-foreground text-xs mt-1">
              以下為一週前的策略示範帳戶實際交易紀錄，僅供教學參考。
            </p>
          </div>
        )}

        {/* Monthly Records */}
        <MonthlyLimitUpRecord />

        {/* Compliance */}
        <div className="compliance-disclaimer">
          過去績效不代表未來表現，投資有風險，請謹慎評估。
          {!isAdvisor && '本頁內容僅供教學參考，不構成投資建議。'}
        </div>
      </div>
      )}
    </LineLayout>
  );
};

export default LineHistory;
