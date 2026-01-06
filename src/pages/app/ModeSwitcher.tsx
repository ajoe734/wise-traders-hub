import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { SubscriptionWithDetails, PlanType } from '@/types';
import { 
  Radio, 
  BookOpen, 
  ChevronRight, 
  Target, 
  TrendingUp, 
  Calendar,
  GraduationCap
} from 'lucide-react';

interface ModeSwitcherProps {
  advisorSubs: SubscriptionWithDetails[];
  mentorSubs: SubscriptionWithDetails[];
  userName?: string;
}

export function ModeSwitcher({ advisorSubs, mentorSubs, userName }: ModeSwitcherProps) {
  // Get primary expert for each mode (first one for now)
  const primaryAdvisorSub = advisorSubs[0];
  const primaryMentorSub = mentorSubs[0];

  return (
    <div className="p-4 space-y-6 max-w-lg mx-auto">
      {/* Greeting */}
      <div className="text-center animate-fade-in pt-4">
        <h1 className="text-2xl font-bold mb-2">
          嗨，{userName || '會員'}
        </h1>
        <p className="text-muted-foreground text-lg">你今天要...</p>
      </div>

      {/* Mode Cards */}
      <div className="space-y-4 animate-slide-up">
        {/* 跟單派 - Signals Mode */}
        <Link to={`/line/${primaryAdvisorSub.person.slug}/home`}>
          <Card className="border-2 border-advisor/30 hover:border-advisor/60 transition-all hover:shadow-lg hover:shadow-advisor/10 group cursor-pointer">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className="w-14 h-14 rounded-xl bg-advisor/10 flex items-center justify-center flex-shrink-0 group-hover:bg-advisor/20 transition-colors">
                  <Target className="h-7 w-7 text-advisor" />
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-bold text-advisor">跟單派</h2>
                    <Badge variant="advisor-light" className="text-[10px]">實戰操作</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    查看即時訊號、管理持倉、追蹤績效
                  </p>
                  
                  {/* Expert Preview */}
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <img 
                      src={primaryAdvisorSub.person.avatarUrl || '/placeholder.svg'} 
                      alt={primaryAdvisorSub.person.name} 
                      className="h-8 w-8 rounded-full object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{primaryAdvisorSub.person.name}</span>
                        <RoleBadge role={primaryAdvisorSub.person.role} size="sm" />
                      </div>
                      {advisorSubs.length > 1 && (
                        <span className="text-xs text-muted-foreground">
                          +{advisorSubs.length - 1} 位分析師
                        </span>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-advisor transition-colors" />
                  </div>
                  
                  {/* Quick Stats Preview */}
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Radio className="h-3.5 w-3.5" />
                      即時訊號
                    </span>
                    <span className="flex items-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5" />
                      績效追蹤
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* 修煉派 - Learning Mode */}
        <Link to={`/line/${primaryMentorSub.person.slug}/home`}>
          <Card className="border-2 border-mentor/30 hover:border-mentor/60 transition-all hover:shadow-lg hover:shadow-mentor/10 group cursor-pointer">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className="w-14 h-14 rounded-xl bg-mentor/10 flex items-center justify-center flex-shrink-0 group-hover:bg-mentor/20 transition-colors">
                  <BookOpen className="h-7 w-7 text-mentor" />
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-bold text-mentor">修煉派</h2>
                    <Badge variant="mentor-light" className="text-[10px]">學習進修</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    閱讀週記、學習心法、追蹤學習進度
                  </p>
                  
                  {/* Expert Preview */}
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                    <img 
                      src={primaryMentorSub.person.avatarUrl || '/placeholder.svg'} 
                      alt={primaryMentorSub.person.name} 
                      className="h-8 w-8 rounded-full object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{primaryMentorSub.person.name}</span>
                        <RoleBadge role={primaryMentorSub.person.role} size="sm" />
                      </div>
                      {mentorSubs.length > 1 && (
                        <span className="text-xs text-muted-foreground">
                          +{mentorSubs.length - 1} 位導師
                        </span>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-mentor transition-colors" />
                  </div>
                  
                  {/* Quick Stats Preview */}
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      週記教學
                    </span>
                    <span className="flex items-center gap-1">
                      <GraduationCap className="h-3.5 w-3.5" />
                      學習路線
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Quick Links */}
      <div className="pt-4 space-y-2 animate-fade-in" style={{ animationDelay: '0.2s' }}>
        <Link 
          to="/account/subscriptions" 
          className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
        >
          <span className="text-sm text-muted-foreground">管理訂閱</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link 
          to="/experts" 
          className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
        >
          <span className="text-sm text-muted-foreground">探索更多專家</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}

export default ModeSwitcher;
