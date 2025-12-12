import { Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Shield, 
  BookOpen, 
  Radio, 
  Calendar,
  CheckCircle,
  ArrowRight,
  Users,
  BarChart3,
  GraduationCap,
  Zap,
  Target,
  LineChart,
  TrendingUp
} from 'lucide-react';
import { WeeklyLimitUpLeaderboard, mockLeaderboardEntries } from '@/components/WeeklyLimitUpLeaderboard';
import heroBg from '@/assets/hero-bg.png';

const Index = () => {
  return (
    <PortalLayout>
      {/* Hero Section - Strong Contrast, Minimal Text */}
      <section className="relative overflow-hidden min-h-[70vh] flex items-center">
        {/* Background Image with darkened overlay */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat animate-fade-in"
          style={{ backgroundImage: `url(${heroBg})`, animationDuration: '1.5s' }}
        />
        {/* Dark overlay for strong contrast */}
        <div className="absolute inset-0 bg-foreground/70 animate-fade-in" style={{ animationDuration: '1.5s' }} />
        
        <div className="container relative z-10 py-section">
          <div className="max-w-xl animate-fade-in">
            <p className="text-muted-foreground/80 text-sm mb-sm tracking-wide">
              更快看懂市場轉折的方式
            </p>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-md text-primary-foreground leading-[1.15]">
              專業投顧
            </h1>
            
            <p className="text-lg md:text-xl text-primary-foreground/80 mb-xl max-w-md leading-relaxed">
              盯盤時代已結束，即時Line通知讓你不錯過任何買賣點
            </p>
            
            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-sm">
              <Button size="xl" asChild>
                <Link to="/experts">
                  開始探索
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              <Button 
                size="xl" 
                variant="outline" 
                className="bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
                asChild
              >
                <Link to="/pricing">查看方案比較</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Three Core Features Section */}
      <section className="py-section bg-muted/50">
        <div className="container">
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">一站式投資服務</p>
            <h2 className="text-h2 text-foreground">三大核心功能</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-lg max-w-5xl mx-auto">
            {/* Feature 1 */}
            <Card variant="elevated" className="text-center">
              <CardContent className="p-card pt-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto mb-md">
                  <Zap className="h-7 w-7" />
                </div>
                <h3 className="text-h4 mb-sm text-foreground">即時策略訊號</h3>
                <p className="text-muted-foreground leading-relaxed">
                  第一時間推播，掌握每一次漲停或轉折訊號。
                </p>
              </CardContent>
            </Card>

            {/* Feature 2 */}
            <Card variant="elevated" className="text-center">
              <CardContent className="p-card pt-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto mb-md">
                  <Target className="h-7 w-7" />
                </div>
                <h3 className="text-h4 mb-sm text-foreground">清楚的漲停邏輯</h3>
                <p className="text-muted-foreground leading-relaxed">
                  從型態、量價、主力籌碼，完整拆解判斷流程。
                </p>
              </CardContent>
            </Card>

            {/* Feature 3 */}
            <Card variant="elevated" className="text-center">
              <CardContent className="p-card pt-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto mb-md">
                  <LineChart className="h-7 w-7" />
                </div>
                <h3 className="text-h4 mb-sm text-foreground">透明績效</h3>
                <p className="text-muted-foreground leading-relaxed">
                  勝率、報酬、回測全都公開，信息更透明。
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Two Service Lines - Moved Up */}
      <section className="py-section bg-background">
        <div className="container">
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">找到適合你的學習路徑</p>
            <h2 className="text-h2 text-foreground">選擇適合你的服務</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-lg max-w-5xl mx-auto">
            {/* Advisor Card */}
            <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
              <CardContent className="p-card">
                <div className="flex items-center gap-sm mb-md">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Radio className="h-6 w-6" />
                  </div>
                  <Badge variant="secondary">投顧分析師</Badge>
                </div>
                <h3 className="text-h3 mb-sm text-foreground">
                  即時策略，跟著走
                </h3>
                <p className="text-muted-foreground mb-lg leading-relaxed">
                  即時推播策略訊號，每筆操作附帶完整教學說明。
                </p>
                <Button className="w-full sm:w-auto" asChild>
                  <Link to="/experts?role=advisor">
                    查看細節
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Mentor Card */}
            <Card className="relative overflow-hidden group hover:shadow-lg transition-shadow">
              <CardContent className="p-card">
                <div className="flex items-center gap-sm mb-md">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <Badge variant="secondary">實戰導師</Badge>
                </div>
                <h3 className="text-h3 mb-sm text-foreground">
                  週記教學，學實戰
                </h3>
                <p className="text-muted-foreground mb-lg leading-relaxed">
                  每週實戰週記，完整拆解操作邏輯與風險思維。
                </p>
                <Button className="w-full sm:w-auto" asChild>
                  <Link to="/experts?role=coach">
                    查看細節
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Real Interface Preview Section */}
      <section className="py-section bg-card">
        <div className="container">
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">產品真實畫面</p>
            <h2 className="text-h2 text-foreground">你會看到什麼？</h2>
          </div>

          <div className="grid md:grid-cols-2 gap-xl max-w-5xl mx-auto">
            {/* Signal List Preview */}
            <div>
              <div className="bg-background rounded-lg border border-border p-md mb-md">
                <div className="flex items-center gap-2 mb-md pb-md border-b border-border">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">即時訊號牆</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">即時</Badge>
                </div>
                <div className="space-y-3">
                  {/* Sample Signal 1 */}
                  <div className="p-3 rounded-md bg-muted/50 border-l-2 border-success">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">2330.TW 台積電</span>
                      <Badge className="bg-success/10 text-success text-[10px]">買進</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">突破季線壓力，外資連續買超</p>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>約 580-590</span>
                      <span>09:32</span>
                    </div>
                  </div>
                  {/* Sample Signal 2 */}
                  <div className="p-3 rounded-md bg-muted/50 border-l-2 border-primary">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">2454.TW 聯發科</span>
                      <Badge className="bg-primary/10 text-primary text-[10px]">加碼</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">續創新高，AI 晶片出貨成長</p>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>約 1250-1280</span>
                      <span>10:15</span>
                    </div>
                  </div>
                  {/* Sample Signal 3 */}
                  <div className="p-3 rounded-md bg-muted/50 border-l-2 border-amber-500">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">3008.TW 大立光</span>
                      <Badge className="bg-amber-500/10 text-amber-600 text-[10px]">減碼</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">達目標價位，量能萎縮先獲利了結</p>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>約 155-160</span>
                      <span>11:00</span>
                    </div>
                  </div>
                </div>
              </div>
              <h4 className="text-h5 mb-xs text-foreground">即時訊號</h4>
              <p className="text-muted-foreground text-sm leading-relaxed">
                包含時間戳、型態、策略、買進價位與理由。
              </p>
            </div>

            {/* Equity Curve Preview */}
            <div>
              <div className="bg-background rounded-lg border border-border p-md mb-md">
                <div className="flex items-center justify-between mb-md pb-md border-b border-border">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">淨值曲線</span>
                  </div>
                  <span className="text-success text-sm font-semibold">+32.4%</span>
                </div>
                {/* Simple Chart Visualization */}
                <div className="h-40 flex items-end gap-1">
                  {[35, 42, 38, 55, 48, 62, 58, 72, 68, 78, 85, 82, 92, 88, 95, 100].map((height, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-gradient-to-t from-primary/20 to-primary/60 rounded-t"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-3 text-[10px] text-muted-foreground">
                  <span>1月</span>
                  <span>4月</span>
                  <span>7月</span>
                  <span>10月</span>
                </div>
                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-border">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">勝率</p>
                    <p className="text-sm font-semibold">62.5%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">夏普值</p>
                    <p className="text-sm font-semibold">1.85</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">最大回撤</p>
                    <p className="text-sm font-semibold text-destructive">-12.3%</p>
                  </div>
                </div>
              </div>
              <h4 className="text-h5 mb-xs text-foreground">權益曲線</h4>
              <p className="text-muted-foreground text-sm leading-relaxed">
                來自真實操作紀錄或策略回測數據。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Weekly Limit Up Leaderboard */}
      <section className="py-section bg-background">
        <div className="container">
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">即時更新，展現真實戰績</p>
            <h2 className="text-h2 text-foreground">本週漲停王排行榜</h2>
          </div>
          <div className="max-w-2xl mx-auto">
            <WeeklyLimitUpLeaderboard entries={mockLeaderboardEntries} />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-section bg-card">
        <div className="container">
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">簡單四步驟，開始學習</p>
            <h2 className="text-h2 text-foreground">如何開始？</h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-lg max-w-5xl mx-auto">
            {[
              {
                step: 1,
                icon: Users,
                title: '選擇專家',
                description: '瀏覽投顧分析師或實戰導師'
              },
              {
                step: 2,
                icon: BarChart3,
                title: '選擇方案',
                description: '根據需求選擇適合的服務'
              },
              {
                step: 3,
                icon: Radio,
                title: 'LINE 登入',
                description: '接收最即時的訊號通知'
              },
              {
                step: 4,
                icon: GraduationCap,
                title: '持續學習',
                description: '建立自己的投資系統'
              }
            ].map((item) => (
              <Card key={item.step} variant="ghost" className="text-center">
                <CardContent className="p-card">
                  <Badge variant="secondary" className="mb-md">
                    {item.step}
                  </Badge>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mx-auto mb-md">
                    <item.icon className="h-6 w-6" />
                  </div>
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
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">安心使用，透明經營</p>
            <h2 className="text-h2 text-foreground">我們的承諾</h2>
          </div>
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-3 gap-xl text-center">
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground mx-auto mb-md">
                  <Shield className="h-7 w-7" />
                </div>
                <h4 className="text-h5 mb-xs text-foreground">合規經營</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  持有合法執照，依法令規範辦理
                </p>
              </div>
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground mx-auto mb-md">
                  <GraduationCap className="h-7 w-7" />
                </div>
                <h4 className="text-h5 mb-xs text-foreground">教育為本</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  每筆操作都是教學機會
                </p>
              </div>
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground mx-auto mb-md">
                  <Calendar className="h-7 w-7" />
                </div>
                <h4 className="text-h5 mb-xs text-foreground">透明揭露</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  明確區分即時與教學內容
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
            <p className="text-muted-foreground text-sm mb-xs">立即開始你的投資學習之旅</p>
            <h2 className="text-h2 mb-md text-foreground">
              準備好開始了嗎？
            </h2>
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
