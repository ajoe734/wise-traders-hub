import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  BookOpen, 
  ChevronRight, 
  GraduationCap, 
  FileText,
  Lightbulb,
  Target,
  TrendingUp,
  Calendar,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { SubscriptionWithDetails } from '@/types';
import { getJournalsForUser } from '@/data/mockData';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';

interface LearningDashboardProps {
  subscriptions: SubscriptionWithDetails[];
  userName?: string;
}

// Mock learning progress data
const mockLearningProgress = {
  currentChapter: '漲停8招 第3章：量價分析',
  progressPercent: 45,
  completedLessons: 12,
  totalLessons: 27,
  lastAccessedAt: new Date('2025-01-05T14:30:00'),
};

// Learning roadmap stages
const roadmapStages = [
  { id: 'beginner', label: '入門', status: 'completed' as const, lessons: 5 },
  { id: 'intermediate', label: '進階', status: 'current' as const, lessons: 8 },
  { id: 'mindset', label: '心法', status: 'locked' as const, lessons: 7 },
  { id: 'practice', label: '實戰', status: 'locked' as const, lessons: 7 },
];

// Content categories
const contentCategories = [
  { id: 'mindset', label: '心法', icon: Lightbulb, count: 12, color: 'bg-amber-500' },
  { id: 'cases', label: '案例', icon: Target, count: 24, color: 'bg-emerald-500' },
  { id: 'framework', label: '框架', icon: TrendingUp, count: 8, color: 'bg-blue-500' },
  { id: 'review', label: '復盤', icon: FileText, count: 16, color: 'bg-purple-500' },
];

