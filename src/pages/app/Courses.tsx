import { Link } from 'react-router-dom';
import { LearningLayout } from '@/components/layouts/LearningLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { 
  GraduationCap, 
  Play,
  Lock,
  CheckCircle2,
  Clock,
  ChevronRight,
  BookOpen,
  Star,
  Trophy
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
        return <Badge className="bg-success text-white">已完成</Badge>;
      case 'in_progress':
        return <Badge className="bg-learning-accent text-white">學習中</Badge>;
      case 'locked':
        return <Badge variant="outline" className="text-muted-foreground">未解鎖</Badge>;
    }
  };

  const getStatusIcon = (status: 'completed' | 'in_progress' | 'locked') => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case 'in_progress':
        return <Play className="h-5 w-5 text-learning-accent" />;
      case 'locked':
        return <Lock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  return (
    <LearningLayout>
      <div className="p-4 space-y-6 max-w-lg mx-auto pb-24">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-learning-accent" />
              課程系統
            </h1>
            <p className="text-sm text-muted-foreground mt-1">系統性的學習路徑</p>
          </div>
        </div>

        {/* Learning Stats */}
        <Card className="border-learning-accent/20 bg-gradient-to-br from-learning-accent/5 to-transparent">
          <CardContent className="p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <span className="text-2xl font-bold">{learningStats.streak}</span>
                </div>
                <p className="text-xs text-muted-foreground">連續學習天數</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{learningStats.completedLessons}/{learningStats.totalLessons}</p>
                <p className="text-xs text-muted-foreground">已完成課程</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{learningStats.watchedHours}h</p>
                <p className="text-xs text-muted-foreground">學習時數</p>
              </div>
            </div>
            
            {/* Overall Progress */}
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">整體進度</span>
                <span className="font-medium">{Math.round((learningStats.completedLessons / learningStats.totalLessons) * 100)}%</span>
              </div>
              <Progress 
                value={(learningStats.completedLessons / learningStats.totalLessons) * 100} 
                className="h-2"
              />
            </div>
          </CardContent>
        </Card>

        {/* Continue Learning */}
        {courses.find(c => c.status === 'in_progress') && (
          <section className="space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Play className="h-4 w-4 text-learning-accent" />
              繼續學習
            </h2>
            {courses.filter(c => c.status === 'in_progress').map(course => (
              <Card key={course.id} className="overflow-hidden border-learning-accent/30">
                <div className="flex">
                  <img 
                    src={course.thumbnail} 
                    alt={course.title}
                    className="w-24 h-24 object-cover"
                  />
                  <CardContent className="p-3 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm line-clamp-1">{course.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {course.completedLessons}/{course.totalLessons} 課
                        </p>
                        <Progress 
                          value={(course.completedLessons / course.totalLessons) * 100}
                          className="h-1.5 mt-2"
                        />
                      </div>
                    </div>
                    <Button size="sm" className="w-full mt-2 bg-learning-accent hover:bg-learning-accent/90">
                      繼續觀看
                    </Button>
                  </CardContent>
                </div>
              </Card>
            ))}
          </section>
        )}

        {/* All Courses */}
        <section className="space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-learning-accent" />
            全部課程
          </h2>
          
          <div className="space-y-3">
            {courses.map(course => (
              <Card 
                key={course.id}
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
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      {getStatusIcon(course.status)}
                    </div>
                  </div>
                  <CardContent className="p-3 flex-1">
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
                      <div className="mt-2">
                        <Progress 
                          value={(course.completedLessons / course.totalLessons) * 100}
                          className="h-1"
                        />
                      </div>
                    )}
                  </CardContent>
                </div>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </LearningLayout>
  );
}
