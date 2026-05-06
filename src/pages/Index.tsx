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
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Lightbulb
} from 'lucide-react';
import featureXianren from '@/assets/feature-xianren.webp';
import featureSanpai from '@/assets/feature-sanpai.webp';
import featureJiaodai from '@/assets/feature-jiaodai.webp';
import featureFiveFactions from '@/assets/feature-five-factions.webp';
import cardKungfuSpeed from '@/assets/card-kungfu-speed.webp';
import cardKungfuBones from '@/assets/card-kungfu-bones.webp';
import { VsBrushMark } from '@/components/VsBrushMark';
import { WeeklyLimitUpLeaderboard } from '@/components/WeeklyLimitUpLeaderboard';
import { LazyOnVisible } from '@/components/LazyOnVisible';
import { useWeeklyLeaderboard } from '@/hooks/useWeeklyLeaderboard';
import useEmblaCarousel from 'embla-carousel-react';
import { useCallback, useEffect, useState } from 'react';


const WeeklyLimitUpLeaderboardSection = () => {
  const { data: entries = [], isLoading } = useWeeklyLeaderboard();
  return <WeeklyLimitUpLeaderboard entries={entries} isLoading={isLoading} />;
};


// Mobile VS Carousel Component - Showcase/Turntable style
const MobileVsCarousel = () => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showHint, setShowHint] = useState(true);

  // Stop hint animation after first interaction
  useEffect(() => {
    if (hasInteracted) {
      setShowHint(false);
    }
  }, [hasInteracted]);

  // Auto-hide hint after 4 seconds even without interaction
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowHint(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const cards = [
    {
      id: 'red',
      title: '跟單派',
      subtitle: '「天下武功，唯快不破」',
      link: '/experts?role=advisor',
      bgImage: cardKungfuSpeed,
      bgPosition: 'center right',
      gradient: 'bg-gradient-to-r from-black/80 via-black/40 to-black/20',
      frameGradient: 'linear-gradient(135deg, rgba(239,68,68,0.9) 0%, rgba(180,40,40,0.7) 100%)',
      hpGradient: 'linear-gradient(180deg, #ff4444 0%, #ee0000 40%, #cc0000 70%, #990000 100%)',
      hpHighlight: 'linear-gradient(90deg, rgba(255,255,255,0.9), rgba(255,150,150,0.3))',
      hpGlow: 'rgba(255, 0, 0, 0.5)',
      accentBar: 'linear-gradient(90deg, #ff4444, #cc0000)',
      buttonClass: 'border-red-600/60 text-red-400 hover:bg-red-600/10 hover:border-red-500',
      textAlign: 'left' as const,
      itemsAlign: 'items-start' as const,
      accentColor: 'bg-red-500',
    },
    {
      id: 'blue',
      title: '修煉派',
      subtitle: '「看你骨骼精奇，是個練武奇才」',
      link: '/experts?role=mentor',
      bgImage: cardKungfuBones,
      bgPosition: 'center left',
      gradient: 'bg-gradient-to-l from-black/80 via-black/40 to-black/20',
      frameGradient: 'linear-gradient(135deg, rgba(59,130,246,0.9) 0%, rgba(40,80,180,0.7) 100%)',
      hpGradient: 'linear-gradient(180deg, #44aaff 0%, #0088ee 40%, #0066cc 70%, #004499 100%)',
      hpHighlight: 'linear-gradient(90deg, rgba(255,255,255,0.9), rgba(150,200,255,0.3))',
      hpGlow: 'rgba(0, 136, 255, 0.5)',
      accentBar: 'linear-gradient(90deg, #0066cc, #44aaff)',
      buttonClass: 'border-blue-600/60 text-blue-400 hover:bg-blue-600/10 hover:border-blue-500',
      textAlign: 'right' as const,
      itemsAlign: 'items-end' as const,
      accentColor: 'bg-blue-500',
    }
  ];

  const handleSwipe = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    const startX = (e.target as HTMLElement).dataset.startX;
    if (!startX) return;
    const diff = touch.clientX - parseFloat(startX);
    if (Math.abs(diff) > 50) {
      if (diff > 0 && selectedIndex > 0) {
        setSelectedIndex(0);
      } else if (diff < 0 && selectedIndex < 1) {
        setSelectedIndex(1);
      }
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    (e.currentTarget as HTMLElement).dataset.startX = String(e.touches[0].clientX);
  };

  return (
    <div className="md:hidden relative px-4">
      {/* Showcase Container */}
      <div 
        className="relative h-[420px] perspective-1000"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleSwipe}
      >
        {cards.map((card, index) => {
          const isActive = index === selectedIndex;
          const offset = index - selectedIndex;
          
          // Hint animation class for swipe indication
          const hintClass = showHint && isActive ? 'animate-swipe-hint' : '';
          
          return (
            <div
              key={card.id}
              onClick={() => { setSelectedIndex(index); setHasInteracted(true); }}
              className={`absolute inset-x-0 mx-auto cursor-pointer transition-all duration-500 ease-out ${hintClass}`}
              style={{
                width: isActive ? '92%' : '75%',
                transform: isActive 
                  ? 'translateX(0) translateZ(0) rotateY(0deg) scale(1)' 
                  : `translateX(${offset * 60}%) translateZ(-80px) rotateY(${offset * -8}deg) scale(0.88)`,
                opacity: isActive ? 1 : 0.5,
                zIndex: isActive ? 20 : 10,
                filter: isActive ? 'none' : 'brightness(0.7)',
                transformStyle: 'preserve-3d',
              }}
            >
              <div 
                className="relative p-[6px] rounded-lg shadow-2xl"
                style={{ 
                  background: card.frameGradient,
                  boxShadow: isActive 
                    ? `inset 0 0 2px rgba(255,255,255,0.4), 0 20px 50px rgba(0,0,0,0.5)` 
                    : 'inset 0 0 2px rgba(255,255,255,0.2)'
                }}
              >
                <div 
                  className="relative overflow-hidden w-full rounded-md"
                  style={{ 
                    minHeight: '380px',
                    backgroundColor: '#1a1a1a'
                  }}
                >
                  {/* Health Bar */}
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
                    <div 
                      style={{ 
                        width: '100%',
                        height: '100%',
                        background: card.hpGradient,
                        boxShadow: 'inset 0 3px 0 rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.4)',
                        clipPath: 'polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)',
                        position: 'relative'
                      }}
                    >
                      <div style={{ 
                        position: 'absolute',
                        top: '3px',
                        left: '16px',
                        right: '16px',
                        height: '5px',
                        background: card.hpHighlight,
                        clipPath: 'polygon(4px 0%, 100% 0%, calc(100% - 4px) 100%, 0% 100%)'
                      }} />
                    </div>
                  </div>
                  <div 
                    className="absolute left-4 right-4 z-10 pointer-events-none"
                    style={{ 
                      top: '16px',
                      height: '32px',
                      background: card.hpGlow,
                      filter: 'blur(12px)',
                      clipPath: 'polygon(12px 0%, 100% 0%, calc(100% - 12px) 100%, 0% 100%)'
                    }}
                  />
                  
                  <div 
                    className="absolute inset-0 bg-cover transition-all duration-500"
                    style={{ 
                      backgroundImage: `url(${card.bgImage})`,
                      backgroundPosition: card.bgPosition,
                      filter: 'brightness(1.2) contrast(1.1)'
                    }}
                  />
                  <div className={`absolute inset-0 ${card.gradient}`} />
                  
                  <div 
                    className={`relative z-10 p-8 pb-10 flex flex-col h-full justify-end ${card.itemsAlign} text-${card.textAlign}`}
                    style={{ minHeight: '380px' }}
                  >
                    <div 
                      className="w-12 h-1 mb-3 rounded-full"
                      style={{ background: card.accentBar }}
                    />
                    <p 
                      className={`text-3xl text-white mb-4 text-${card.textAlign} w-full`}
                      style={{ fontFamily: '"Longyin Brush", cursive' }}
                    >
                      {card.title}
                    </p>
                    <p className={`text-white/70 text-lg italic mb-8 text-${card.textAlign}`}>
                      {card.subtitle}
                    </p>
                    
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation Arrows */}
      <button
        onClick={() => setSelectedIndex(0)}
        disabled={selectedIndex === 0}
        className={`absolute left-0 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/60 dark:bg-white/20 dark:backdrop-blur-sm flex items-center justify-center text-white transition-opacity ${selectedIndex === 0 ? 'opacity-30' : 'opacity-100'}`}
      >
        <ChevronLeft className="w-6 h-6" />
      </button>
      <button
        onClick={() => setSelectedIndex(1)}
        disabled={selectedIndex === 1}
        className={`absolute right-0 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-black/60 dark:bg-white/20 dark:backdrop-blur-sm flex items-center justify-center text-white transition-opacity ${selectedIndex === 1 ? 'opacity-30' : 'opacity-100'}`}
      >
        <ChevronRight className="w-6 h-6" />
      </button>

      {/* Dots Indicator */}
      <div className="flex justify-center gap-3 mt-6">
        {cards.map((card, index) => (
          <button
            key={card.id}
            onClick={() => setSelectedIndex(index)}
            className={`h-2 rounded-full transition-all duration-300 ${
              index === selectedIndex 
                ? `${card.accentColor} w-8`
                : 'bg-black/30 dark:bg-white/30 w-2'
            }`}
          />
        ))}
      </div>
      
      {/* Swipe Hint */}
      <p className="text-center text-muted-foreground dark:text-white/50 text-xs mt-3">
        ← 左右滑動選擇 →
      </p>
    </div>
  );
};

// Mobile Preview Carousel Component
const MobilePreviewCarousel = () => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleSwipe = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    const startX = (e.target as HTMLElement).dataset.startX;
    if (!startX) return;
    const diff = touch.clientX - parseFloat(startX);
    if (Math.abs(diff) > 50) {
      if (diff > 0 && selectedIndex > 0) {
        setSelectedIndex(0);
      } else if (diff < 0 && selectedIndex < 1) {
        setSelectedIndex(1);
      }
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    (e.currentTarget as HTMLElement).dataset.startX = String(e.touches[0].clientX);
  };

  return (
    <div className="md:hidden relative">
      {/* Swipe Container */}
      <div 
        className="relative overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleSwipe}
      >
        <div 
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${selectedIndex * 100}%)` }}
        >
          {/* 跟單派 Card */}
          <div className="w-full flex-shrink-0 px-4">
            <div className="bg-background dark:bg-white/5 rounded-lg border border-border dark:border-white/10 border-t-4 border-t-signals p-sm">
              <div className="flex items-center gap-2 mb-3">
                <Badge className="bg-signals/10 text-signals border border-signals/20 text-xs font-medium">
                  跟單派 · SIGNALS
                </Badge>
              </div>
              <div className="flex items-center gap-2 mb-sm pb-sm border-b border-border dark:border-white/10">
                <Zap className="h-4 w-4 text-signals" />
                <span className="text-xs font-medium">即時訊號牆</span>
                <Badge variant="outline" className="text-[10px] ml-auto bg-signals/10 text-signals border-signals/20">即時</Badge>
              </div>
              <div className="space-y-1.5">
                <div className="p-2 rounded-md bg-muted/50 dark:bg-white/5 border-l-2 border-success">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-[11px]">2330.TW 台積電</span>
                    <Badge className="bg-success/10 text-success text-[9px]">買進</Badge>
                  </div>
                  <p className="text-[9px] text-muted-foreground dark:text-white/50">突破季線壓力，外資連續買超</p>
                </div>
                <div className="p-2 rounded-md bg-muted/50 dark:bg-white/5 border-l-2 border-primary">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-[11px]">2454.TW 聯發科</span>
                    <Badge className="bg-primary/10 text-primary text-[9px]">加碼</Badge>
                  </div>
                  <p className="text-[9px] text-muted-foreground dark:text-white/50">續創新高，AI 晶片出貨成長</p>
                </div>
                <div className="p-2 rounded-md bg-muted/50 dark:bg-white/5 border-l-2 border-amber-500">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-[11px]">3008.TW 大立光</span>
                    <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px]">減碼</Badge>
                  </div>
                  <p className="text-[9px] text-muted-foreground dark:text-white/50">達目標價位，量能萎縮先獲利了結</p>
                </div>
                <div className="p-2 rounded-md bg-muted/50 dark:bg-white/5 border-l-2 border-success">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-[11px]">2317.TW 鴻海</span>
                    <Badge className="bg-success/10 text-success text-[9px]">買進</Badge>
                  </div>
                  <p className="text-[9px] text-muted-foreground dark:text-white/50">站上所有均線，外資連續買超</p>
                </div>
              </div>
            </div>
            <h4 className="text-base mt-sm mb-xs text-foreground">跟單派戰情室</h4>
            <p className="text-muted-foreground dark:text-white/60 text-xs leading-relaxed">
              即時接收專家買賣訊號，包含價位區間與操作理由。
            </p>
          </div>

          {/* 修煉派 Card */}
          <div className="w-full flex-shrink-0 px-4">
            <div className="bg-background dark:bg-white/5 rounded-lg border border-border dark:border-white/10 border-t-4 border-t-mentor p-sm">
              <div className="flex items-center gap-2 mb-3">
                <Badge className="bg-mentor/10 text-mentor border border-mentor/20 text-xs font-medium">
                  修煉派 · LEARNING
                </Badge>
              </div>
              <div className="flex items-center justify-between mb-sm pb-sm border-b border-border dark:border-white/10">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-mentor" />
                  <span className="text-xs font-medium">本週操作紀錄</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[9px] bg-mentor/10 text-mentor border-mentor/20">週記</Badge>
                  <span className="text-[10px] text-muted-foreground dark:text-white/50">12/23~12/27</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/30 dark:bg-white/5">
                  <span className="text-[10px] text-muted-foreground dark:text-white/50 w-6 shrink-0">週一</span>
                  <Badge className="bg-success/10 text-success text-[9px] shrink-0">買進</Badge>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-medium">2303.TW 聯電</span>
                  </div>
                  <Badge variant="outline" className="text-[9px] text-success">+3.5%</Badge>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/30 dark:bg-white/5">
                  <span className="text-[10px] text-muted-foreground dark:text-white/50 w-6 shrink-0">週二</span>
                  <Badge className="bg-success/10 text-success text-[9px] shrink-0">買進</Badge>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-medium">3037.TW 欣興</span>
                  </div>
                  <Badge variant="outline" className="text-[9px] text-destructive">-2.8%</Badge>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/30 dark:bg-white/5">
                  <span className="text-[10px] text-muted-foreground dark:text-white/50 w-6 shrink-0">週三</span>
                  <Badge className="bg-success/10 text-success text-[9px] shrink-0">買進</Badge>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-medium">2317.TW 鴻海</span>
                  </div>
                  <Badge variant="outline" className="text-[9px] text-success">+4.2%</Badge>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/20 dark:bg-white/[0.03]">
                  <span className="text-[10px] text-muted-foreground dark:text-white/50 w-6 shrink-0">週四</span>
                  <span className="text-[9px] text-muted-foreground dark:text-white/40 italic">— 觀望無操作</span>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/30 dark:bg-white/5">
                  <span className="text-[10px] text-muted-foreground dark:text-white/50 w-6 shrink-0">週五</span>
                  <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] shrink-0">減碼</Badge>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-medium">2303.TW 聯電</span>
                  </div>
                  <Badge variant="outline" className="text-[9px] text-success">已鎖利</Badge>
                </div>
              </div>
              {/* 本週教學重點 */}
              <div className="mt-3 pt-2 border-t border-border dark:border-white/10">
                <div className="flex items-center gap-1 mb-1.5">
                  <Lightbulb className="h-3 w-3 text-mentor" />
                  <span className="text-[9px] font-medium text-muted-foreground dark:text-white/60">本週教學重點</span>
                </div>
                <ul className="space-y-0.5 text-[9px] text-muted-foreground dark:text-white/50">
                  <li className="flex items-start gap-1">
                    <span className="text-mentor">•</span> 嚴格執行停損是短線操作的關鍵
                  </li>
                  <li className="flex items-start gap-1">
                    <span className="text-mentor">•</span> 量能確認後再進場可提高勝率
                  </li>
                </ul>
              </div>
            </div>
            <h4 className="text-base mt-sm mb-xs text-foreground">修煉派週記教學</h4>
            <p className="text-muted-foreground dark:text-white/60 text-xs leading-relaxed">
              每週回顧導師的實際操作，包含進出場理由與學習重點。
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Arrows */}
      <button
        onClick={() => setSelectedIndex(0)}
        className={`absolute left-2 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/50 dark:bg-white/20 dark:backdrop-blur-sm flex items-center justify-center text-white transition-opacity ${selectedIndex === 0 ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        aria-label="上一個"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={() => setSelectedIndex(1)}
        className={`absolute right-2 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/50 dark:bg-white/20 dark:backdrop-blur-sm flex items-center justify-center text-white transition-opacity ${selectedIndex === 1 ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        aria-label="下一個"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Indicator Dots & Label */}
      <div className="flex flex-col items-center gap-2 mt-4">
        <div className="flex justify-center gap-3">
          {[0, 1].map((index) => (
            <button
              key={index}
              onClick={() => setSelectedIndex(index)}
              className={`h-2 rounded-full transition-all duration-300 ${
                selectedIndex === index 
                  ? index === 0 ? 'bg-signals w-8' : 'bg-mentor w-8'
                  : 'bg-black/30 dark:bg-white/40 w-2 hover:bg-black/50 dark:hover:bg-white/60'
              }`}
              aria-label={index === 0 ? '跟單派戰情室' : '修煉派週記教學'}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground dark:text-white/60">
          {selectedIndex === 0 ? '跟單派戰情室' : '修煉派週記教學'} · {selectedIndex + 1}/2
        </p>
        <p className="text-muted-foreground dark:text-white/50 text-xs animate-pulse">
          ← 左右滑動切換 →
        </p>
      </div>
    </div>
  );
};

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
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-black/40 animate-fade-in" style={{ animationDuration: '1.5s' }} />
        
        <div className="container relative z-10 py-section">
          <div className="max-w-xl animate-fade-in">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-md text-primary-foreground leading-[1.15] drop-shadow-lg">
              讀萬卷書，不如緊跟大戶
            </h1>
            <p className="text-lg md:text-xl text-primary-foreground/80 mb-xl max-w-md leading-relaxed">
              21世紀用更愜意的方式賺錢
            </p>
            
            {/* Dual-Product CTA: Subscription (red) + Stock Dashboard (purple) */}
            <div className="flex flex-col sm:flex-row gap-sm">
              <Button size="xl" asChild>
                <Link to="/experts">
                  探索專家
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              <Button
                size="xl"
                className="bg-purple-600 hover:bg-purple-700 text-white border-0"
                asChild
              >
                <Link to="/free-checkup">
                  持股健檢
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
            <div className="mt-sm">
              <Link
                to="/pricing"
                className="text-sm text-primary-foreground/70 hover:text-primary-foreground underline underline-offset-4"
              >
                查看方案比較 →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Three Core Features Section - Magazine Layout */}
      <section className="py-section bg-muted/50 dark:bg-white/[0.02]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-[40%_60%] gap-12 lg:gap-20 items-start">
            {/* Left Column - Narrative */}
            <div className="lg:sticky lg:top-32">
              <p className="text-muted-foreground text-sm tracking-widest uppercase mb-sm">你會用到的三件事</p>
              <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-md leading-tight">三招定勝負</h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                訊號、路線、戰績，解放盯盤。
              </p>
              {/* Desktop CTA - Only visible on lg: */}
              <div className="hidden lg:block mt-8">
                <Button asChild size="lg" className="group">
                  <Link to="/pricing">
                    查看方案說明
                    <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
              </div>
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
                    backgroundImage: `url(${featureFiveFactions})`,
                    opacity: 0.75
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
                  <h3 className="text-2xl font-bold text-white mb-2 transition-all duration-300 group-hover:text-white group-hover:drop-shadow-lg">五大派系</h3>
                  <p className="text-white/70 leading-relaxed">
                    集結價值派、籌碼派、技術派、策略派、系統派，任你挑選最對味的交易門派。
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

              {/* Mobile CTA - Only visible below lg: */}
              <div className="lg:hidden flex justify-center mt-4">
                <Button asChild size="lg" className="group">
                  <Link to="/pricing">
                    查看方案說明
                    <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
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

          {/* VS Battle Arena - Mobile: Carousel, Desktop: side by side */}
          <MobileVsCarousel />
          
          {/* Desktop Layout - side by side */}
          <div className="hidden md:flex vs-arena relative items-center justify-center gap-10">
            
            {/* Left Fighter - 跟單派 (Red frame) */}
            <div className="vs-card vs-card-left w-[40%] relative cursor-pointer transition-all duration-500">
              {/* Card Frame - red border & glow */}
              <div 
                className="relative p-[6px] rounded-lg"
                style={{ 
                  background: 'linear-gradient(135deg, rgba(239,68,68,0.9) 0%, rgba(180,40,40,0.7) 100%)',
                  boxShadow: 'inset 0 0 2px rgba(255,255,255,0.4)'
                }}
              >
                {/* Card Body - dark background */}
                <div 
                  className="relative overflow-hidden w-full rounded-md"
                  style={{ 
                    minHeight: '340px',
                    backgroundColor: '#1a1a1a'
                  }}
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
                  
                  <div 
                    className="absolute inset-0 bg-cover transition-all duration-500"
                    style={{ 
                      backgroundImage: `url(${cardKungfuSpeed})`,
                      backgroundPosition: 'center right',
                      filter: 'brightness(1.2) contrast(1.1)'
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-black/20" />
                  
                  <div 
                    className="relative z-10 p-8 pb-10 flex flex-col h-full justify-end items-start text-left"
                    style={{ minHeight: '340px' }}
                  >
                    <p 
                      className="text-3xl lg:text-4xl text-white mb-4 text-left w-full"
                      style={{ fontFamily: '"Longyin Brush", cursive' }}
                    >
                      跟單派
                    </p>
                    <p className="text-white/70 text-lg italic mb-8 text-left">
                      「天下武功，唯快不破」
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Center VS - Desktop: Calligraphy Brush Mark */}
            <div className="flex items-center justify-center select-none pointer-events-none shrink-0 relative">
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

            {/* Right Fighter - 修煉派 (Blue frame) */}
            <div className="vs-card vs-card-right w-[40%] relative cursor-pointer transition-all duration-500">
              {/* Card Frame - blue border & glow */}
              <div 
                className="relative p-[6px] rounded-lg"
                style={{ 
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.9) 0%, rgba(40,80,180,0.7) 100%)',
                  boxShadow: 'inset 0 0 2px rgba(255,255,255,0.4)'
                }}
              >
                {/* Card Body - dark background */}
                <div 
                  className="relative overflow-hidden w-full rounded-md"
                  style={{ 
                    minHeight: '340px',
                    backgroundColor: '#1a1a1a'
                  }}
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
                  
                  <div 
                    className="absolute inset-0 bg-cover transition-all duration-500"
                    style={{ 
                      backgroundImage: `url(${cardKungfuBones})`,
                      backgroundPosition: 'center left',
                      filter: 'brightness(1.2) contrast(1.1)'
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-l from-black/80 via-black/40 to-black/20" />
                  
                  <div 
                    className="relative z-10 p-8 pb-10 flex flex-col h-full justify-end items-end text-right"
                    style={{ minHeight: '340px' }}
                  >
                    <p 
                      className="text-3xl lg:text-4xl text-white mb-4 text-right w-full"
                      style={{ fontFamily: '"Longyin Brush", cursive' }}
                    >
                      修煉派
                    </p>
                    <p className="text-white/70 text-lg italic mb-8 text-right">
                      「看你骨骼精奇，是個練武奇才」
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
        </div>
        
        {/* Unified Scroll Down Indicator */}
        <div className="flex flex-col items-center py-8 md:py-12">
          <button
            onClick={() => {
              document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground transition-colors group cursor-pointer"
          >
            <span className="text-sm">往下看會員畫面</span>
            <div className="flex flex-col items-center animate-bounce">
              <ChevronDown className="h-5 w-5 opacity-30" />
              <ChevronDown className="h-5 w-5 -mt-3 opacity-60" />
              <ChevronDown className="h-5 w-5 -mt-3 opacity-100" />
            </div>
          </button>
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
      <LazyOnVisible minHeight={600}>
      <section id="preview-section" className="py-section bg-card dark:bg-white/[0.03]">
        <div className="container">
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">產品真實畫面</p>
            <h2 className="text-h2 text-foreground">會員戰情室一覽</h2>
            <p className="text-muted-foreground mt-2">訂閱後，你會在戰情室看到這些內容</p>
          </div>

          {/* Mobile Swipeable Carousel */}
          <MobilePreviewCarousel />

          {/* Desktop Grid View */}
          <div className="hidden md:grid md:grid-cols-2 gap-lg md:gap-xl max-w-5xl mx-auto">
            {/* Signal List Preview - 跟單派 */}
            <div className="flex flex-col">
              <div className="bg-background dark:bg-white/5 rounded-lg border border-border dark:border-white/10 border-t-4 border-t-signals p-sm md:p-md mb-sm md:mb-md flex-1 flex flex-col">
                {/* 派別標籤 */}
                <div className="flex items-center gap-2 mb-3">
                  <Badge className="bg-signals/10 text-signals border border-signals/20 text-xs font-medium">
                    跟單派 · SIGNALS
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mb-sm md:mb-md pb-sm md:pb-md border-b border-border">
                  <Zap className="h-4 w-4 text-signals" />
                  <span className="text-xs md:text-sm font-medium">即時訊號牆</span>
                  <Badge variant="outline" className="text-[10px] ml-auto bg-signals/10 text-signals border-signals/20">即時</Badge>
                </div>
                <div className="space-y-1.5 md:space-y-2 flex-1">
                  {/* Sample Signal 1 */}
                  <div className="p-2 md:p-2.5 rounded-md bg-muted/50 border-l-2 border-success">
                    <div className="flex items-center justify-between mb-0.5 md:mb-1">
                      <span className="font-semibold text-[11px] md:text-xs">2330.TW 台積電</span>
                      <Badge className="bg-success/10 text-success text-[9px] md:text-[10px]">買進</Badge>
                    </div>
                    <p className="text-[9px] md:text-[10px] text-muted-foreground mb-0.5 md:mb-1">突破季線壓力，外資連續買超</p>
                    <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] text-muted-foreground">
                      <span>約 580-590</span>
                      <span>09:32</span>
                    </div>
                  </div>
                  {/* Sample Signal 2 */}
                  <div className="p-2 md:p-2.5 rounded-md bg-muted/50 border-l-2 border-primary">
                    <div className="flex items-center justify-between mb-0.5 md:mb-1">
                      <span className="font-semibold text-[11px] md:text-xs">2454.TW 聯發科</span>
                      <Badge className="bg-primary/10 text-primary text-[9px] md:text-[10px]">加碼</Badge>
                    </div>
                    <p className="text-[9px] md:text-[10px] text-muted-foreground mb-0.5 md:mb-1">續創新高，AI 晶片出貨成長</p>
                    <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] text-muted-foreground">
                      <span>約 1250-1280</span>
                      <span>10:15</span>
                    </div>
                  </div>
                  {/* Sample Signal 3 */}
                  <div className="p-2 md:p-2.5 rounded-md bg-muted/50 border-l-2 border-amber-500">
                    <div className="flex items-center justify-between mb-0.5 md:mb-1">
                      <span className="font-semibold text-[11px] md:text-xs">3008.TW 大立光</span>
                      <Badge className="bg-amber-500/10 text-amber-600 text-[9px] md:text-[10px]">減碼</Badge>
                    </div>
                    <p className="text-[9px] md:text-[10px] text-muted-foreground mb-0.5 md:mb-1">達目標價位，量能萎縮先獲利了結</p>
                    <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] text-muted-foreground">
                      <span>約 155-160</span>
                      <span>11:00</span>
                    </div>
                  </div>
                  {/* Sample Signal 4 */}
                  <div className="p-2 md:p-2.5 rounded-md bg-muted/50 border-l-2 border-success">
                    <div className="flex items-center justify-between mb-0.5 md:mb-1">
                      <span className="font-semibold text-[11px] md:text-xs">2317.TW 鴻海</span>
                      <Badge className="bg-success/10 text-success text-[9px] md:text-[10px]">買進</Badge>
                    </div>
                    <p className="text-[9px] md:text-[10px] text-muted-foreground mb-0.5 md:mb-1">站上所有均線，外資連續買超</p>
                    <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] text-muted-foreground">
                      <span>約 178-182</span>
                      <span>13:45</span>
                    </div>
                  </div>
                  {/* Sample Signal 5 */}
                  <div className="p-2 md:p-2.5 rounded-md bg-muted/50 border-l-2 border-destructive">
                    <div className="flex items-center justify-between mb-0.5 md:mb-1">
                      <span className="font-semibold text-[11px] md:text-xs">2603.TW 長榮</span>
                      <Badge className="bg-destructive/10 text-destructive text-[9px] md:text-[10px]">出場</Badge>
                    </div>
                    <p className="text-[9px] md:text-[10px] text-muted-foreground mb-0.5 md:mb-1">跌破支撐，執行停損紀律</p>
                    <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] text-muted-foreground">
                      <span>約 185-188</span>
                      <span>14:20</span>
                    </div>
                  </div>
                </div>
              </div>
              <h4 className="text-base md:text-h5 mb-xs text-foreground">跟單派戰情室</h4>
              <p className="text-muted-foreground text-xs md:text-sm leading-relaxed">
                即時接收專家買賣訊號，包含價位區間與操作理由。
              </p>
            </div>

            {/* 修煉派 - 週記式交易紀錄預覽 */}
            <div className="flex flex-col">
              <div className="bg-background dark:bg-white/5 rounded-lg border border-border dark:border-white/10 border-t-4 border-t-mentor p-sm md:p-md mb-sm md:mb-md flex-1 flex flex-col">
                {/* 派別標籤 */}
                <div className="flex items-center gap-2 mb-3">
                  <Badge className="bg-mentor/10 text-mentor border border-mentor/20 text-xs font-medium">
                    修煉派 · LEARNING
                  </Badge>
                </div>
                
                {/* 標題區 */}
                <div className="flex items-center justify-between mb-sm md:mb-md pb-sm md:pb-md border-b border-border">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-mentor" />
                    <span className="text-xs md:text-sm font-medium">本週操作紀錄</span>
                  </div>
                  <div className="flex items-center gap-1.5 md:gap-2">
                    <Badge variant="outline" className="text-[9px] md:text-[10px] bg-mentor/10 text-mentor border-mentor/20">週記</Badge>
                    <span className="text-[10px] md:text-xs text-muted-foreground">12/23~12/27</span>
                  </div>
                </div>
                
                {/* 每日交易列表 - 週一到週五 */}
                <div className="space-y-1.5 md:space-y-2 flex-1">
                  {/* 週一 */}
                  <div className="flex items-center gap-2 md:gap-3 p-1.5 md:p-2 rounded-lg bg-muted/30">
                    <span className="text-[10px] md:text-xs text-muted-foreground w-6 md:w-8 shrink-0">週一</span>
                    <Badge className="bg-success/10 text-success text-[9px] md:text-[10px] shrink-0">買進</Badge>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] md:text-xs font-medium">2303.TW 聯電</span>
                      <p className="text-[9px] md:text-[10px] text-muted-foreground truncate">突破短期壓力，量能放大</p>
                    </div>
                    <Badge variant="outline" className="text-[9px] md:text-[10px] text-success">+3.5%</Badge>
                  </div>
                  
                  {/* 週二 */}
                  <div className="flex items-center gap-2 md:gap-3 p-1.5 md:p-2 rounded-lg bg-muted/30">
                    <span className="text-[10px] md:text-xs text-muted-foreground w-6 md:w-8 shrink-0">週二</span>
                    <Badge className="bg-success/10 text-success text-[9px] md:text-[10px] shrink-0">買進</Badge>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] md:text-xs font-medium">3037.TW 欣興</span>
                      <p className="text-[9px] md:text-[10px] text-muted-foreground truncate">跳空上漲，追蹤 ABF 載板題材</p>
                    </div>
                    <Badge variant="outline" className="text-[9px] md:text-[10px] text-destructive">-2.8%</Badge>
                  </div>
                  
                  {/* 週三 */}
                  <div className="flex items-center gap-2 md:gap-3 p-1.5 md:p-2 rounded-lg bg-muted/30">
                    <span className="text-[10px] md:text-xs text-muted-foreground w-6 md:w-8 shrink-0">週三</span>
                    <Badge className="bg-success/10 text-success text-[9px] md:text-[10px] shrink-0">買進</Badge>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] md:text-xs font-medium">2317.TW 鴻海</span>
                      <p className="text-[9px] md:text-[10px] text-muted-foreground truncate">站上所有均線，外資連買</p>
                    </div>
                    <Badge variant="outline" className="text-[9px] md:text-[10px] text-success">+4.2%</Badge>
                  </div>
                  
                  {/* 週四 - 觀望 */}
                  <div className="flex items-center gap-2 md:gap-3 p-1.5 md:p-2 rounded-lg bg-muted/20">
                    <span className="text-[10px] md:text-xs text-muted-foreground w-6 md:w-8 shrink-0">週四</span>
                    <span className="text-[9px] md:text-[10px] text-muted-foreground italic">— 觀望無操作</span>
                  </div>
                  
                  {/* 週五 */}
                  <div className="flex items-center gap-2 md:gap-3 p-1.5 md:p-2 rounded-lg bg-muted/30">
                    <span className="text-[10px] md:text-xs text-muted-foreground w-6 md:w-8 shrink-0">週五</span>
                    <Badge className="bg-amber-500/10 text-amber-600 text-[9px] md:text-[10px] shrink-0">減碼</Badge>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] md:text-xs font-medium">2303.TW 聯電</span>
                      <p className="text-[9px] md:text-[10px] text-muted-foreground truncate">達目標價位，獲利了結</p>
                    </div>
                    <Badge variant="outline" className="text-[9px] md:text-[10px] text-success">已鎖利</Badge>
                  </div>
                </div>
                
                {/* 本週教學重點 */}
                <div className="mt-3 md:mt-4 pt-2 md:pt-3 border-t border-border">
                  <div className="flex items-center gap-1 mb-1.5 md:mb-2">
                    <Lightbulb className="h-3 w-3 text-mentor" />
                    <span className="text-[9px] md:text-[10px] font-medium text-muted-foreground">本週教學重點</span>
                  </div>
                  <ul className="space-y-0.5 md:space-y-1 text-[9px] md:text-[10px] text-muted-foreground">
                    <li className="flex items-start gap-1">
                      <span className="text-mentor">•</span> 嚴格執行停損是短線操作的關鍵
                    </li>
                    <li className="flex items-start gap-1">
                      <span className="text-mentor">•</span> 量能確認後再進場可提高勝率
                    </li>
                  </ul>
                </div>
              </div>
              <h4 className="text-base md:text-h5 mb-xs text-foreground">修煉派週記教學</h4>
              <p className="text-muted-foreground text-xs md:text-sm leading-relaxed">
                每週回顧導師的實際操作，包含進出場理由與學習重點（T+7 延遲）。
              </p>
            </div>
          </div>

          {/* CTA Button */}
          <div className="text-center mt-lg md:mt-xl">
            <Link to="/pricing">
              <Button size="lg" className="bg-primary hover:bg-primary/90">
                <ArrowRight className="mr-2 h-4 w-4" />
                方案說明
              </Button>
            </Link>
          </div>
        </div>
      </section>
      </LazyOnVisible>

      {/* Stock Dashboard Section - 持股看板（紫色主視覺） */}
      <LazyOnVisible minHeight={500}>
      <section className="py-section bg-background">
        <div className="container">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-xl">
              <Badge className="bg-purple-100 text-purple-700 border border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30 mb-sm">
                持股看板 · STOCK DASHBOARD
              </Badge>
              <h2 className="text-h2 text-foreground mb-xs">不想跟單？讓 AI 顧好你的持股</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                輸入持股，AI 幫你盯盤、預測事件、彙整新聞——免費，無需註冊。
              </p>
            </div>

            <div className="grid lg:grid-cols-[1fr_1.1fr] gap-xl items-center">
              <div className="space-y-md">
                {[
                  { icon: BarChart3, title: 'AI 持倉健檢', desc: '一鍵分析你的持股結構，找出風險與機會。' },
                  { icon: Calendar, title: '事件預測', desc: '法說會、除權息、財報日，提前掌握關鍵節點。' },
                  { icon: LineChart, title: '新聞與績效彙整', desc: '個股新聞、損益走勢、獲利排行，一頁看懂。' },
                ].map((item) => (
                  <div key={item.title} className="flex gap-md items-start">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300 shrink-0">
                      <item.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-h5 mb-xs text-foreground">{item.title}</h4>
                      <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
                <div className="pt-sm">
                  <Button size="xl" className="bg-purple-600 hover:bg-purple-700 text-white border-0" asChild>
                    <Link to="/free-checkup">
                      免費試用持股看板
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="bg-card dark:bg-white/[0.03] rounded-xl border border-border dark:border-purple-500/20 border-t-4 border-t-purple-500 p-md md:p-lg">
                <div className="flex items-center justify-between mb-md pb-sm border-b border-border">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    <span className="text-sm font-medium">我的持股</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-600 dark:text-purple-300">
                    AI 分析中
                  </Badge>
                </div>
                <div className="space-y-2">
                  {[
                    { code: '2330', name: '台積電', qty: '2,000', pct: '+12.4%', tone: 'up', note: '法說 12/16' },
                    { code: '2454', name: '聯發科', qty: '1,000', pct: '+5.8%', tone: 'up', note: 'AI 出貨成長' },
                    { code: '2603', name: '長榮', qty: '5,000', pct: '-3.2%', tone: 'down', note: '建議檢視' },
                  ].map((h) => (
                    <div key={h.code} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{h.code}</span>
                          <span className="text-sm text-foreground">{h.name}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">持有 {h.qty} 股 · {h.note}</p>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ${h.tone === 'up' ? 'text-destructive' : 'text-success'}`}>
                        {h.pct}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-md pt-sm border-t border-border">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Lightbulb className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                    <span>AI 建議：長榮跌破支撐，可考慮減碼</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      </LazyOnVisible>

      {/* Weekly Limit Up Leaderboard */}
      <LazyOnVisible minHeight={400}>
      <section className="py-section bg-card dark:bg-white/[0.03]">
        <div className="container">
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">即時更新，展現真實戰績</p>
            <h2 className="text-h2 text-foreground">本週漲停王排行榜</h2>
          </div>
          <div className="max-w-2xl mx-auto">
            <WeeklyLimitUpLeaderboardSection />
          </div>
        </div>
      </section>
      </LazyOnVisible>

      {/* How It Works - Dual Path */}
      <LazyOnVisible minHeight={400}>
      <section className="py-section bg-card dark:bg-white/[0.03]">
        <div className="container">
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">兩條動線，依需求選擇</p>
            <h2 className="text-h2 text-foreground">如何開始？</h2>
          </div>

          <div className="grid lg:grid-cols-2 gap-lg max-w-6xl mx-auto">
            {/* Path A - 跟單訂閱 */}
            <div className="rounded-xl border border-border bg-background dark:bg-white/[0.02] border-t-4 border-t-primary p-md md:p-lg">
              <div className="mb-md">
                <Badge className="bg-primary/10 text-primary border border-primary/20 mb-xs">想跟單高手？</Badge>
                <h3 className="text-h4 text-foreground">訂閱專家動線</h3>
              </div>
              <div className="grid grid-cols-2 gap-sm mb-md">
                {[
                  { step: 1, icon: Users, title: '選擇專家', desc: '投顧或實戰導師' },
                  { step: 2, icon: BarChart3, title: '選擇方案', desc: '依需求挑選' },
                  { step: 3, icon: Radio, title: 'LINE 接收', desc: '即時訊號推播' },
                  { step: 4, icon: GraduationCap, title: '持續學習', desc: '建立投資系統' },
                ].map((item) => (
                  <div key={item.step} className="flex gap-sm items-start p-sm rounded-lg bg-muted/40">
                    <Badge variant="secondary" className="shrink-0">{item.step}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Button size="lg" className="w-full" asChild>
                <Link to="/experts">
                  探索專家
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>

            {/* Path B - 持股看板 */}
            <div className="rounded-xl border border-border bg-background dark:bg-white/[0.02] border-t-4 border-t-purple-500 p-md md:p-lg">
              <div className="mb-md">
                <Badge className="bg-purple-100 text-purple-700 border border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30 mb-xs">想管自己的持股？</Badge>
                <h3 className="text-h4 text-foreground">持股看板動線</h3>
              </div>
              <div className="grid grid-cols-2 gap-sm mb-md">
                {[
                  { step: 1, icon: Target, title: '免費健檢', desc: '無需註冊' },
                  { step: 2, icon: BarChart3, title: '輸入持股', desc: '股票代號與張數' },
                  { step: 3, icon: Zap, title: 'AI 分析', desc: '結構與風險洞察' },
                  { step: 4, icon: LineChart, title: '雲端同步', desc: '事件、新聞、績效' },
                ].map((item) => (
                  <div key={item.step} className="flex gap-sm items-start p-sm rounded-lg bg-muted/40">
                    <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300 border-0 shrink-0">{item.step}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Button size="lg" className="w-full bg-purple-600 hover:bg-purple-700 text-white border-0" asChild>
                <Link to="/free-checkup">
                  開始持股健檢
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
      </LazyOnVisible>

      {/* Final CTA - Dual Product */}
      <LazyOnVisible minHeight={300}>
      <section className="py-section bg-card dark:bg-white/[0.03]">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <p className="text-muted-foreground text-sm mb-xs">兩種服務，依你需要的方式開始</p>
            <h2 className="text-h2 mb-md text-foreground">
              準備好開始了嗎？
            </h2>
            <div className="flex flex-col sm:flex-row gap-md justify-center">
              <Button size="xl" asChild>
                <Link to="/experts">
                  探索專家
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              <Button size="xl" className="bg-purple-600 hover:bg-purple-700 text-white border-0" asChild>
                <Link to="/free-checkup">
                  免費健檢
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
            <div className="mt-md">
              <Link to="/auth/register" className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4">
                或先免費註冊帳號 →
              </Link>
            </div>
          </div>
        </div>
      </section>

    </PortalLayout>
  );
};

export default Index;