export function LearningDashboard({ subscriptions, userName }: LearningDashboardProps) {
  // Get journals for this user (as weekly content)
  const journals = getJournalsForUser('user-1');
  const thisWeekJournals = journals.slice(0, 2); // Most recent as "this week"
  
  // Primary mentor from subscriptions
  const primaryMentor = subscriptions[0]?.person;

  return (
    <div className="p-4 space-y-6 pb-24">
      {/* Header with blue theme indicator */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">
              <GraduationCap className="w-3 h-3 mr-1" />
              修煉派
            </Badge>
          </div>
          <h1 className="text-xl font-bold">
            嗨，{userName || '學員'}
          </h1>
          <p className="text-sm text-muted-foreground">繼續你的修煉之路</p>
        </div>
        
        {/* Primary Mentor Avatar */}
        {primaryMentor && (
          <Link to={`/line/${primaryMentor.slug}/home`}>
            <Avatar className="h-12 w-12 border-2 border-blue-500/30">
              <AvatarImage src={primaryMentor.avatarUrl} alt={primaryMentor.name} />
              <AvatarFallback>{primaryMentor.name[0]}</AvatarFallback>
            </Avatar>
          </Link>
        )}
      </div>

      {/* Continue Learning - Most Important */}
      <Card className="border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-500" />
            繼續學習
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="font-medium">{mockLearningProgress.currentChapter}</p>
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
              <Clock className="w-3 h-3" />
              上次學習：{format(mockLearningProgress.lastAccessedAt, 'MM/dd HH:mm', { locale: zhTW })}
            </p>
          </div>
          
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">學習進度</span>
              <span className="font-medium">{mockLearningProgress.completedLessons}/{mockLearningProgress.totalLessons} 課</span>
            </div>
            <Progress value={mockLearningProgress.progressPercent} className="h-2" />
          </div>
          
          <Button className="w-full bg-blue-600 hover:bg-blue-700">
            繼續閱讀
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </CardContent>
      </Card>

      {/* This Week's New Content */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-500" />
            本週新內容
          </h2>
          <Link to="/app/journals" className="text-sm text-blue-600 flex items-center">
            查看全部 <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        
        <div className="space-y-2">
          {thisWeekJournals.map((journal) => (
            <Link 
              key={journal.id} 
              to={`/line/${journal.person.slug}/home`}
            >
              <Card className="hover:bg-accent/50 transition-colors">
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs">
                          週記
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(journal.weekStart), 'MM/dd', { locale: zhTW })} - {format(new Date(journal.weekEnd), 'MM/dd', { locale: zhTW })}
                        </span>
                      </div>
                      <p className="font-medium text-sm truncate">{journal.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {journal.summary}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Learning Roadmap - Super Important */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            學習路線圖
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Roadmap Progress Bar */}
          <div className="flex items-center gap-1">
            {roadmapStages.map((stage, index) => (
              <div key={stage.id} className="flex-1 flex items-center">
                <div 
                  className={`
                    flex-1 h-2 rounded-full
                    ${stage.status === 'completed' ? 'bg-blue-500' : ''}
                    ${stage.status === 'current' ? 'bg-blue-500/50' : ''}
                    ${stage.status === 'locked' ? 'bg-muted' : ''}
                  `}
                />
                {index < roadmapStages.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground mx-0.5" />
                )}
              </div>
            ))}
          </div>
          
          {/* Stage Labels */}
          <div className="grid grid-cols-4 gap-2">
            {roadmapStages.map((stage) => (
              <div 
                key={stage.id}
                className={`
                  text-center p-2 rounded-lg
                  ${stage.status === 'completed' ? 'bg-blue-500/10' : ''}
                  ${stage.status === 'current' ? 'bg-blue-500/5 ring-1 ring-blue-500/30' : ''}
                  ${stage.status === 'locked' ? 'bg-muted/50 opacity-60' : ''}
                `}
              >
                <div className="flex justify-center mb-1">
                  {stage.status === 'completed' && (
                    <CheckCircle2 className="w-4 h-4 text-blue-500" />
                  )}
                  {stage.status === 'current' && (
                    <div className="w-4 h-4 rounded-full border-2 border-blue-500 bg-blue-500/20" />
                  )}
                  {stage.status === 'locked' && (
                    <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
                  )}
                </div>
                <p className={`text-xs font-medium ${stage.status === 'locked' ? 'text-muted-foreground' : ''}`}>
                  {stage.label}
                </p>
                <p className="text-xs text-muted-foreground">{stage.lessons} 課</p>
              </div>
            ))}
          </div>
          
          <div className="text-center pt-2">
            <p className="text-sm text-muted-foreground">
              目前進度：<span className="font-medium text-foreground">{mockLearningProgress.progressPercent}%</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* All Content Categories */}
      <div className="space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-500" />
          全部內容
        </h2>
        
        <div className="grid grid-cols-2 gap-3">
          {contentCategories.map((category) => (
            <Card key={category.id} className="hover:bg-accent/50 transition-colors cursor-pointer">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg ${category.color}/10 flex items-center justify-center`}>
                    <category.icon className={`w-5 h-5 ${category.color.replace('bg-', 'text-')}`} />
                  </div>
                  <div>
                    <p className="font-medium">{category.label}</p>
                    <p className="text-xs text-muted-foreground">{category.count} 篇</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* My Mentors */}
      <div className="space-y-3">
        <h2 className="font-semibold">我的導師</h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {subscriptions.map((sub) => (
            <Link 
              key={sub.id} 
              to={`/line/${sub.person.slug}/home`}
              className="flex-shrink-0"
            >
              <Card className="w-32 hover:bg-accent/50 transition-colors">
                <CardContent className="p-3 text-center">
                  <Avatar className="h-12 w-12 mx-auto mb-2 border-2 border-blue-500/30">
                    <AvatarImage src={sub.person.avatarUrl} alt={sub.person.name} />
                    <AvatarFallback>{sub.person.name[0]}</AvatarFallback>
                  </Avatar>
                  <p className="font-medium text-sm">{sub.person.name}</p>
                  <p className="text-xs text-muted-foreground">導師</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="space-y-2 pt-2">
        <Link to="/account/subscriptions" className="block">
          <Button variant="ghost" className="w-full justify-between text-muted-foreground">
            管理我的訂閱
            <ChevronRight className="w-4 h-4" />
          </Button>
        </Link>
        <Link to="/experts" className="block">
          <Button variant="ghost" className="w-full justify-between text-muted-foreground">
            探索更多導師
            <ChevronRight className="w-4 h-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
