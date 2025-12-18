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
import featureXianren from '@/assets/feature-xianren.png';
import featureSanpai from '@/assets/feature-sanpai.png';
import featureJiaodai from '@/assets/feature-jiaodai.png';
import cardKungfuSpeed from '@/assets/card-kungfu-speed.png';
import cardKungfuBones from '@/assets/card-kungfu-bones.png';
import { WeeklyLimitUpLeaderboard, mockLeaderboardEntries } from '@/components/WeeklyLimitUpLeaderboard';


const Index = () => {
  return (
    <PortalLayout>
      {/* Hero Section - Strong Contrast, Minimal Text */}
      <section className="relative overflow-hidden min-h-[70vh] flex items-center">
        {/* Background Video */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover animate-fade-in"
          style={{ animationDuration: '1.5s', objectPosition: 'center center' }}
        >
          <source src="/videos/hero-bg.mp4" type="video/mp4" />
        </video>
        {/* Dark overlay for strong contrast */}
        <div className="absolute inset-0 bg-gradient-to-r from-foreground/80 via-foreground/60 to-foreground/40 animate-fade-in" style={{ animationDuration: '1.5s' }} />
        
        <div className="container relative z-10 py-section">
          <div className="max-w-xl animate-fade-in">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-md text-primary-foreground leading-[1.15] drop-shadow-lg">
              讀萬卷書，不如緊跟大戶
            </h1>
            <p className="text-lg md:text-xl text-primary-foreground/80 mb-xl max-w-md leading-relaxed">
              21世紀用更愜意的方式賺錢
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

      {/* Three Core Features Section - Magazine Layout */}
      <section className="py-section bg-muted/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-[40%_60%] gap-12 lg:gap-20 items-start">
            {/* Left Column - Narrative */}
            <div className="lg:sticky lg:top-32">
              <p className="text-muted-foreground text-sm tracking-widest uppercase mb-sm">你會用到的三件事</p>
              <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-md leading-tight">三招定勝負</h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                即時訊號、判斷路線、戰績回顧，三件事把你從盯盤裡解放。
              </p>
            </div>

            {/* Right Column - Staggered Cards */}
            <div className="flex flex-col gap-6">
              {/* Card 01 - 仙人指路 */}
              <div 
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl lg:ml-0"
                style={{ 
                  animation: 'fadeSlideUp 0.6s ease-out forwards',
                  animationDelay: '0.1s',
                  opacity: 0
                }}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03]"
                  style={{ 
                    backgroundImage: `url(${featureXianren})`,
                    opacity: 0.6
                  }}
                />
                <div 
                  className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30 transition-opacity duration-300 group-hover:opacity-80" 
                />
                {/* Large Number Decoration */}
                <span className="absolute top-4 left-5 text-6xl font-bold text-white/10 select-none">01</span>
                {/* Red Dot */}
                <span className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full bg-red-500" />
                
                <div className="relative z-10 p-8 pt-16 pb-10">
                  <h3 className="text-2xl font-bold text-white mb-2 transition-all duration-300 group-hover:text-white group-hover:drop-shadow-lg">仙人指路</h3>
                  <p className="text-white/70 leading-relaxed">
                    第一時間推播，掌握每次漲停或轉折訊號。
                  </p>
                </div>
              </div>

              {/* Card 02 - 三派會師 */}
              <div 
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl lg:ml-6"
                style={{ 
                  animation: 'fadeSlideUp 0.6s ease-out forwards',
                  animationDelay: '0.25s',
                  opacity: 0
                }}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03]"
                  style={{ 
                    backgroundImage: `url(${featureSanpai})`,
                    opacity: 0.65
                  }}
                />
                <div 
                  className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30 transition-opacity duration-300 group-hover:opacity-80" 
                />
                {/* Large Number Decoration */}
                <span className="absolute top-4 left-5 text-6xl font-bold text-white/10 select-none">02</span>
                {/* Red Dot */}
                <span className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full bg-red-500" />
                
                <div className="relative z-10 p-8 pt-16 pb-10">
                  <h3 className="text-2xl font-bold text-white mb-2 transition-all duration-300 group-hover:text-white group-hover:drop-shadow-lg">三派會師</h3>
                  <p className="text-white/70 leading-relaxed">
                    把型態、量價、籌碼串成判斷路線。
                  </p>
                </div>
              </div>

              {/* Card 03 - 招招有交代 */}
              <div 
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl lg:ml-12"
                style={{ 
                  animation: 'fadeSlideUp 0.6s ease-out forwards',
                  animationDelay: '0.4s',
                  opacity: 0
                }}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03]"
                  style={{ 
                    backgroundImage: `url(${featureJiaodai})`,
                    opacity: 0.6
                  }}
                />
                <div 
                  className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30 transition-opacity duration-300 group-hover:opacity-80" 
                />
                {/* Large Number Decoration */}
                <span className="absolute top-4 left-5 text-6xl font-bold text-white/10 select-none">03</span>
                {/* Red Dot */}
                <span className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full bg-red-500" />
                
                <div className="relative z-10 p-8 pt-16 pb-10">
                  <h3 className="text-2xl font-bold text-white mb-2 transition-all duration-300 group-hover:text-white group-hover:drop-shadow-lg">招招有交代</h3>
                  <p className="text-white/70 leading-relaxed">
                    勝率、報酬、回測全都透明公開。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Animation Keyframes */}
      <style>{`
        @keyframes fadeSlideUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      {/* 選門派 Section - Magazine Layout */}
      <section className="py-section bg-background">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-[40%_60%] gap-12 lg:gap-20 items-start">
            {/* Left Column - Narrative */}
            <div className="lg:sticky lg:top-32">
              <p className="text-muted-foreground text-sm tracking-widest uppercase mb-sm">江湖兩派，各走一招</p>
              <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-md leading-tight">選一派，先走得下去</h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-md">
                想省時間就走「跟單派」，想練功底就走「修煉派」。兩派都看戰績說話。
              </p>
              <p className="text-sm text-muted-foreground/70">
                不確定？先看週回顧，覺得合，再升級跟單派。
              </p>
            </div>

            {/* Right Column - Two Sect Cards */}
            <div className="flex flex-col gap-6">
              {/* Card 1 - 跟單派 (Primary/Featured) */}
              <div 
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 ring-1 ring-white/20"
                style={{ 
                  animation: 'fadeSlideUp 0.6s ease-out forwards',
                  animationDelay: '0.1s',
                  opacity: 0,
                  minHeight: '320px'
                }}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03]"
                  style={{ 
                    backgroundImage: `url(${cardKungfuSpeed})`,
                    opacity: 0.5
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/40 transition-opacity duration-300 group-hover:opacity-85" />
                
                {/* Sect Badge */}
                <div className="absolute top-5 left-5 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-[10px] text-white/70 font-medium transition-all duration-300 group-hover:bg-white/20 group-hover:text-white">門派</span>
                  <Badge className="bg-primary/80 text-primary-foreground text-[10px]">熱門</Badge>
                </div>
                {/* Red Dot */}
                <span className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full bg-red-500" />
                
                <div className="relative z-10 p-8 pt-20 pb-8 flex flex-col h-full justify-end">
                  <p className="text-white/50 text-sm mb-1">跟單派</p>
                  <h3 className="text-2xl font-bold text-white mb-2 transition-all duration-300 group-hover:drop-shadow-lg">即時策略｜跟著走</h3>
                  <p className="text-white/70 text-sm italic mb-6">
                    天下武功，唯快不破
                  </p>
                  
                  <div className="mb-6">
                    <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">適合你如果</p>
                    <ul className="space-y-1.5 text-white/80 text-sm">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>你沒空天天盯盤</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>你想有人先替你把關時機</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>你要的是少犯錯，不是多操作</span>
                      </li>
                    </ul>
                  </div>
                  
                  <Button className="w-full sm:w-auto" asChild>
                    <Link to="/experts?role=advisor">
                      加入跟單派
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Card 2 - 修煉派 (Secondary) */}
              <div 
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 lg:ml-8"
                style={{ 
                  animation: 'fadeSlideUp 0.6s ease-out forwards',
                  animationDelay: '0.25s',
                  opacity: 0,
                  minHeight: '280px'
                }}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03]"
                  style={{ 
                    backgroundImage: `url(${cardKungfuBones})`,
                    opacity: 0.45
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/40 transition-opacity duration-300 group-hover:opacity-85" />
                
                {/* Sect Badge */}
                <span className="absolute top-5 left-5 w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-[10px] text-white/70 font-medium transition-all duration-300 group-hover:bg-white/20 group-hover:text-white">門派</span>
                {/* Red Dot */}
                <span className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full bg-red-500" />
                
                <div className="relative z-10 p-8 pt-20 pb-8 flex flex-col h-full justify-end">
                  <p className="text-white/50 text-sm mb-1">修煉派</p>
                  <h3 className="text-2xl font-bold text-white mb-2 transition-all duration-300 group-hover:drop-shadow-lg">週記教學｜學實戰</h3>
                  <p className="text-white/70 text-sm italic mb-6">
                    看你骨骼精奇，是個練武奇才
                  </p>
                  
                  <div className="mb-6">
                    <p className="text-white/50 text-xs mb-2 uppercase tracking-wider">適合你如果</p>
                    <ul className="space-y-1.5 text-white/80 text-sm">
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>你想先看懂再出手</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>你喜歡用紀錄校正自己</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                        <span>你想建立穩定的投資節奏</span>
                      </li>
                    </ul>
                  </div>
                  
                  <Button variant="outline" className="w-full sm:w-auto bg-transparent border-white/30 text-white hover:bg-white/10" asChild>
                    <Link to="/experts?role=coach">
                      從修煉派開始
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
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
