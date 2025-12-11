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
import heroDashboardMockup from '@/assets/hero-dashboard-mockup.png';

const Index = () => {
  return (
    <PortalLayout>
      {/* Hero Section - Minimalist */}
      <section className="relative overflow-hidden min-h-[75vh] flex items-center">
        {/* Gradient Background - Light Gray to White */}
        <div className="absolute inset-0 gradient-hero" />
        
        <div className="container relative z-10 py-section">
          <div className="grid lg:grid-cols-[55%_45%] gap-xl lg:gap-3xl items-center">
            {/* Left Column - Text Content */}
            <div className="animate-fade-in">
              <h1 className="text-h1 tracking-tight mb-md text-foreground">
                專業投顧 × 智慧 AI
              </h1>
              
              <p className="text-base md:text-lg text-muted-foreground mb-lg max-w-lg">
                透過 LINE 直接接收策略訊號、漲停邏輯與完整教學，把看盤時間變成明確、可複製的投資流程。
              </p>
              
              {/* Selling Points */}
              <ul className="space-y-sm mb-lg">
                <li className="flex items-center gap-sm">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-foreground">即時推播，掌握每一次價量關鍵</span>
                </li>
                <li className="flex items-center gap-sm">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                    <Target className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-foreground">清楚的漲停策略與教學步驟</span>
                </li>
                <li className="flex items-center gap-sm">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                    <LineChart className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-foreground">回測、勝率、績效全透明</span>
                </li>
              </ul>
              
              {/* CTA Buttons - Left Aligned */}
              <div className="flex flex-col sm:flex-row gap-sm">
                <Button size="xl" asChild>
                  <Link to="/experts">
                    開始探索
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
                <Button size="xl" variant="secondary" asChild>
                  <Link to="/pricing">查看方案比較</Link>
                </Button>
              </div>
              
              {/* Hint Text */}
              <p className="text-sm text-muted-foreground mt-md flex items-center gap-2">
                <ChevronDown className="h-4 w-4 animate-bounce" />
                下滑比較投顧分析師與實戰導師
              </p>
            </div>
            
            {/* Right Column - Dashboard Mockup */}
            <div className="relative order-first lg:order-last flex justify-center lg:justify-end">
              <div className="relative">
                <img 
                  src={heroDashboardMockup} 
                  alt="投資訊號儀表板示意圖" 
                  className="relative z-10 w-full max-w-[260px] lg:max-w-[320px] h-auto animate-float"
                  style={{
                    filter: 'drop-shadow(0 20px 40px rgba(0, 0, 0, 0.12))'
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Two Service Lines */}
      <section className="py-section bg-card">
        <div className="container">
          <div className="text-center mb-xl">
            <h2 className="text-h2 mb-md text-foreground">選擇適合你的服務</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              我們提供兩種服務路線，滿足不同投資人的需求
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-lg max-w-5xl mx-auto">
            {/* Advisor Card */}
            <Card className="relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-12 bg-foreground/5" />
              <CardContent className="p-card pt-4xl">
                <div className="flex items-center gap-sm mb-md">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                    <Radio className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <Badge variant="secondary">投顧分析師</Badge>
                </div>
                <h3 className="text-h3 mb-sm text-foreground">
                  跟投顧分析師走完整策略
                </h3>
                <p className="text-muted-foreground mb-lg">
                  即時策略訂閱、進階持股健檢，搭配清楚的風險與部位教學。
                  每一筆操作都有詳細的教學解說。
                </p>
                <ul className="space-y-xs mb-lg">
                  <li className="flex items-center gap-xs text-sm text-foreground">
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    即時策略訊號推播
                  </li>
                  <li className="flex items-center gap-xs text-sm text-foreground">
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    每筆操作附帶教學說明
                  </li>
                  <li className="flex items-center gap-xs text-sm text-foreground">
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    進階持股健檢報告（L2）
                  </li>
                </ul>
                <div className="flex gap-sm">
                  <Button className="flex-1" asChild>
                    <Link to="/experts?role=advisor">
                      查看方案
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                  <Button variant="secondary" asChild>
                    <Link to="/experts?role=advisor">了解更多</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Mentor Card */}
            <Card className="relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-12 bg-foreground/5" />
              <CardContent className="p-card pt-4xl">
                <div className="flex items-center gap-sm mb-md">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                    <BookOpen className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <Badge variant="secondary">實戰導師</Badge>
                </div>
                <h3 className="text-h3 mb-sm text-foreground">
                  跟實戰導師學實戰
                </h3>
                <p className="text-muted-foreground mb-lg">
                  每週一次 T+7 實戰週記，完整拆解一週操作與風險思維。
                  所有內容至少延遲 7 天，僅供教學參考。
                </p>
                <ul className="space-y-xs mb-lg">
                  <li className="flex items-center gap-xs text-sm text-foreground">
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    每週實戰週記教學
                  </li>
                  <li className="flex items-center gap-xs text-sm text-foreground">
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    完整操作邏輯拆解
                  </li>
                  <li className="flex items-center gap-xs text-sm text-foreground">
                    <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    歷史案例深度學習
                  </li>
                </ul>
                <div className="flex gap-sm">
                  <Button className="flex-1" asChild>
                    <Link to="/experts?role=coach">
                      查看方案
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                  <Button variant="secondary" asChild>
                    <Link to="/experts?role=coach">了解更多</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Weekly Limit Up Leaderboard */}
      <section className="py-section bg-background">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-xl max-w-5xl mx-auto items-start">
            <div>
              <Badge variant="secondary" className="mb-md">熱門排行</Badge>
              <h2 className="text-h2 mb-md text-foreground">
                本週漲停王排行榜
              </h2>
              <p className="text-muted-foreground mb-lg">
                看看哪位投顧分析師本週捕捉最多漲停股！
                即時更新，展現真實戰績。
              </p>
              <ul className="space-y-xs text-sm text-muted-foreground">
                <li className="flex items-center gap-xs">
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  基於實際交易紀錄統計
                </li>
                <li className="flex items-center gap-xs">
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  每日盤後即時更新排名
                </li>
                <li className="flex items-center gap-xs">
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  公開透明的績效追蹤
                </li>
              </ul>
            </div>
            <WeeklyLimitUpLeaderboard entries={mockLeaderboardEntries} />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-section bg-card">
        <div className="container">
          <div className="text-center mb-xl">
            <h2 className="text-h2 mb-md text-foreground">如何開始？</h2>
            <p className="text-muted-foreground">四個簡單步驟，開始你的投資學習之旅</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-lg max-w-5xl mx-auto">
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
                <CardContent className="p-card">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground mx-auto mb-md">
                    <item.icon className="h-6 w-6" />
                  </div>
                  <Badge variant="secondary" className="mb-sm">
                    步驟 {item.step}
                  </Badge>
                  <h4 className="text-h5 mb-xs text-foreground">{item.title}</h4>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-section bg-background">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-3 gap-xl text-center">
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-md bg-muted text-muted-foreground mx-auto mb-md">
                  <Shield className="h-7 w-7" />
                </div>
                <h4 className="text-h5 mb-xs text-foreground">合規經營</h4>
                <p className="text-sm text-muted-foreground">
                  投顧分析師持有合法執照，所有服務依法令規範辦理
                </p>
              </div>
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-md bg-muted text-muted-foreground mx-auto mb-md">
                  <GraduationCap className="h-7 w-7" />
                </div>
                <h4 className="text-h5 mb-xs text-foreground">教育為本</h4>
                <p className="text-sm text-muted-foreground">
                  每筆操作都是教學機會，幫助你建立自己的判斷能力
                </p>
              </div>
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-md bg-muted text-muted-foreground mx-auto mb-md">
                  <Calendar className="h-7 w-7" />
                </div>
                <h4 className="text-h5 mb-xs text-foreground">透明揭露</h4>
                <p className="text-sm text-muted-foreground">
                  實戰導師內容至少 T+7 延遲，明確區分即時與教學
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-section bg-card">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-h2 mb-md text-foreground">
              準備好開始了嗎？
            </h2>
            <p className="text-muted-foreground mb-lg">
              立即註冊，探索適合你的投顧分析師或實戰導師
            </p>
            <div className="flex flex-col sm:flex-row gap-md justify-center">
              <Button size="xl" asChild>
                <Link to="/auth/register">
                  免費註冊
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              <Button size="xl" variant="secondary" asChild>
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
