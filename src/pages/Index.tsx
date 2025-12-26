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
import { VsBrushMark } from '@/components/VsBrushMark';
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
                訊號、路線、戰績，解放盯盤。
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
        
        @keyframes vsPulse {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 30px rgba(255,200,100,0.8));
          }
          50% {
            transform: scale(1.08);
            filter: drop-shadow(0 0 50px rgba(255,150,50,1));
          }
        }
        
        @keyframes vsGlowPulse {
          0%, 100% {
            opacity: 0.6;
            transform: scale(1);
          }
          50% {
            opacity: 0.9;
            transform: scale(1.15);
          }
        }
        
      `}</style>

      {/* 選門派 Section - VS Fighting Game Visual Scene */}
      <section className="py-24 relative overflow-hidden">
        
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          {/* Main Title - Battle Declaration */}
          <h2 className="text-center text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-16">
            江湖兩派，選你的模式
          </h2>

          {/* VS Battle Arena */}
          <div className="vs-arena relative flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-10">
            
            {/* Left Fighter - 跟單派 (Red thick border) */}
            <div 
              className="vs-card vs-card-left w-full lg:w-[40%] relative cursor-pointer transition-all duration-500"
              style={{ 
                animation: 'vsSlideInLeft 0.8s ease-out forwards',
                opacity: 0
              }}
            >
              {/* Card with HUD style */}
              <div 
                className="relative transition-all duration-500"
                style={{ minHeight: '380px' }}
              >
                {/* Health Bar - KOF style parallelogram */}
                <div 
                  className="absolute left-4 right-4 z-20"
                  style={{ 
                    top: '16px',
                    height: '32px',
                    padding: '4px',
                    background: 'linear-gradient(180deg, #3a3a3a 0%, #1a1a1a 50%, #0a0a0a 100%)',
                    clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.6)'
                  }}
                >
                  {/* Inner HP fill - RED with pulse animation */}
                  <div 
                    className="hp-bar-red"
                    style={{ 
                      width: '100%',
                      height: '100%',
                      background: 'linear-gradient(180deg, #ff4444 0%, #ee0000 40%, #cc0000 70%, #990000 100%)',
                      boxShadow: 'inset 0 3px 0 rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.4)',
                      clipPath: 'polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)',
                      position: 'relative'
                    }}
                  >
                    {/* Highlight line */}
                    <div style={{ 
                      position: 'absolute',
                      top: '3px',
                      left: '16px',
                      right: '16px',
                      height: '5px',
                      background: 'linear-gradient(90deg, rgba(255,255,255,0.9), rgba(255,150,150,0.3))',
                      clipPath: 'polygon(4px 0%, 100% 0%, calc(100% - 4px) 100%, 0% 100%)'
                    }} />
                  </div>
                </div>
                {/* Red glow effect with pulse */}
                <div 
                  className="hp-glow-red absolute left-4 right-4 z-10 pointer-events-none"
                  style={{ 
                    top: '16px',
                    height: '32px',
                    background: 'rgba(255, 0, 0, 0.5)',
                    filter: 'blur(12px)',
                    clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)'
                  }}
                />
                
                {/* Card body - dark background */}
                <div 
                  className="relative overflow-hidden w-full h-full rounded-lg"
                  style={{ 
                    minHeight: '380px',
                    backgroundColor: '#1a1a1a',
                    border: '2px solid rgba(239, 68, 68, 0.4)'
                  }}
                >
                  <div 
                    className="absolute inset-0 bg-cover transition-all duration-500"
                    style={{ 
                      backgroundImage: `url(${cardKungfuSpeed})`,
                      backgroundPosition: 'center right',
                      filter: 'brightness(1.2) contrast(1.1)'
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-black/20" />
                  
                  <div className="relative z-10 p-8 pb-10 flex flex-col h-full justify-end text-left" style={{ minHeight: '380px' }}>
                    <p 
                      className="text-3xl lg:text-4xl text-white mb-4"
                      style={{ fontFamily: '"Longyin Brush", cursive' }}
                    >
                      跟單派
                    </p>
                    <p className="text-white/70 text-lg italic mb-8">
                      「天下武功，唯快不破」
                    </p>
                    
                    <Button variant="outline" className="w-fit bg-transparent border-red-600/60 text-red-400 hover:bg-red-600/10 hover:border-red-500" asChild>
                      <Link to="/experts?role=advisor">
                        選擇此派
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Center VS - Calligraphy Brush Mark with glow effect */}
            <div className="hidden lg:flex items-center justify-center select-none pointer-events-none shrink-0 relative">
              {/* Glow backdrop */}
              <div 
                className="absolute inset-0 blur-2xl"
                style={{
                  background: 'radial-gradient(circle, rgba(255,100,100,0.4) 0%, rgba(100,150,255,0.4) 100%)',
                  animation: 'vsGlowPulse 2s ease-in-out infinite'
                }} 
              />
              <VsBrushMark 
                className="w-36 h-36 lg:w-40 lg:h-40" 
                title="VS" 
                style={{ animation: 'vsPulse 2s ease-in-out infinite' }}
              />
            </div>

            {/* Mobile VS */}
            <div className="lg:hidden select-none pointer-events-none -my-4 relative">
              <div 
                className="absolute inset-0 blur-xl"
                style={{
                  background: 'radial-gradient(circle, rgba(255,100,100,0.5) 0%, rgba(100,150,255,0.5) 100%)',
                  animation: 'vsGlowPulse 2s ease-in-out infinite'
                }} 
              />
              <VsBrushMark 
                className="w-24 h-24" 
                title="VS" 
                style={{ animation: 'vsPulse 2s ease-in-out infinite' }}
              />
            </div>

            {/* Right Fighter - 修煉派 (Blue thick border) */}
            <div 
              className="vs-card vs-card-right w-full lg:w-[40%] relative cursor-pointer transition-all duration-500"
              style={{ 
                animation: 'vsSlideInRight 0.8s ease-out forwards',
                animationDelay: '0.1s',
                opacity: 0
              }}
            >
              {/* Card with HUD style */}
              <div 
                className="relative transition-all duration-500"
                style={{ minHeight: '380px' }}
              >
                {/* Health Bar - KOF style parallelogram */}
                <div 
                  className="absolute left-4 right-4 z-20"
                  style={{ 
                    top: '16px',
                    height: '32px',
                    padding: '4px',
                    background: 'linear-gradient(180deg, #3a3a3a 0%, #1a1a1a 50%, #0a0a0a 100%)',
                    clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.6)'
                  }}
                >
                  {/* Inner HP fill - BLUE with pulse animation */}
                  <div 
                    className="hp-bar-blue"
                    style={{ 
                      width: '100%',
                      height: '100%',
                      background: 'linear-gradient(180deg, #44aaff 0%, #0088ee 40%, #0066cc 70%, #004499 100%)',
                      boxShadow: 'inset 0 3px 0 rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.4)',
                      clipPath: 'polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)',
                      position: 'relative'
                    }}
                  >
                    {/* Highlight line */}
                    <div style={{ 
                      position: 'absolute',
                      top: '3px',
                      left: '16px',
                      right: '16px',
                      height: '5px',
                      background: 'linear-gradient(90deg, rgba(255,255,255,0.9), rgba(150,200,255,0.3))',
                      clipPath: 'polygon(4px 0%, 100% 0%, calc(100% - 4px) 100%, 0% 100%)'
                    }} />
                  </div>
                </div>
                {/* Blue glow effect with pulse */}
                <div 
                  className="hp-glow-blue absolute left-4 right-4 z-10 pointer-events-none"
                  style={{ 
                    top: '16px',
                    height: '32px',
                    background: 'rgba(0, 136, 255, 0.5)',
                    filter: 'blur(12px)',
                    clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)'
                  }}
                />
                
                {/* Card body - dark background */}
                <div 
                  className="relative overflow-hidden w-full h-full rounded-lg"
                  style={{ 
                    minHeight: '380px',
                    backgroundColor: '#1a1a1a',
                    border: '2px solid rgba(59, 130, 246, 0.4)'
                  }}
                >
                  <div 
                    className="absolute inset-0 bg-cover transition-all duration-500"
                    style={{ 
                      backgroundImage: `url(${cardKungfuBones})`,
                      backgroundPosition: 'center left',
                      filter: 'brightness(1.2) contrast(1.1)'
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-l from-black/80 via-black/40 to-black/20" />
                  
                  <div className="relative z-10 p-8 pb-10 flex flex-col h-full justify-end text-right items-end" style={{ minHeight: '380px' }}>
                    <p 
                      className="text-3xl lg:text-4xl text-white mb-4"
                      style={{ fontFamily: '"Longyin Brush", cursive' }}
                    >
                      修煉派
                    </p>
                    <p className="text-white/70 text-lg italic mb-8">
                      「看你骨骼精奇，是個練武奇才」
                    </p>
                    
                    <Button variant="outline" className="w-fit bg-transparent border-blue-600/60 text-blue-400 hover:bg-blue-600/10 hover:border-blue-500" asChild>
                      <Link to="/experts?role=coach">
                        選擇此派
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
        </div>
      </section>
      
      {/* VS Animation Keyframes + Hover Battle Effect */}
      <style>{`
        @keyframes vsSlideInLeft {
          from {
            opacity: 0;
            transform: translateX(-50px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes vsSlideInRight {
          from {
            opacity: 0;
            transform: translateX(50px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        /* HP bar pulse animation */
        @keyframes hpPulseRed {
          0%, 100% {
            box-shadow: inset 0 3px 0 rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.4);
          }
          50% {
            box-shadow: inset 0 3px 0 rgba(255,255,255,0.8), inset 0 -2px 4px rgba(0,0,0,0.4), 0 0 8px rgba(255,0,0,0.6);
          }
        }
        @keyframes hpPulseBlue {
          0%, 100% {
            box-shadow: inset 0 3px 0 rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.4);
          }
          50% {
            box-shadow: inset 0 3px 0 rgba(255,255,255,0.8), inset 0 -2px 4px rgba(0,0,0,0.4), 0 0 8px rgba(0,136,255,0.6);
          }
        }
        @keyframes glowPulse {
          0%, 100% {
            opacity: 0.6;
          }
          50% {
            opacity: 1;
          }
        }
        
        .hp-bar-red {
          animation: hpPulseRed 2s ease-in-out infinite;
        }
        .hp-bar-blue {
          animation: hpPulseBlue 2s ease-in-out infinite;
        }
        .hp-glow-red, .hp-glow-blue {
          animation: glowPulse 2s ease-in-out infinite;
        }
        
        /* Battle hover effect - when one card is hovered, the other dims and shrinks */
        .vs-card {
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .vs-card:hover {
          z-index: 20;
          transform: scale(1.03);
          filter: brightness(1.15);
        }
        
        /* When left card is hovered, right card dims */
        .vs-arena:has(.vs-card-left:hover) .vs-card-right {
          transform: scale(0.96);
          filter: brightness(0.7);
          opacity: 0.85;
        }
        
        /* When right card is hovered, left card dims */
        .vs-arena:has(.vs-card-right:hover) .vs-card-left {
          transform: scale(0.96);
          filter: brightness(0.7);
          opacity: 0.85;
        }
      `}</style>

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
