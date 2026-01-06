import { UnifiedAppLayout } from '@/components/layouts/UnifiedAppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/ui/section-header';
import { FeatureCard } from '@/components/ui/feature-card';
import { GlowProgress } from '@/components/ui/glow-progress';
import { 
  GraduationCap, 
  Play,
  Lock,
  CheckCircle2,
  Clock,
  ChevronRight,
  BookOpen,
  Trophy,
  Flame,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Mock course data
const courses = [
  {
    id: 'course-1',
    title: '漲停8招入門班',
    description: '從零開始學習漲停板選股技巧',
    instructor: '趙彭博',
    totalLessons: 12,
    completedLessons: 12,
    duration: '3 小時',
    status: 'completed' as const,
    thumbnail: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=300&h=200&fit=crop',
  },
  {
    id: 'course-2',
    title: '4有指標實戰應用',
    description: '深入解析「有漲、有人、有人買、有大人買」',
    instructor: '趙彭博',
    totalLessons: 15,
    completedLessons: 8,
    duration: '4.5 小時',
    status: 'in_progress' as const,
    thumbnail: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=300&h=200&fit=crop',
  },
  {
    id: 'course-3',
    title: '當沖實戰進階班',
    description: '掌握盤中快速判斷與風控技巧',
    instructor: '趙彭博',
    totalLessons: 18,
    completedLessons: 0,
    duration: '6 小時',
    status: 'locked' as const,
    thumbnail: 'https://images.unsplash.com/photo-1642790106117-e829e14a795f?w=300&h=200&fit=crop',
  },
  {
    id: 'course-4',
    title: '心態與紀律養成',
    description: '建立穩定獲利的交易心態',
    instructor: '趙彭博',
    totalLessons: 10,
    completedLessons: 0,
    duration: '2.5 小時',
    status: 'locked' as const,
    thumbnail: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=300&h=200&fit=crop',
  },
];

// Learning stats
const learningStats = {
  totalCourses: 4,
  completedCourses: 1,
  totalLessons: 55,
  completedLessons: 20,
  totalHours: 16,
  watchedHours: 5.5,
  streak: 7,
};

export default function Courses() {
  const getStatusBadge = (status: 'completed' | 'in_progress' | 'locked') => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-success text-white border-0">已完成</Badge>;
      case 'in_progress':
        return <Badge className="bg-learning-accent text-white border-0">學習中</Badge>;
      case 'locked':
        return <Badge variant="outline" className="text-muted-foreground border-foreground/20">未解鎖</Badge>;
    }
  };

  const getStatusIcon = (status: 'completed' | 'in_progress' | 'locked') => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-6 w-6 text-success drop-shadow-[0_0_8px_hsl(var(--success)/0.6)]" />;
      case 'in_progress':
        return <Play className="h-6 w-6 text-learning-accent drop-shadow-[0_0_8px_hsl(var(--learning-accent)/0.6)]" />;
      case 'locked':
        return <Lock className="h-6 w-6 text-muted-foreground" />;
    }
  };

  const progressPercent = Math.round((learningStats.completedLessons / learningStats.totalLessons) * 100);

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-learning-accent to-learning-accent/70 flex items-center justify-center shadow-[0_0_20px_-5px_hsl(var(--learning-accent)/0.5)]">
                <GraduationCap className="h-6 w-6 text-white" />
              </div>
            </div>
            <div>
              <p className="text-xs text-learning-accent font-semibold tracking-wider uppercase">課程系統</p>
              <h1 className="text-xl font-bold">系統性的學習路徑</h1>
            </div>
          </div>
        </div>

        {/* Learning Stats - Gaming Style */}
        <FeatureCard theme="learning" variant="highlight" className="p-5">
          <div className="grid grid-cols-3 gap-4 text-center mb-5">
            <div className="relative">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Trophy className="h-5 w-5 text-amber-500" />
                <span className="text-2xl font-bold drop-shadow-[0_0_8px_hsl(38_92%_50%/0.5)]">
                  {learningStats.streak}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">連續學習</p>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1 mb-1">
                <Flame className="h-5 w-5 text-learning-accent" />
                <span className="text-2xl font-bold">{learningStats.completedLessons}</span>
                <span className="text-sm text-muted-foreground">/{learningStats.totalLessons}</span>
              </div>
              <p className="text-xs text-muted-foreground">已完成課程</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{learningStats.watchedHours}h</p>
              <p className="text-xs text-muted-foreground">學習時數</p>
            </div>
          </div>
          
          {/* XP Bar Style Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-learning-accent" />
                經驗值
              </span>
              <span className="font-bold text-learning-accent">{progressPercent}%</span>
            </div>
            <GlowProgress value={progressPercent} theme="learning" size="lg" animated />
          </div>
        </FeatureCard>

        {/* Continue Learning */}
        {courses.find(c => c.status === 'in_progress') && (
          <section>
            <SectionHeader
              number="01"
              tag="進行中"
              title="繼續學習"
              icon={<Play className="h-3.5 w-3.5" />}
              theme="learning"
              className="mb-4"
            />
            
            {courses.filter(c => c.status === 'in_progress').map(course => (
              <FeatureCard key={course.id} theme="learning" variant="glow" className="overflow-hidden">
                <div className="flex">
                  <div className="relative w-28 flex-shrink-0">
                    <img 
                      src={course.thumbnail} 
                      alt={course.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent to-background/80" />
                  </div>
                  <div className="p-4 flex-1">
                    <p className="font-semibold line-clamp-1">{course.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {course.completedLessons}/{course.totalLessons} 課
                    </p>
                    <GlowProgress 
                      value={(course.completedLessons / course.totalLessons) * 100}
                      theme="learning"
                      size="sm"
                      className="mt-2"
                    />
                    <Button 
                      size="sm" 
                      className="w-full mt-3 bg-learning-accent hover:bg-learning-accent/90 shadow-[0_0_12px_-3px_hsl(var(--learning-accent)/0.5)]"
                    >
                      繼續觀看
                    </Button>
                  </div>
                </div>
              </FeatureCard>
            ))}
          </section>
        )}

        {/* All Courses */}
        <section>
          <SectionHeader
            number="02"
            tag="課程列表"
            title="全部課程"
            icon={<BookOpen className="h-3.5 w-3.5" />}
            theme="learning"
            className="mb-4"
          />
          
          <div className="space-y-3">
            {courses.map((course, index) => (
              <FeatureCard 
                key={course.id}
                theme="learning"
                className={cn(
                  "overflow-hidden transition-all",
                  course.status === 'locked' && "opacity-60"
                )}
              >
                <div className="flex">
                  <div className="relative w-28 flex-shrink-0">
                    <img 
                      src={course.thumbnail} 
                      alt={course.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      {getStatusIcon(course.status)}
                    </div>
                    {/* Number decoration */}
                    <span className="absolute bottom-1 left-1 text-2xl font-bold text-white/20">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="p-4 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {getStatusBadge(course.status)}
                        <p className="font-semibold text-sm mt-1.5 line-clamp-1">{course.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {course.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {course.duration}
                          </span>
                          <span>·</span>
                          <span>{course.totalLessons} 課</span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </div>
                    
                    {course.status !== 'locked' && (
                      <div className="mt-3">
                        <GlowProgress 
                          value={(course.completedLessons / course.totalLessons) * 100}
                          theme={course.status === 'completed' ? 'success' : 'learning'}
                          size="sm"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </FeatureCard>
            ))}
          </div>
        </section>
      </div>
    </UnifiedAppLayout>
  );
}
