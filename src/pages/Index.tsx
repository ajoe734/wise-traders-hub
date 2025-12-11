import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, 
  Shield, 
  BookOpen, 
  Radio, 
  Calendar,
  CheckCircle,
  ArrowRight,
  Users,
  BarChart3,
  GraduationCap,
  ChevronDown,
  Zap,
  Target,
  LineChart
} from 'lucide-react';
import { WeeklyLimitUpLeaderboard, mockLeaderboardEntries } from '@/components/WeeklyLimitUpLeaderboard';
import heroMockup from '@/assets/hero-mockup.png';

const Index = () => {
  return (
    <PortalLayout>
      {/* Hero Section */}
      <section className="relative overflow-hidden min-h-[85vh] flex items-center">
        {/* Gradient Background - Red to Blue */}
        <div 
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, hsl(var(--advisor) / 0.08) 0%, hsl(var(--mentor) / 0.08) 100%)'
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/80" />
        
        <div className="container relative z-10 py-12 md:py-16">
          <div className="grid lg:grid-cols-[55%_45%] gap-8 lg:gap-12 items-center">
            {/* Left Column - Text Content */}
            <div className="animate-fade-in">
              <Badge variant="secondary" className="mb-4">
                專業投顧 × AI 教學系統
              </Badge>
              
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4">
                專業投顧 × 智慧 AI
              </h1>
              
              <p className="text-lg md:text-xl text-muted-foreground mb-6">
                使用 LINE 帳號登入，接收最即時的策略訊號通知
              </p>
              
              {/* Selling Points */}
              <ul className="space-y-3 mb-8">
                <li className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-advisor/10">
                    <Zap className="h-4 w-4 text-advisor" />
                  </div>
                  <span className="font-medium">即時訊號推播</span>
                </li>
                <li className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-advisor/10">
                    <Target className="h-4 w-4 text-advisor" />
                  </div>
                  <span className="font-medium">清楚的漲停邏輯與教學</span>
                </li>
                <li className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-mentor/10">
                    <LineChart className="h-4 w-4 text-mentor" />
                  </div>
                  <span className="font-medium">完整績效、回測與勝率統計</span>
                </li>
              </ul>
              
              {/* CTA Buttons - Left Aligned */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="xl" className="bg-gradient-to-r from-advisor to-advisor-dark hover:opacity-90 text-white shadow-lg" asChild>
                  <Link to="/experts">
                    開始探索
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
                <Button size="xl" variant="outline" className="bg-background/80 backdrop-blur-sm" asChild>
                  <Link to="/pricing">查看方案比較</Link>
                </Button>
              </div>
              
              {/* Hint Text */}
              <p className="text-sm text-muted-foreground mt-6 flex items-center gap-2">
                <ChevronDown className="h-4 w-4 animate-bounce" />
                下滑比較投顧分析師與實戰導師的服務內容
              </p>
            </div>
            
            {/* Right Column - Mockup Image */}
            <div className="relative animate-slide-up lg:animate-fade-in order-first lg:order-last">
              <div className="relative mx-auto max-w-[280px] lg:max-w-[360px]">
                {/* Glow Effect */}
                <div 
                  className="absolute -inset-4 rounded-[3rem] opacity-30 blur-2xl"
                  style={{
                    background: 'linear-gradient(135deg, hsl(var(--advisor) / 0.5) 0%, hsl(var(--mentor) / 0.5) 100%)'
                  }}
                />
                <img 
                  src={heroMockup} 
                  alt="投資訊號儀表板示意圖" 
                  className="relative z-10 w-full h-auto drop-shadow-2xl"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Two Service Lines */}
      <section className="py-16 md:py-24 bg-muted/30">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">選擇適合你的服務</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              我們提供兩種服務路線，滿足不同投資人的需求
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {/* Advisor Card */}
            <Card className="relative overflow-hidden border-2 border-advisor/20 hover:border-advisor/40 transition-colors">
              <div className="absolute top-0 left-0 right-0 h-1.5 gradient-advisor" />
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-advisor-light">
                    <Radio className="h-6 w-6 text-advisor" />
                  </div>
                  <Badge variant="advisor">投顧分析師</Badge>
                </div>
                <h3 className="text-xl font-semibold mb-3">
                  跟投顧分析師走完整策略
                </h3>
                <p className="text-muted-foreground mb-6">
                  即時策略訂閱、進階持股健檢，搭配清楚的風險與部位教學。
                  每一筆操作都有詳細的教學解說。
                </p>
                <ul className="space-y-2 mb-6">
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-advisor" />
                    即時策略訊號推播
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-advisor" />
                    每筆操作附帶教學說明
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-advisor" />
                    進階持股健檢報告（L2）
                  </li>
                </ul>
                <Button variant="advisor" className="w-full" asChild>
                  <Link to="/experts?role=advisor">
                    查看投顧分析師與方案
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Mentor Card */}
            <Card className="relative overflow-hidden border-2 border-mentor/20 hover:border-mentor/40 transition-colors">
              <div className="absolute top-0 left-0 right-0 h-1.5 gradient-mentor" />
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-mentor-light">
                    <BookOpen className="h-6 w-6 text-mentor" />
                  </div>
                  <Badge variant="mentor">實戰導師</Badge>
                </div>
                <h3 className="text-xl font-semibold mb-3">
                  跟實戰導師學實戰
                </h3>
                <p className="text-muted-foreground mb-6">
                  每週一次 T+7 實戰週記，完整拆解一週操作與風險思維。
                  所有內容至少延遲 7 天，僅供教學參考。
                </p>
                <ul className="space-y-2 mb-6">
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-mentor" />
                    每週實戰週記教學
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-mentor" />
                    完整操作邏輯拆解
                  </li>
                  <li className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-mentor" />
                    歷史案例深度學習
                  </li>
                </ul>
                <Button variant="mentor" className="w-full" asChild>
                  <Link to="/experts?role=coach">
                    查看實戰導師與週記方案
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Weekly Limit Up Leaderboard */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-8 max-w-5xl mx-auto items-start">
            <div>
              <Badge variant="advisor" className="mb-4">熱門排行</Badge>
              <h2 className="text-2xl md:text-3xl font-bold mb-4">
                本週漲停王排行榜
              </h2>
              <p className="text-muted-foreground mb-6">
                看看哪位投顧分析師本週捕捉最多漲停股！
                即時更新，展現真實戰績。
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-advisor" />
                  基於實際交易紀錄統計
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-advisor" />
                  每日盤後即時更新排名
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-advisor" />
                  公開透明的績效追蹤
                </li>
              </ul>
            </div>
            <WeeklyLimitUpLeaderboard entries={mockLeaderboardEntries} />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">如何開始？</h2>
            <p className="text-muted-foreground">四個簡單步驟，開始你的投資學習之旅</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {[
              {
                step: 1,
                icon: Users,
                title: '選擇投顧分析師或實戰導師',
                description: '瀏覽不同專家的介紹與投資風格'
              },
              {
                step: 2,
                icon: BarChart3,
                title: '選擇方案並訂閱',
                description: '根據需求選擇即時策略或週記教學'
              },
              {
                step: 3,
                icon: Radio,
                title: '使用 LINE 帳號登入',
                description: '接收最即時的訊號通知'
              },
              {
                step: 4,
                icon: GraduationCap,
                title: '建立自己的投資系統',
                description: '每週跟著實戰檢討，持續進步'
              }
            ].map((item) => (
              <Card key={item.step} variant="elevated" className="text-center">
                <CardContent className="p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto mb-4">
                    <item.icon className="h-6 w-6" />
                  </div>
                  <Badge variant="secondary" className="mb-3">
                    步驟 {item.step}
                  </Badge>
                  <h3 className="font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-16 md:py-24 bg-muted/30">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-3 gap-8 text-center">
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto mb-4">
                  <Shield className="h-7 w-7" />
                </div>
                <h3 className="font-semibold mb-2">合規經營</h3>
                <p className="text-sm text-muted-foreground">
                  投顧分析師持有合法執照，所有服務依法令規範辦理
                </p>
              </div>
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto mb-4">
                  <GraduationCap className="h-7 w-7" />
                </div>
                <h3 className="font-semibold mb-2">教育為本</h3>
                <p className="text-sm text-muted-foreground">
                  每筆操作都是教學機會，幫助你建立自己的判斷能力
                </p>
              </div>
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mx-auto mb-4">
                  <Calendar className="h-7 w-7" />
                </div>
                <h3 className="font-semibold mb-2">透明揭露</h3>
                <p className="text-sm text-muted-foreground">
                  實戰導師內容至少 T+7 延遲，明確區分即時與教學
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              準備好開始了嗎？
            </h2>
            <p className="text-muted-foreground mb-8">
              立即註冊，探索適合你的投顧分析師或實戰導師
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="xl" variant="hero" asChild>
                <Link to="/auth/register">
                  免費註冊
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              <Button size="xl" variant="outline" asChild>
                <Link to="/experts">瀏覽所有專家</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
};

export default Index;
