import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SectionHeader } from '@/components/ui/section-header';
import { FeatureCard } from '@/components/ui/feature-card';
import { GlowProgress } from '@/components/ui/glow-progress';
import { 
  BookOpen, ChevronRight, GraduationCap, FileText, Lightbulb, Target, TrendingUp,
  Calendar, Clock, CheckCircle2, Compass, Sparkles, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface LearningDashboardProps {
  subscriptions: any[];
  userName?: string;
}

// Mock learning progress data (Courses/Library are static for now)
const mockLearningProgress = {
  currentChapter: '漲停8招 第3章：量價分析',
  progressPercent: 45,
  completedLessons: 12,
  totalLessons: 27,
  lastAccessedAt: new Date('2025-01-05T14:30:00'),
};

const roadmapStages = [
  { id: 'beginner', label: '入門', status: 'completed' as const, lessons: 5, number: '01' },
  { id: 'intermediate', label: '進階', status: 'current' as const, lessons: 8, number: '02' },
  { id: 'mindset', label: '心法', status: 'locked' as const, lessons: 7, number: '03' },
  { id: 'practice', label: '實戰', status: 'locked' as const, lessons: 7, number: '04' },
];

const contentCategories = [
  { id: 'mindset', label: '心法', icon: Lightbulb, count: 12, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  { id: 'cases', label: '案例', icon: Target, count: 24, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  { id: 'framework', label: '框架', icon: TrendingUp, count: 8, color: 'text-learning-accent', bg: 'bg-learning-accent/10' },
  { id: 'review', label: '復盤', icon: FileText, count: 16, color: 'text-purple-500', bg: 'bg-purple-500/10' },
];

export function LearningDashboard({ subscriptions, userName }: LearningDashboardProps) {
  // No journals table yet - show empty state for journals, keep static course/learning data
  const primaryMentor = subscriptions[0]?.person || subscriptions[0]?.expert;

  return (
    <div className="p-4 space-y-6 pb-24">
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-learning-accent to-learning-accent/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--learning-accent)/0.5)]">
                <Compass className="h-6 w-6 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-learning-accent animate-pulse" />
            </div>
            <div>
              <p className="text-xs text-learning-accent font-semibold tracking-wider uppercase">修煉派 · LEARNING</p>
              <h1 className="text-xl font-bold">修煉之道，持之以恆</h1>
            </div>
          </div>
        </div>
      </div>

      {/* Continue Learning */}
      <FeatureCard theme="learning" variant="highlight" className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-5 h-5 text-learning-accent" />
          <span className="font-semibold">繼續學習</span>
          <Sparkles className="w-4 h-4 text-learning-accent ml-auto animate-pulse" />
        </div>
        <div className="space-y-3">
          <p className="font-medium text-lg">{mockLearningProgress.currentChapter}</p>
          <GlowProgress value={mockLearningProgress.completedLessons} max={mockLearningProgress.totalLessons} theme="learning" size="md" showLabel label={`${mockLearningProgress.completedLessons}/${mockLearningProgress.totalLessons} 課`} />
          <Button className="w-full bg-learning-accent hover:bg-learning-accent/90 shadow-[0_0_15px_-3px_hsl(var(--learning-accent)/0.5)]">
            繼續閱讀<ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </FeatureCard>

      {/* This Week's New Content - empty since no journals table */}
      <section>
        <SectionHeader number="01" tag="本週更新" title="本週新內容" icon={<Calendar className="h-3.5 w-3.5" />} theme="learning" className="mb-4" />
        <div className="flex items-center justify-end -mt-8 mb-3">
          <Link to="/app/journals" className="text-sm text-learning-accent flex items-center hover:underline">查看全部 <ChevronRight className="w-4 h-4" /></Link>
        </div>
        <FeatureCard theme="learning" className="p-6 text-center">
          <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground">本週暫無新週記</p>
        </FeatureCard>
      </section>

      {/* Learning Roadmap */}
      <section>
        <SectionHeader number="02" tag="修煉路徑" title="學習路線圖" icon={<TrendingUp className="h-3.5 w-3.5" />} theme="learning" className="mb-4" />
        <FeatureCard theme="learning" className="p-5">
          <div className="flex items-center gap-1 mb-6">
            {roadmapStages.map((stage, index) => (
              <div key={stage.id} className="flex-1 flex items-center">
                <div className={cn("flex-1 h-2.5 rounded-full transition-all", stage.status === 'completed' && "bg-learning-accent shadow-[0_0_8px_2px_hsl(var(--learning-accent)/0.4)]", stage.status === 'current' && "bg-learning-accent/50", stage.status === 'locked' && "bg-foreground/10")} />
                {index < roadmapStages.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground mx-0.5 flex-shrink-0" />}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {roadmapStages.map((stage) => (
              <div key={stage.id} className={cn("relative text-center p-3 rounded-xl transition-all", stage.status === 'completed' && "bg-learning-accent/10 border border-learning-accent/30", stage.status === 'current' && "bg-learning-accent/5 ring-2 ring-learning-accent/50", stage.status === 'locked' && "bg-foreground/[0.03] border border-foreground/[0.08] opacity-60")}>
                <span className="absolute -top-1 -left-0.5 text-2xl font-bold opacity-10 text-learning-accent">{stage.number}</span>
                <div className="flex justify-center mb-1 relative z-10">
                  {stage.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-learning-accent" />}
                  {stage.status === 'current' && <div className="w-5 h-5 rounded-full border-2 border-learning-accent bg-learning-accent/30 animate-pulse" />}
                  {stage.status === 'locked' && <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />}
                </div>
                <p className={cn("text-xs font-semibold relative z-10", stage.status === 'locked' ? 'text-muted-foreground' : 'text-foreground')}>{stage.label}</p>
                <p className="text-xs text-muted-foreground">{stage.lessons} 課</p>
              </div>
            ))}
          </div>
          <div className="text-center pt-4 mt-4 border-t border-foreground/[0.08]">
            <p className="text-sm text-muted-foreground">目前進度：<span className="font-bold text-learning-accent text-lg">{mockLearningProgress.progressPercent}%</span></p>
          </div>
        </FeatureCard>
      </section>

      {/* All Content Categories */}
      <section>
        <SectionHeader number="03" tag="知識分類" title="全部內容" icon={<BookOpen className="h-3.5 w-3.5" />} theme="learning" className="mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {contentCategories.map((category) => (
            <FeatureCard key={category.id} theme="learning" className="p-4">
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", category.bg)}>
                  <category.icon className={cn("w-5 h-5", category.color)} />
                </div>
                <div><p className="font-medium">{category.label}</p><p className="text-xs text-muted-foreground">{category.count} 篇</p></div>
              </div>
            </FeatureCard>
          ))}
        </div>
      </section>

      {/* Quick Links */}
      <section className="space-y-2 pt-2">
        <Link to="/app/account" className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors">
          <span className="text-sm text-muted-foreground">管理我的訂閱</span><ChevronRight className="w-4 h-4 text-muted-foreground" />
        </Link>
        <Link to="/experts" className="flex items-center justify-between p-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors">
          <span className="text-sm text-muted-foreground">探索更多導師</span><ChevronRight className="w-4 h-4 text-muted-foreground" />
        </Link>
      </section>
    </div>
  );
}
