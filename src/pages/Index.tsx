import { Link } from 'react-router-dom';
import { SEOLite as SEO } from '@/components/SEOLite';
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
  Lightbulb,
  Flame,
  Trophy,
  Clock,
  History,
  ScrollText
} from 'lucide-react';
import featureXianren from '@/assets/feature-xianren.webp';
import featureSanpai from '@/assets/feature-sanpai.webp';
import featureJiaodai from '@/assets/feature-jiaodai.webp';
import featureFiveFactions from '@/assets/feature-five-factions.webp';
import jianghuFollowBg from '@/assets/jianghu-follow-bg.png';
import jianghuStudyBg from '@/assets/jianghu-study-bg.png';
import jianghuSectionBg from '@/assets/jianghu-section-bg.jpg';
import iconLightningCircle from '@/assets/icon-lightning-circle.svg';
import iconBookCircle from '@/assets/icon-book-circle.svg';

import { LazyOnVisible } from '@/components/LazyOnVisible';
import { InkFade } from '@/components/jianghu/InkFade';


// Batch1-#2: idle prefetch moved to centralized prefetchHighTrafficRoutes()
// in src/lib/routePrefetch.ts (invoked from AttributionTracker in App.tsx).





const Index = () => {
  return (
    <PortalLayout>
      <SEO
        title="智富股市實戰學院 | 投顧分析師與實戰導師訂閱平台"
        description="專業投顧分析師即時策略訊號 × 實戰導師 T+7 教學週記。穩健、合規、教育為先，幫助投資人建立屬於自己的投資系統。"
        path="/"
      />
      {/* Hero Section - Strong Contrast, Minimal Text */}
      <section className="relative overflow-hidden min-h-[70vh] flex items-center bg-black">
        {/* Background Video — lazy: only loads after first paint to avoid
            competing with hero JS/CSS for bandwidth. The black section bg
            acts as the poster. */}
        <video
          ref={(el) => {
            if (!el || el.dataset.lfLoaded === '1') return;
            el.dataset.lfLoaded = '1';
            const attach = () => {
              if (el.querySelector('source')) return;
              const s = document.createElement('source');
              s.src = '/videos/hero-bg.mp4';
              s.type = 'video/mp4';
              el.appendChild(s);
              el.load();
            };
            const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
            if (w.requestIdleCallback) w.requestIdleCallback(attach, { timeout: 1500 });
            else window.setTimeout(attach, 600);
          }}
          autoPlay
          loop
          muted
          playsInline
          preload="none"
          width={1920}
          height={1080}
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover animate-fade-in"
          style={{ animationDuration: '1.5s', objectPosition: 'center center' }}
        />

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
            
            {/* Primary CTA: 開始看懂我的持股 + secondary 探索專家 */}
            <div className="flex flex-col sm:flex-row gap-sm">
              <Button
                size="xl"
                asChild
                style={{ backgroundColor: '#EC662D', color: '#fff' }}
                className="hover:brightness-110 border-0 shadow-[0_10px_30px_-12px_rgba(236,102,45,0.65)]"
              >
                <Link to="/holding-checkup">
                  開始看懂我的持股
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              <Button
                size="xl"
                variant="outline"
                asChild
                className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white"
              >
                <Link to="/experts">
                  探索專家
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
            <p className="mt-sm text-sm md:text-[15px] text-primary-foreground/75 leading-relaxed">
              不用猜消息，先看訊號、路線與戰績。
            </p>
            <div className="mt-2">
              <Link
                to="/pricing"
                className="text-xs text-primary-foreground/55 hover:text-primary-foreground/90 underline underline-offset-4"
              >
                查看方案比較 →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Three Core Features Section - Magazine Layout */}
      <section className="relative py-section" style={{ background: 'hsl(var(--jh-paper-light))' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-[40%_60%] gap-12 lg:gap-20 items-start">
            {/* Left Column - Narrative */}
            <div className="lg:sticky lg:top-32">
              <p className="text-muted-foreground text-sm tracking-widest uppercase mb-sm">市場太亂的時候，先回到這三件事</p>
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

            {/* Right Column - Staggered Cards (full-visible, layered) */}
            <div className="flex flex-col gap-5 lg:pr-2">
              {/* Card 01 - 看懂訊號 */}
              <div 
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl lg:ml-0 lg:mr-10"
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
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/30 transition-opacity duration-300 group-hover:opacity-80" 
                />
                <span className="absolute top-4 left-5 text-6xl font-bold text-white/10 select-none" style={{ fontFamily: '"Noto Serif TC","Source Serif 4",serif' }}>01</span>
                <span className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#EC662D' }} />
                
                <div className="relative z-10 p-8 pt-16 pb-9">
                  <h3 className="text-2xl md:text-[28px] font-bold text-white mb-2" style={{ fontFamily: '"Noto Serif TC",serif', letterSpacing: '0.05em' }}>看懂訊號</h3>
                  <p className="text-white/75 leading-relaxed text-[15px]">
                    不是猜消息，而是先看市場留下的痕跡。
                  </p>
                </div>
              </div>

              {/* Card 02 - 找出戰線 */}
              <div 
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl lg:ml-5 lg:mr-5"
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
                    opacity: 0.7
                  }}
                />
                <div 
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/30 transition-opacity duration-300 group-hover:opacity-80" 
                />
                <span className="absolute top-4 left-5 text-6xl font-bold text-white/10 select-none" style={{ fontFamily: '"Noto Serif TC","Source Serif 4",serif' }}>02</span>
                <span className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#EC662D' }} />
                
                <div className="relative z-10 p-8 pt-16 pb-9">
                  <h3 className="text-2xl md:text-[28px] font-bold text-white mb-2" style={{ fontFamily: '"Noto Serif TC",serif', letterSpacing: '0.05em' }}>找出戰線</h3>
                  <p className="text-white/75 leading-relaxed text-[15px]">
                    從資金、籌碼與價格，判斷該守還是該退。
                  </p>
                </div>
              </div>

              {/* Card 03 - 招招有交代 */}
              <div 
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl lg:ml-10 lg:mr-0"
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
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/30 transition-opacity duration-300 group-hover:opacity-80" 
                />
                <span className="absolute top-4 left-5 text-6xl font-bold text-white/10 select-none" style={{ fontFamily: '"Noto Serif TC","Source Serif 4",serif' }}>03</span>
                <span className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#EC662D' }} />
                
                <div className="relative z-10 p-8 pt-16 pb-9">
                  <h3 className="text-2xl md:text-[28px] font-bold text-white mb-2" style={{ fontFamily: '"Noto Serif TC",serif', letterSpacing: '0.05em' }}>招招有交代</h3>
                  <p className="text-white/75 leading-relaxed text-[15px]">
                    勝率、報酬、回測全部公開，不靠一句老師說。
                  </p>
                </div>
              </div>

              {/* Mobile CTA */}
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

      {/* 三招(紙) → 選你的模式(紙) — 同屬淺紙場景，無需過渡 */}


      {/* 江湖兩派 — Premium editorial / ink-wash version */}
      <LazyOnVisible mode="content-visibility" minHeight={1400}>
      <section
        className="relative overflow-hidden pt-6 md:pt-8 pb-0"
        style={{ backgroundColor: '#EFE7D6' }}
      >
        {/* Ink-wash mountain backdrop — very faint, top of section only */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{
            height: '70%',
            backgroundImage: `url(${jianghuSectionBg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            backgroundRepeat: 'no-repeat',
            opacity: 0.42,
            maskImage:
              'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.85) 55%, rgba(0,0,0,0) 100%)',
          }}
        />
        {/* Subtle paper grain */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%222%22 stitchTiles=%22stitch%22/><feColorMatrix values=%220 0 0 0 0.06  0 0 0 0 0.05  0 0 0 0 0.04  0 0 0 0.06 0%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/></svg>')",
            mixBlendMode: 'multiply',
            opacity: 0.6,
          }}
        />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          {/* Eyebrow + Title */}
          <div className="text-center mb-6 md:mb-8">
            <p
              className="text-xs md:text-sm tracking-[0.4em] mb-2"
              style={{ color: '#EC662D', fontFamily: '"Noto Serif TC", serif' }}
            >
              看懂三招之後，挑一條你想走的路
            </p>
            <h2
              className="text-3xl md:text-4xl lg:text-5xl font-bold mb-2"
              style={{ color: '#171717', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
            >
              選你的模式
            </h2>
            <p className="text-sm md:text-base mb-1.5" style={{ color: 'rgba(23,23,23,0.65)' }}>
              不同的投資哲學，同樣的致勝之道
            </p>
            <p className="text-xs md:text-sm" style={{ color: 'rgba(23,23,23,0.5)' }}>
              想直接跟著訊號行動，選跟單派；想學會判斷市場，選修煉派。
            </p>
          </div>


          {/* Two-card grid */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 md:gap-5 items-stretch">
            {/* Left — 跟單派 */}
            <Link
              to="/experts?role=advisor"
              className="jianghu-card group relative block overflow-hidden rounded-2xl"
              style={{
                aspectRatio: '4 / 5',
                border: '1px solid rgba(23,23,23,0.14)',
                backgroundColor: '#1a1a1a',
              }}
            >
              {/* Background image */}
              <div
                className="absolute inset-0 bg-no-repeat jianghu-card-bg"
                style={{
                  backgroundImage: `url(${jianghuFollowBg})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center center',
                }}
              />
              {/* Text-safe overlay — 加深以露出更多上半部資訊 */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.78) 35%, rgba(0,0,0,0.42) 62%, rgba(0,0,0,0.05) 100%)',
                }}
              />
              {/* 右上角「進入此派」標籤 */}
              <span
                className="absolute z-20 top-4 right-4 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] md:text-[11px] font-medium tracking-wider backdrop-blur-sm transition-all duration-300 group-hover:bg-[rgba(236,102,45,0.95)] group-hover:text-white"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.22)',
                }}
              >
                進入此派 <ArrowRight className="w-3 h-3" />
              </span>
              {/* Hover 底部橘色光邊 */}
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[3px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background: 'linear-gradient(to right, transparent, #EC662D 50%, transparent)',
                  boxShadow: '0 0 24px rgba(236,102,45,0.6)',
                }}
              />
              {/* Content — 拉高位置讓更多資訊露出 */}
              <div
                className="absolute z-10"
                style={{ bottom: '28px', left: '32px', right: '32px', maxWidth: '420px' }}
              >
                <img
                  src={iconLightningCircle}
                  alt=""
                  className="w-10 h-10 md:w-12 md:h-12 mb-3"
                  loading="lazy"
                />
                <h3
                  className="text-2xl md:text-[32px] font-bold text-white mb-1.5"
                  style={{ fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.08em' }}
                >
                  跟單派
                </h3>
                <p className="text-sm md:text-base mb-2.5" style={{ color: '#EC662D' }}>
                  跟著高手，即刻出擊
                </p>
                <p
                  className="inline-block text-[11px] md:text-xs px-2 py-1 rounded-sm mb-3"
                  style={{
                    color: 'rgba(255,255,255,0.92)',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.18)',
                  }}
                >
                  適合：想要明確訊號的人
                </p>
                <span
                  className="flex items-center gap-2 text-sm md:text-base font-medium"
                  style={{ color: '#EC662D' }}
                >
                  了解更多
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1.5" />
                </span>
              </div>
            </Link>

            {/* Divider — 垂直引導：橘線 / 文字 / chevron / 小圓點 */}
            <div className="hidden md:flex flex-col items-center justify-center" style={{ width: '64px' }}>
              <div
                aria-hidden="true"
                style={{
                  width: 1,
                  height: 72,
                  background: 'linear-gradient(to bottom, transparent, rgba(236,102,45,0.55))',
                }}
              />
              <p
                className="my-3 text-[10px] tracking-[0.45em] writing-vertical-rl"
                style={{
                  color: 'rgba(23,23,23,0.55)',
                  fontFamily: '"Noto Serif TC", serif',
                  writingMode: 'vertical-rl',
                  textOrientation: 'upright',
                  letterSpacing: '0.35em',
                }}
              >
                選擇你的道路
              </p>
              <div className="flex flex-col items-center" aria-hidden="true">
                <ChevronDown className="h-3.5 w-3.5" style={{ color: 'rgba(236,102,45,0.5)' }} />
                <ChevronDown className="h-3.5 w-3.5 -mt-2" style={{ color: 'rgba(236,102,45,0.85)' }} />
              </div>
              <div
                aria-hidden="true"
                className="mt-3"
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  backgroundColor: '#EC662D',
                  boxShadow: '0 0 8px rgba(236,102,45,0.6)',
                }}
              />
            </div>

            {/* Right — 修煉派 */}
            <Link
              to="/experts?role=mentor"
              className="jianghu-card group relative block overflow-hidden rounded-2xl"
              style={{
                aspectRatio: '4 / 5',
                border: '1px solid rgba(23,23,23,0.14)',
                backgroundColor: '#1a1a1a',
              }}
            >
              <div
                className="absolute inset-0 bg-no-repeat jianghu-card-bg"
                style={{
                  backgroundImage: `url(${jianghuStudyBg})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center center',
                }}
              />
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.78) 35%, rgba(0,0,0,0.42) 62%, rgba(0,0,0,0.05) 100%)',
                }}
              />
              <span
                className="absolute z-20 top-4 right-4 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] md:text-[11px] font-medium tracking-wider backdrop-blur-sm transition-all duration-300 group-hover:bg-[rgba(236,102,45,0.95)] group-hover:text-white"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.22)',
                }}
              >
                進入此派 <ArrowRight className="w-3 h-3" />
              </span>
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[3px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background: 'linear-gradient(to right, transparent, #EC662D 50%, transparent)',
                  boxShadow: '0 0 24px rgba(236,102,45,0.6)',
                }}
              />
              <div
                className="absolute z-10"
                style={{ bottom: '28px', left: '32px', right: '32px', maxWidth: '420px' }}
              >
                <img
                  src={iconBookCircle}
                  alt=""
                  className="w-10 h-10 md:w-12 md:h-12 mb-3"
                  loading="lazy"
                />
                <h3
                  className="text-2xl md:text-[32px] font-bold text-white mb-1.5"
                  style={{ fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.08em' }}
                >
                  修煉派
                </h3>
                <p className="text-sm md:text-base mb-2.5" style={{ color: '#EC662D' }}>
                  修煉內功，掌控全局
                </p>
                <p
                  className="inline-block text-[11px] md:text-xs px-2 py-1 rounded-sm mb-3"
                  style={{
                    color: 'rgba(255,255,255,0.92)',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.18)',
                  }}
                >
                  適合：想學判斷框架的人
                </p>
                <span
                  className="flex items-center gap-2 text-sm md:text-base font-medium"
                  style={{ color: '#EC662D' }}
                >
                  了解更多
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1.5" />
                </span>
              </div>
            </Link>
          </div>


          {/* Footnote */}
          <p
            className="text-center mt-6 text-sm md:text-base"
            style={{ color: 'rgba(23,23,23,0.6)' }}
          >
            兩派會員皆可享有 <span style={{ color: '#EC662D', fontWeight: 600 }}>legendflow</span> 完整生態系統服務
          </p>
        </div>

        {/* 過渡敘事 — 兩派收束 → 內門戰情室（連續墨色暈染） */}
        <div className="relative flex flex-col items-center pt-2 md:pt-2 pb-0">
          {/* 從左右兩派卡片底部往中間收束的弧線 */}
          <svg
            aria-hidden="true"
            viewBox="0 0 1000 64"
            preserveAspectRatio="none"
            className="w-full max-w-5xl h-8 md:h-10 -mt-1"
          >
            <defs>
              <linearGradient id="conv-left-arc" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(236,102,45,0)" />
                <stop offset="55%" stopColor="rgba(236,102,45,0.75)" />
                <stop offset="100%" stopColor="rgba(236,102,45,0.95)" />
              </linearGradient>
              <linearGradient id="conv-right-arc" x1="1" y1="0" x2="0" y2="0">
                <stop offset="0%" stopColor="rgba(212,166,67,0)" />
                <stop offset="55%" stopColor="rgba(212,166,67,0.75)" />
                <stop offset="100%" stopColor="rgba(212,166,67,0.95)" />
              </linearGradient>
            </defs>
            <path d="M 20 4 C 280 4, 420 56, 500 60" fill="none" stroke="url(#conv-left-arc)" strokeWidth="1.4" />
            <path d="M 980 4 C 720 4, 580 56, 500 60" fill="none" stroke="url(#conv-right-arc)" strokeWidth="1.4" />
          </svg>

          <button
            onClick={() => {
              document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex flex-col items-center gap-1.5 cursor-pointer text-center px-6"
            style={{ color: 'rgba(23,23,23,0.82)' }}
          >
            <span
              className="text-base md:text-lg font-medium"
              style={{ fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.06em' }}
            >
              選定路線後，所有訊號都會回到同一個戰情室
            </span>
            <span
              className="text-[10px] tracking-[0.35em] uppercase mt-1"
              style={{ color: 'rgba(236,102,45,0.85)' }}
            >
              入　門
            </span>
          </button>
        </div>

      </section>
      </LazyOnVisible>


      <style>{`
        .jianghu-card {
          transition: transform 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease;
          box-shadow: 0 18px 40px -22px rgba(0,0,0,0.55);
        }
        .jianghu-card:hover {
          transform: translateY(-6px);
          border-color: rgba(236,102,45,0.6) !important;
          box-shadow:
            0 32px 60px -24px rgba(0,0,0,0.7),
            0 18px 40px -18px rgba(236,102,45,0.45),
            0 0 0 1px rgba(236,102,45,0.35);
        }
        .jianghu-card-bg {
          transition: transform 0.7s ease;
        }
        .jianghu-card:hover .jianghu-card-bg {
          transform: scale(1.03);
        }
      `}</style>



      {/* Seam: 選你的模式(紙) → 會員戰情室(墨) */}
      <InkFade direction="paper-to-ink" height={150} paperColor="#EFE7D6" inkColor="#0E0C0A" />

      {/* Real Interface Preview Section — 會員戰情室 */}
      <LazyOnVisible mode="content-visibility" minHeight={1000}>
      <section
        id="preview-section"
        className="relative py-section overflow-hidden"
        style={{ backgroundColor: '#0E0C0A' }}
      >


        {/* 暖光 radial — 中心標題後方（保留，加強戰情室氛圍） */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 pointer-events-none"
          style={{
            top: 260, height: '40%',
            background:
              'radial-gradient(ellipse 55% 70% at 50% 30%, rgba(236,102,45,0.12), rgba(236,102,45,0.04) 45%, transparent 75%)',
          }}
        />
        {/* 左右卡片背後低透明度橘色暈光 */}
        <div
          aria-hidden="true"
          className="absolute pointer-events-none hidden md:block"
          style={{
            left: '4%', top: '50%', width: '38%', height: '40%',
            background: 'radial-gradient(ellipse, rgba(236,102,45,0.10), transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          aria-hidden="true"
          className="absolute pointer-events-none hidden md:block"
          style={{
            right: '4%', top: '50%', width: '38%', height: '40%',
            background: 'radial-gradient(ellipse, rgba(212,166,67,0.08), transparent 70%)',
            filter: 'blur(60px)',
          }}
        />

        <div className="container relative z-10">
          {/* 菱形標記 — 接住中央橘線 */}
          <div className="flex flex-col items-center mb-3">
            <div
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                transform: 'rotate(45deg)',
                background: 'rgba(236,102,45,0.7)',
                boxShadow: '0 0 12px rgba(236,102,45,0.5)',
              }}
            />
          </div>


          {/* Eyebrow + H2 + Sub — 緊湊精緻 */}
          <div className="text-center mb-8 md:mb-10">
            <p
              className="text-[11px] md:text-xs tracking-[0.4em] uppercase mb-1.5"
              style={{ color: '#EC662D', fontFamily: '"Noto Serif TC", serif' }}
            >
              選定路線後，所有訊號都會回到同一個戰情室
            </p>

            <h2
              className="text-3xl md:text-4xl lg:text-[44px] font-bold mb-3"
              style={{ color: '#F4ECDB', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
            >
              入門之後，進入你的戰情室
            </h2>
            <p className="text-sm md:text-base mb-4" style={{ color: 'rgba(244,236,219,0.72)' }}>
              訊號、操作紀錄、戰績回顧，都會收進同一張戰局圖裡。
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] md:text-xs tracking-wider"
                style={{ backgroundColor: 'rgba(236,102,45,0.12)', color: '#EC662D', border: '1px solid rgba(236,102,45,0.3)' }}
              >
                <Zap className="h-3 w-3" />
                跟單派訊號
              </span>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] md:text-xs tracking-wider"
                style={{ backgroundColor: 'rgba(212,166,67,0.12)', color: '#D4A643', border: '1px solid rgba(212,166,67,0.3)' }}
              >
                <BookOpen className="h-3 w-3" />
                修煉派復盤
              </span>
            </div>
          </div>


          {/* Grid — 手機上下堆疊，桌機左右並排，等高 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 max-w-5xl mx-auto px-5 md:px-0">
            {/* ── 跟單派戰情室 ── */}
            <div className="flex flex-col">
              <div
                className="warroom-card flex-1 flex flex-col rounded-xl overflow-hidden"
                style={{
                  backgroundColor: 'rgba(20,17,13,0.85)',
                  border: '1px solid rgba(236,102,45,0.22)',
                  boxShadow: '0 30px 60px -30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
              >
                {/* Card header — 固定高度功能列 */}
                <div
                  className="flex items-center justify-between px-5 py-4 border-b"
                  style={{ borderColor: 'rgba(236,102,45,0.18)', minHeight: 64 }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-medium tracking-wider"
                      style={{ backgroundColor: 'rgba(236,102,45,0.12)', color: '#EC662D', border: '1px solid rgba(236,102,45,0.3)' }}
                    >
                      <Zap className="h-3 w-3" />
                      SIGNALS
                    </span>
                    <span
                      className="text-sm font-medium"
                      style={{ color: '#F4ECDB', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
                    >
                      即時訊號牆
                    </span>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] tracking-wider"
                    style={{ backgroundColor: 'rgba(236,102,45,0.1)', color: '#EC662D', border: '1px solid rgba(236,102,45,0.25)' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#EC662D' }} />
                    即時
                  </span>
                </div>

                {/* 可信度輔助說明 */}
                <div
                  className="px-5 py-2 border-b"
                  style={{ borderColor: 'rgba(212,166,67,0.10)', backgroundColor: 'rgba(212,166,67,0.03)' }}
                >
                  <p className="text-[10.5px] leading-relaxed" style={{ color: 'rgba(244,236,219,0.45)', letterSpacing: '0.03em' }}>
                    收盤後同步更新，訊號僅供會員追蹤與復盤。
                  </p>
                </div>

                {/* Rows */}
                <div className="flex-1 px-3 py-2">
                  {[
                    { code: '2330.TW', name: '台積電', tag: '買進', tagColor: '#EC662D', desc: '突破季線壓力，外資連續買超', price: '580 – 590', time: '09:32' },
                    { code: '2454.TW', name: '聯發科', tag: '加碼', tagColor: '#D4A643', desc: '續創新高，AI 晶片出貨成長', price: '1,250 – 1,280', time: '10:15' },
                    { code: '3008.TW', name: '大立光', tag: '減碼', tagColor: '#C49040', desc: '達目標價，量能萎縮先獲利了結', price: '155 – 160', time: '11:00' },
                    { code: '2317.TW', name: '鴻海', tag: '買進', tagColor: '#EC662D', desc: '站上所有均線，外資連續買超', price: '178 – 182', time: '13:45' },
                    { code: '2603.TW', name: '長榮', tag: '出場', tagColor: '#8B8680', desc: '跌破支撐，執行停損紀律', price: '185 – 188', time: '14:20' },
                  ].map((r, idx, arr) => (
                    <div
                      key={r.code}
                      className="px-3.5 py-3.5 rounded-md"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.018)',
                        borderLeft: `2px solid ${r.tagColor}`,
                        borderBottom: idx < arr.length - 1 ? '1px solid rgba(212,166,67,0.07)' : 'none',
                        marginBottom: idx < arr.length - 1 ? 4 : 0,
                      }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-[11px] font-mono tracking-wider" style={{ color: 'rgba(244,236,219,0.5)' }}>
                            {r.code}
                          </span>
                          <span className="text-sm font-semibold truncate" style={{ color: '#F4ECDB', fontFamily: '"Noto Serif TC", serif' }}>
                            {r.name}
                          </span>
                        </div>
                        <span
                          className="shrink-0 px-1.5 py-0.5 rounded-sm text-[10px] font-medium tracking-wider"
                          style={{ backgroundColor: `${r.tagColor}1f`, color: r.tagColor, border: `1px solid ${r.tagColor}44` }}
                        >
                          {r.tag}
                        </span>
                      </div>
                      <p className="text-[11.5px] mb-2 leading-relaxed" style={{ color: 'rgba(244,236,219,0.62)' }}>
                        {r.desc}
                      </p>
                      <div className="flex items-center justify-between text-[10px] pt-1" style={{ color: 'rgba(244,236,219,0.42)', borderTop: '1px dashed rgba(212,166,67,0.10)' }}>
                        <span className="font-mono tracking-wider">建議區間 {r.price}</span>
                        <span className="font-mono">{r.time}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 本日重點觀察 — 與右卡 教學重點 對齊 */}
                <div
                  className="px-5 py-3 border-t"
                  style={{ borderColor: 'rgba(236,102,45,0.18)', backgroundColor: 'rgba(236,102,45,0.04)' }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Zap className="h-3 w-3" style={{ color: '#EC662D' }} />
                    <span className="text-[10px] font-medium tracking-wider uppercase" style={{ color: '#EC662D' }}>
                      本日重點觀察
                    </span>
                  </div>
                  <ul className="space-y-1 text-[11px] leading-snug" style={{ color: 'rgba(244,236,219,0.65)' }}>
                    <li className="flex items-start gap-1.5">
                      <span style={{ color: '#EC662D' }}>—</span> 半導體類股動能集中，留意外資籌碼
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span style={{ color: '#EC662D' }}>—</span> 跌破支撐立即停損，不留戀任何部位
                    </li>
                  </ul>
                </div>
              </div>
              <h4
                className="mt-4 text-base md:text-lg"
                style={{ color: '#F4ECDB', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
              >
                跟單派戰情室
              </h4>
              <p className="text-xs md:text-sm mt-1 leading-relaxed" style={{ color: 'rgba(244,236,219,0.55)' }}>
                即時接收專家買賣訊號，包含價位區間與操作理由。
              </p>
            </div>

            {/* ── 修煉派週記 ── */}
            <div className="flex flex-col">
              <div
                className="warroom-card flex-1 flex flex-col rounded-xl overflow-hidden"
                style={{
                  backgroundColor: 'rgba(20,17,13,0.85)',
                  border: '1px solid rgba(212,166,67,0.22)',
                  boxShadow: '0 30px 60px -30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
              >
                {/* Card header */}
                <div
                  className="flex items-center justify-between px-5 py-4 border-b"
                  style={{ borderColor: 'rgba(212,166,67,0.18)', minHeight: 64 }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-medium tracking-wider"
                      style={{ backgroundColor: 'rgba(212,166,67,0.12)', color: '#D4A643', border: '1px solid rgba(212,166,67,0.3)' }}
                    >
                      <BookOpen className="h-3 w-3" />
                      LEARNING
                    </span>
                    <span
                      className="text-sm font-medium"
                      style={{ color: '#F4ECDB', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
                    >
                      本週追蹤紀錄
                    </span>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] tracking-wider"
                    style={{ backgroundColor: 'rgba(212,166,67,0.1)', color: '#D4A643', border: '1px solid rgba(212,166,67,0.25)' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#D4A643' }} />
                    本週
                  </span>
                </div>

                {/* 可信度輔助說明 */}
                <div
                  className="px-5 py-2 border-b flex items-center justify-between gap-3"
                  style={{ borderColor: 'rgba(212,166,67,0.10)', backgroundColor: 'rgba(212,166,67,0.03)' }}
                >
                  <p className="text-[10.5px] leading-relaxed" style={{ color: 'rgba(244,236,219,0.45)', letterSpacing: '0.03em' }}>
                    每週整理操作紀錄，方便回看判斷依據。
                  </p>
                  <span className="text-[10px] font-mono shrink-0" style={{ color: 'rgba(244,236,219,0.45)' }}>
                    12/23 – 12/27
                  </span>
                </div>

                {/* Rows */}
                <div className="flex-1 px-3 py-2">
                  {[
                    { day: '週一', tag: '買進', tagColor: '#EC662D', code: '2303.TW', name: '聯電', desc: '突破短期壓力，量能放大', ret: '+3.5%', retColor: '#EC662D' },
                    { day: '週二', tag: '買進', tagColor: '#EC662D', code: '3037.TW', name: '欣興', desc: '跳空上漲，追蹤 ABF 載板題材', ret: '-2.8%', retColor: '#8B8680' },
                    { day: '週三', tag: '買進', tagColor: '#EC662D', code: '2317.TW', name: '鴻海', desc: '站上所有均線，外資連買', ret: '+4.2%', retColor: '#EC662D' },
                    { day: '週四', tag: null, tagColor: '#8B8680', code: null, name: null, desc: '觀望無操作', ret: null, retColor: '#8B8680' },
                    { day: '週五', tag: '減碼', tagColor: '#D4A643', code: '2303.TW', name: '聯電', desc: '達目標價位，獲利了結', ret: '已鎖利', retColor: '#D4A643' },
                  ].map((r, i, arr) => (
                    <div
                      key={i}
                      className="px-3.5 py-3.5 rounded-md"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.018)',
                        borderLeft: `2px solid ${r.tagColor}`,
                        borderBottom: i < arr.length - 1 ? '1px solid rgba(212,166,67,0.07)' : 'none',
                        marginBottom: i < arr.length - 1 ? 4 : 0,
                        opacity: r.tag ? 1 : 0.65,
                      }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-baseline gap-2.5 min-w-0">
                          <span className="text-[11px] font-medium shrink-0" style={{ color: 'rgba(244,236,219,0.55)', fontFamily: '"Noto Serif TC", serif' }}>
                            {r.day}
                          </span>
                          {r.tag && (
                            <span
                              className="px-1.5 py-0.5 rounded-sm text-[10px] font-medium tracking-wider"
                              style={{ backgroundColor: `${r.tagColor}1f`, color: r.tagColor, border: `1px solid ${r.tagColor}44` }}
                            >
                              {r.tag}
                            </span>
                          )}
                          {r.code && (
                            <>
                              <span className="text-[11px] font-mono shrink-0" style={{ color: 'rgba(244,236,219,0.5)' }}>
                                {r.code}
                              </span>
                              <span className="text-sm font-semibold truncate" style={{ color: '#F4ECDB', fontFamily: '"Noto Serif TC", serif' }}>
                                {r.name}
                              </span>
                            </>
                          )}
                        </div>
                        {r.ret && (
                          <span className="shrink-0 text-[11px] font-mono font-medium" style={{ color: r.retColor }}>
                            {r.ret}
                          </span>
                        )}
                      </div>
                      <p className="text-[11.5px] leading-relaxed pl-0" style={{ color: 'rgba(244,236,219,0.6)' }}>
                        {r.desc}
                      </p>
                    </div>
                  ))}
                </div>

                {/* 本週教學重點 */}
                <div
                  className="px-5 py-3 border-t"
                  style={{ borderColor: 'rgba(212,166,67,0.18)', backgroundColor: 'rgba(212,166,67,0.04)' }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Lightbulb className="h-3 w-3" style={{ color: '#D4A643' }} />
                    <span className="text-[10px] font-medium tracking-wider uppercase" style={{ color: '#D4A643' }}>
                      本週教學重點
                    </span>
                  </div>
                  <ul className="space-y-1 text-[11px] leading-snug" style={{ color: 'rgba(244,236,219,0.65)' }}>
                    <li className="flex items-start gap-1.5">
                      <span style={{ color: '#D4A643' }}>—</span> 嚴格執行停損是短線操作的關鍵
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span style={{ color: '#D4A643' }}>—</span> 量能確認後再進場可提高勝率
                    </li>
                  </ul>
                </div>
              </div>
              <h4
                className="mt-4 text-base md:text-lg"
                style={{ color: '#F4ECDB', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
              >
                修煉派週記教學
              </h4>
              <p className="text-xs md:text-sm mt-1 leading-relaxed" style={{ color: 'rgba(244,236,219,0.55)' }}>
                每週回顧導師的實際操作，包含進出場理由與學習重點（T+7 延遲）。
              </p>
            </div>
          </div>

        </div>

        <style>{`
          .warroom-card {
            transition: transform .35s ease, box-shadow .35s ease, border-color .35s ease;
            position: relative;
            background-image:
              linear-gradient(rgba(20,17,13,0.92), rgba(20,17,13,0.92)),
              url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='p'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.95  0 0 0 0 0.86  0 0 0 0 0.70  0 0 0 0.10 0'/></filter><rect width='100%25' height='100%25' filter='url(%23p)'/></svg>");
            background-blend-mode: overlay;
          }
          .warroom-card::before {
            content: '';
            position: absolute; inset: 0;
            pointer-events: none;
            border-radius: inherit;
            background:
              linear-gradient(180deg, rgba(212,166,67,0.35), transparent 6%, transparent 94%, rgba(212,166,67,0.25)) border-box;
            -webkit-mask:
              linear-gradient(#000 0 0) content-box,
              linear-gradient(#000 0 0);
            -webkit-mask-composite: xor;
                    mask-composite: exclude;
            padding: 1px;
            opacity: 0.6;
          }
          .warroom-card:hover {
            transform: translateY(-3px);
            border-color: rgba(236,102,45,0.4) !important;
            box-shadow: 0 40px 80px -30px rgba(236,102,45,0.25), inset 0 1px 0 rgba(255,255,255,0.06) !important;
          }
        `}</style>

      </section>
      </LazyOnVisible>

      {/* Seam: 戰情室(墨) → 喘息淺紙帶 → 戰報榜(墨) — 打斷整段深色，承接到本週榜文 */}
      <InkFade direction="ink-to-paper" height={110} paperColor="hsl(var(--jh-paper))" inkColor="hsl(var(--jh-ink))" />
      <div
        className="relative overflow-hidden"
        style={{ background: 'hsl(var(--jh-paper))' }}
      >
        <div
          className="absolute inset-0 opacity-[0.07] mix-blend-multiply pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35  0 0 0 0 0.27  0 0 0 0 0.15  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />
        <div className="container relative py-10 md:py-12 text-center">
          <div
            className="inline-flex items-center gap-3 text-[11px] tracking-[0.36em] uppercase"
            style={{ color: 'hsl(var(--jh-amber-dim))' }}
          >
            <span className="block w-8 h-px" style={{ background: 'hsl(var(--jh-amber) / 0.55)' }} />
            戰情室外，江湖每週開榜一次
            <span className="block w-8 h-px" style={{ background: 'hsl(var(--jh-amber) / 0.55)' }} />
          </div>
        </div>
      </div>
      <InkFade direction="paper-to-ink" height={110} paperColor="hsl(var(--jh-paper))" inkColor="hsl(var(--jh-ink))" />

      {/* Weekly Limit Up Leaderboard - War Report Style */}
      <LazyOnVisible mode="content-visibility" minHeight={620}>
      <section
        className="relative overflow-hidden py-12 md:py-14"
        style={{ background: 'hsl(var(--jh-ink))' }}
      >
        {/* Ambient layers */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          {/* 中央暗金燭暈,極低飽和 */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] opacity-[0.14]"
            style={{
              background:
                'radial-gradient(ellipse at center, hsl(var(--jh-amber) / 0.5) 0%, transparent 65%)',
            }}
          />
          {/* 卷宗紙紋 */}
          <div
            className="absolute inset-0 opacity-[0.07] mix-blend-overlay"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.9  0 0 0 0 0.8  0 0 0 0 0.5  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
            }}
          />
          {/* 上緣暗金細線 */}
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background:
                'linear-gradient(90deg, transparent, hsl(var(--jh-amber) / 0.32), transparent)',
            }}
          />
        </div>

        <div className="container relative">
          {/* Title block */}
          <div className="text-center max-w-2xl mx-auto mb-8 md:mb-10">
            <div
              className="inline-flex items-center gap-2 text-[11px] tracking-[0.32em] uppercase mb-3"
              style={{ color: 'hsl(var(--jh-amber-soft))' }}
            >
              <span className="block w-6 h-px" style={{ background: 'hsl(var(--jh-amber) / 0.6)' }} />
              戰情室裡，每週都會結算這份榜文
              <span className="block w-6 h-px" style={{ background: 'hsl(var(--jh-amber) / 0.6)' }} />
            </div>
            <h2
              className="text-3xl md:text-4xl font-semibold mb-3"
              style={{ color: 'hsl(var(--jh-bone))', fontFamily: '"Noto Serif TC", serif' }}
            >
              本週漲停王排行榜
            </h2>
            <p className="text-sm md:text-base leading-relaxed" style={{ color: 'hsl(var(--jh-bone) / 0.72)' }}>
              追蹤每週強勢訊號,回看起漲前的線索與驗證結果。
            </p>
            <p className="text-xs mt-2" style={{ color: 'hsl(var(--jh-bone) / 0.45)' }}>
              每日收盤後更新,若本週尚無命中,將顯示歷史案例與觀察名單。
            </p>
          </div>

          {/* Main war-report card */}
          <div
            className="relative rounded-md max-w-4xl mx-auto overflow-hidden"
            style={{
              background:
                'linear-gradient(180deg, hsl(var(--jh-ink-soft) / 0.95), hsl(var(--jh-ink) / 0.95))',
              border: '1px solid hsl(var(--jh-amber) / 0.28)',
              boxShadow:
                '0 0 0 1px hsl(var(--jh-amber) / 0.06), 0 30px 60px -30px hsl(var(--jh-candle) / 0.22)',
            }}
          >
            {/* Card header — scroll-of-honor bar */}
            <div
              className="flex items-center justify-between px-5 md:px-7 py-3"
              style={{
                borderBottom: '1px solid hsl(var(--jh-amber) / 0.18)',
                background: 'linear-gradient(180deg, hsl(var(--jh-amber) / 0.06), transparent)',
              }}
            >
              <div className="flex items-center gap-2">
                <ScrollText className="h-4 w-4" style={{ color: 'hsl(var(--jh-amber-soft))' }} />
                <span className="text-xs tracking-widest" style={{ color: 'hsl(var(--jh-amber-soft))' }}>
                  WAR REPORT · 本週榜文
                </span>
              </div>
              <div
                className="hidden sm:flex items-center gap-1.5 text-[11px]"
                style={{ color: 'hsl(var(--jh-bone) / 0.55)' }}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                    style={{ background: 'hsl(var(--jh-candle))' }}
                  />
                  <span
                    className="relative inline-flex rounded-full h-1.5 w-1.5"
                    style={{ background: 'hsl(var(--jh-candle))' }}
                  />
                </span>
                收盤後更新
              </div>
            </div>

            {/* Empty / waiting state */}
            <div className="px-5 md:px-10 pt-8 pb-6 md:pt-10 md:pb-8 text-center">
              <div
                className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
                style={{
                  border: '1px solid hsl(var(--jh-amber) / 0.35)',
                  background: 'radial-gradient(circle, hsl(var(--jh-candle) / 0.12), transparent 70%)',
                }}
              >
                <Flame className="h-6 w-6" style={{ color: 'hsl(var(--jh-candle))' }} />
              </div>
              <h3 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'hsl(var(--jh-bone))' }}>
                本週戰報尚未開榜
              </h3>
              <p
                className="text-sm leading-relaxed max-w-md mx-auto"
                style={{ color: 'hsl(var(--jh-bone) / 0.7)' }}
              >
                市場還沒給出新的漲停訊號。
                <br className="hidden sm:inline" />
                你可以先查看歷史命中紀錄,理解訊號如何發生、如何追蹤、如何驗證。
              </p>
            </div>

            {/* 3-column summary */}
            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-px"
              style={{
                background: 'hsl(var(--jh-amber) / 0.14)',
                borderTop: '1px solid hsl(var(--jh-amber) / 0.14)',
              }}
            >
              {[
                { icon: Clock, label: '最新追蹤', value: '本週尚無新命中', sub: '等待收盤後更新' },
                { icon: History, label: '歷史命中', value: '回看過去漲停案例', sub: '理解起漲前線索' },
                { icon: Calendar, label: '更新規則', value: '每日收盤後更新', sub: '以實際命中紀錄為準' },
              ].map((item, i) => (
                <div key={i} className="px-5 py-4" style={{ background: 'hsl(var(--jh-ink-soft))' }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <item.icon className="h-3.5 w-3.5" style={{ color: 'hsl(var(--jh-amber-soft))' }} />
                    <span
                      className="text-[10px] tracking-[0.22em] uppercase"
                      style={{ color: 'hsl(var(--jh-amber-soft) / 0.85)' }}
                    >
                      {item.label}
                    </span>
                  </div>
                  <div className="text-sm font-medium mb-0.5" style={{ color: 'hsl(var(--jh-bone))' }}>
                    {item.value}
                  </div>
                  <div className="text-[11px]" style={{ color: 'hsl(var(--jh-bone) / 0.5)' }}>
                    {item.sub}
                  </div>
                </div>
              ))}
            </div>

            {/* Historical case preview — skeleton until real data */}
            <div className="px-5 md:px-7 py-5" style={{ borderTop: '1px solid hsl(var(--jh-amber) / 0.14)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-sm"
                  style={{
                    background: 'hsl(var(--jh-amber) / 0.12)',
                    color: 'hsl(var(--jh-amber-soft))',
                    border: '1px solid hsl(var(--jh-amber) / 0.25)',
                  }}
                >
                  歷史案例預覽
                </span>
                <span className="text-[11px]" style={{ color: 'hsl(var(--jh-bone) / 0.45)' }}>
                  待真實資料接入後顯示
                </span>
              </div>
              <div className="space-y-2">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-3 rounded-sm"
                    style={{
                      background: 'hsl(var(--jh-bone) / 0.025)',
                      border: '1px solid hsl(var(--jh-amber) / 0.08)',
                    }}
                  >
                    <div
                      className="h-8 w-12 rounded-sm animate-pulse"
                      style={{ background: 'hsl(var(--jh-amber) / 0.12)' }}
                    />
                    <div className="flex-1 space-y-1.5">
                      <div
                        className="h-2.5 rounded-sm animate-pulse"
                        style={{ background: 'hsl(var(--jh-bone) / 0.08)', width: '60%' }}
                      />
                      <div
                        className="h-2 rounded-sm animate-pulse"
                        style={{ background: 'hsl(var(--jh-bone) / 0.05)', width: '40%' }}
                      />
                    </div>
                    <div
                      className="h-6 w-14 rounded-sm animate-pulse hidden sm:block"
                      style={{ background: 'hsl(var(--jh-candle) / 0.1)' }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* CTA footer */}
            <div
              className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 px-5 py-5"
              style={{
                borderTop: '1px solid hsl(var(--jh-amber) / 0.18)',
                background: 'linear-gradient(180deg, transparent, hsl(var(--jh-candle) / 0.04))',
              }}
            >
              <Link
                to="/experts?role=advisor"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-sm text-sm font-medium transition-all hover:brightness-110"
                style={{
                  background: 'hsl(var(--jh-candle))',
                  color: 'hsl(var(--jh-ink))',
                  boxShadow: '0 8px 24px -10px hsl(var(--jh-candle) / 0.6)',
                }}
              >
                <Trophy className="h-4 w-4" />
                查看歷史漲停分析
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/legal"
                className="text-xs underline-offset-4 hover:underline transition-colors"
                style={{ color: 'hsl(var(--jh-amber-soft) / 0.85)' }}
              >
                了解排行榜更新規則
              </Link>
            </div>
          </div>
        </div>
      </section>
      </LazyOnVisible>

      {/* Seam: 戰報榜(墨) → 持股卷宗(紙) */}
      <InkFade direction="ink-to-paper" height={150} paperColor="hsl(var(--jh-paper))" inkColor="hsl(var(--jh-ink))" />
      {/* Stock Dashboard Section - 持股卷宗（江湖卷宗風） */}
      <LazyOnVisible mode="content-visibility" minHeight={900}>
      <section
        className="relative overflow-hidden py-section"
        style={{ background: 'hsl(var(--jh-paper))' }}
      >
        {/* 上緣墨色餘韻 — 從 InkFade 自然延續，不要硬切純白 */}
        <div
          className="absolute inset-x-0 top-0 h-40 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(ellipse 90% 100% at 50% 0%, hsl(var(--jh-ink) / 0.18) 0%, hsl(var(--jh-ink) / 0.06) 35%, transparent 70%)',
          }}
        />
        {/* 紙紋 */}
        <div
          className="absolute inset-0 opacity-[0.08] mix-blend-multiply pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35  0 0 0 0 0.27  0 0 0 0 0.15  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />
        <div className="container relative">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-xl">
              <Badge
                className="mb-sm border"
                style={{
                  background: 'hsl(var(--jh-amber) / 0.10)',
                  color: 'hsl(var(--jh-amber-dim))',
                  borderColor: 'hsl(var(--jh-amber) / 0.35)',
                }}
              >
                看完別人的戰績，換看你自己手上這局
              </Badge>
              <h2 className="text-h2 mb-xs" style={{ color: 'hsl(var(--jh-ink))' }}>
                先看懂自己的持股，再決定下一步
              </h2>
              <p className="max-w-2xl mx-auto" style={{ color: 'hsl(var(--jh-earth))' }}>
                輸入持股，整理風險、事件與市場線索。先看清眼前這一局，再決定要跟單、修煉或觀望。
              </p>
            </div>

            <div className="grid lg:grid-cols-[1fr_1.1fr] gap-xl items-center">
              <div className="space-y-md">
                {[
                  { icon: BarChart3, title: '持股局勢拆解', desc: '一鍵整理手上部位，找出需要留意的風險。' },
                  { icon: Calendar, title: '關鍵事件提醒', desc: '法說會、除權息、財報日，提前掌握節點。' },
                  { icon: LineChart, title: '新聞戰報彙整', desc: '個股新聞、損益走勢、獲利排行，一頁看懂。' },
                ].map((item) => (
                  <div key={item.title} className="flex gap-md items-start">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-sm shrink-0 border"
                      style={{
                        background: 'hsl(var(--jh-amber) / 0.10)',
                        color: 'hsl(var(--jh-amber-dim))',
                        borderColor: 'hsl(var(--jh-amber) / 0.35)',
                      }}
                    >
                      <item.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-h5 mb-xs" style={{ color: 'hsl(var(--jh-ink))' }}>{item.title}</h4>
                      <p className="text-sm leading-relaxed" style={{ color: 'hsl(var(--jh-earth))' }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
                <div className="pt-sm">
                  <Button
                    size="xl"
                    className="text-white border-0"
                    style={{ background: 'hsl(var(--jh-candle))' }}
                    asChild
                  >
                    <Link to="/holding-checkup">
                      免費試用持股卷宗
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                </div>
              </div>

              <div
                className="rounded-sm p-md md:p-lg relative overflow-hidden"
                style={{
                  background: 'hsl(var(--jh-bone))',
                  border: '1px solid hsl(var(--jh-earth) / 0.18)',
                  borderTop: '2px solid hsl(var(--jh-amber))',
                  boxShadow: '0 26px 64px -32px hsl(var(--jh-ink) / 0.45)',
                }}
              >
                {/* 卡片內紙紋 */}
                <div
                  className="absolute inset-0 opacity-[0.07] mix-blend-multiply pointer-events-none"
                  aria-hidden="true"
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.3  0 0 0 0 0.22  0 0 0 0 0.12  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
                  }}
                />
                <div
                  className="relative flex items-center justify-between mb-md pb-sm"
                  style={{ borderBottom: '1px dashed hsl(var(--jh-amber) / 0.40)' }}
                >
                  <div className="flex items-center gap-2">
                    <ScrollText className="h-4 w-4" style={{ color: 'hsl(var(--jh-amber-dim))' }} />
                    <span className="text-sm font-medium tracking-wide" style={{ color: 'hsl(var(--jh-ink))', fontFamily: '"Noto Serif TC",serif' }}>
                      我的持倉卷宗
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px]"
                    style={{
                      borderColor: 'hsl(var(--jh-amber) / 0.45)',
                      color: 'hsl(var(--jh-amber-dim))',
                      background: 'hsl(var(--jh-amber) / 0.08)',
                    }}
                  >
                    本日已對帳
                  </Badge>
                </div>
                <div className="relative space-y-1.5">
                  {[
                    { code: '2330', name: '台積電', qty: '2,000', pct: '+12.4%', tone: 'up', note: '法說 12/16' },
                    { code: '2454', name: '聯發科', qty: '1,000', pct: '+5.8%', tone: 'up', note: 'AI 出貨成長' },
                    { code: '2603', name: '長榮', qty: '5,000', pct: '-3.2%', tone: 'down', note: '建議檢視' },
                  ].map((h) => (
                    <div
                      key={h.code}
                      className="flex items-center gap-3 px-3 py-2.5"
                      style={{ borderBottom: '1px dashed hsl(var(--jh-earth) / 0.18)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm" style={{ color: 'hsl(var(--jh-ink))', fontFamily: '"Noto Serif TC",serif' }}>{h.code}</span>
                          <span className="text-sm" style={{ color: 'hsl(var(--jh-earth))' }}>{h.name}</span>
                        </div>
                        <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--jh-stone))' }}>持有 {h.qty} 股 · {h.note}</p>
                      </div>
                      <span
                        className="text-sm font-semibold tabular-nums"
                        style={{ color: h.tone === 'up' ? 'hsl(0 55% 42%)' : 'hsl(140 30% 32%)' }}
                      >
                        {h.pct}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="relative mt-md pt-sm" style={{ borderTop: '1px dashed hsl(var(--jh-amber) / 0.30)' }}>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'hsl(var(--jh-earth))' }}>
                    <Lightbulb className="h-3.5 w-3.5" style={{ color: 'hsl(var(--jh-amber))' }} />
                    <span>戰情線索：長榮跌破支撐，建議檢視部位</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      </LazyOnVisible>


      {/* How It Works - Dual Path · 門派入口卷軸（淺紙） */}
      <LazyOnVisible mode="content-visibility" minHeight={900}>
      <section
        className="relative overflow-hidden py-section"
        style={{ background: 'hsl(var(--jh-paper))' }}
      >
        {/* 上方暗金分隔線 */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, hsl(var(--jh-amber) / 0.45) 50%, transparent 100%)',
          }}
        />
        {/* 紙紋 */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07] pointer-events-none mix-blend-multiply"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35  0 0 0 0 0.27  0 0 0 0 0.15  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />

        <div className="container relative">
          <div className="text-center mb-xl max-w-2xl mx-auto">
            <p
              className="text-xs tracking-[0.3em] uppercase mb-xs"
              style={{ color: 'hsl(var(--jh-amber-dim))' }}
            >
              如果你準備動手了，這是兩條入門路線
            </p>
            <h2
              className="text-h2 mb-sm"
              style={{ color: 'hsl(var(--jh-ink))', fontFamily: '"Noto Serif TC", serif' }}
            >
              入門第一步，先選你的節奏
            </h2>
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'hsl(var(--jh-earth))' }}
            >
              想跟著高手行動，走訂閱專家。<br className="sm:hidden" />
              想先看懂手上的股票，走持股健檢。
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-lg max-w-6xl mx-auto">
            {/* Path A - 訂閱專家（燭火橘） */}
            <div
              className="warroom-path-card order-2 lg:order-1 group relative rounded-xl p-md md:p-lg flex flex-col"
              style={{
                background: 'hsl(var(--jh-paper-light))',
                border: '1px solid hsl(var(--jh-candle) / 0.32)',
                boxShadow: '0 18px 48px -28px hsl(var(--jh-candle) / 0.28)',
              }}
            >
              <div className="mb-md min-h-[92px]">
                <span
                  className="inline-block text-[11px] tracking-[0.2em] uppercase px-2.5 py-1 rounded-sm mb-sm"
                  style={{
                    color: 'hsl(var(--jh-candle))',
                    background: 'hsl(var(--jh-candle) / 0.08)',
                    border: '1px solid hsl(var(--jh-candle) / 0.32)',
                  }}
                >
                  適合你，如果想跟著高手行動
                </span>
                <h3 className="text-h4" style={{ color: 'hsl(var(--jh-ink))' }}>訂閱專家</h3>
                <p
                  className="text-sm mt-xs leading-relaxed"
                  style={{ color: 'hsl(var(--jh-earth))' }}
                >
                  選擇你信任的投資風格，追蹤訊號、紀錄與復盤。
                </p>
              </div>

              <div
                className="text-xs mb-md pb-sm border-b"
                style={{
                  color: 'hsl(var(--jh-amber-dim))',
                  borderColor: 'hsl(var(--jh-amber) / 0.25)',
                }}
              >
                適合對象：想要明確訊號、操作紀錄、高手復盤的人
              </div>

              <ol className="space-y-3 mb-lg flex-1">
                {[
                  { step: '01', title: '選擇專家', desc: '找到你信任的投資風格' },
                  { step: '02', title: '選擇方案', desc: '依需求挑選跟單或學習內容' },
                  { step: '03', title: '進入戰情室', desc: '追蹤訊號、紀錄與績效' },
                ].map((item) => (
                  <li key={item.step} className="flex gap-3 items-start">
                    <span
                      className="shrink-0 w-9 h-9 flex items-center justify-center text-xs font-medium tracking-wider rounded-sm"
                      style={{
                        color: 'hsl(var(--jh-candle))',
                        background: 'hsl(var(--jh-candle) / 0.08)',
                        border: '1px solid hsl(var(--jh-candle) / 0.3)',
                      }}
                    >
                      {item.step}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm font-medium" style={{ color: 'hsl(var(--jh-ink))' }}>{item.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--jh-earth))' }}>{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <Button
                size="lg"
                className="w-full border-0 text-white font-medium"
                style={{
                  background: 'hsl(var(--jh-candle))',
                  boxShadow: '0 8px 24px -10px hsl(var(--jh-candle) / 0.5)',
                }}
                asChild
              >
                <Link to="/experts">
                  探索名師
                  <ArrowRight className="h-4 w-4 ml-2 warroom-arrow transition-transform" />
                </Link>
              </Button>
            </div>

            {/* Path B - 持股健檢（暗金） */}
            <div
              className="warroom-path-card order-1 lg:order-2 group relative rounded-xl p-md md:p-lg flex flex-col"
              style={{
                background: 'hsl(var(--jh-paper-light))',
                border: '1px solid hsl(var(--jh-amber) / 0.35)',
                boxShadow: '0 18px 48px -28px hsl(var(--jh-amber) / 0.28)',
              }}
            >
              <div className="mb-md min-h-[92px]">
                <span
                  className="inline-block text-[11px] tracking-[0.2em] uppercase px-2.5 py-1 rounded-sm mb-sm"
                  style={{
                    color: 'hsl(var(--jh-amber-dim))',
                    background: 'hsl(var(--jh-amber) / 0.08)',
                    border: '1px solid hsl(var(--jh-amber) / 0.35)',
                  }}
                >
                  適合你，如果想先看懂持股
                </span>
                <h3 className="text-h4" style={{ color: 'hsl(var(--jh-ink))' }}>持股健檢</h3>
                <p
                  className="text-sm mt-xs leading-relaxed"
                  style={{ color: 'hsl(var(--jh-earth))' }}
                >
                  輸入手上的股票，先看懂風險、事件與市場線索。
                </p>
              </div>

              <div
                className="text-xs mb-md pb-sm border-b"
                style={{
                  color: 'hsl(var(--jh-amber-dim))',
                  borderColor: 'hsl(var(--jh-amber) / 0.25)',
                }}
              >
                適合對象：手上有股票，但不知道該守、該退、還是該等的人
              </div>

              <ol className="space-y-3 mb-lg flex-1">
                {[
                  { step: '01', title: '免費健檢', desc: '不用註冊，先輸入股票' },
                  { step: '02', title: 'AI 分析', desc: '整理新聞、事件與風險線索' },
                  { step: '03', title: '進入看板', desc: '追蹤部位變化與後續提醒' },
                ].map((item) => (
                  <li key={item.step} className="flex gap-3 items-start">
                    <span
                      className="shrink-0 w-9 h-9 flex items-center justify-center text-xs font-medium tracking-wider rounded-sm"
                      style={{
                        color: 'hsl(var(--jh-amber-dim))',
                        background: 'hsl(var(--jh-amber) / 0.08)',
                        border: '1px solid hsl(var(--jh-amber) / 0.32)',
                      }}
                    >
                      {item.step}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm font-medium" style={{ color: 'hsl(var(--jh-ink))' }}>{item.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'hsl(var(--jh-earth))' }}>{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <Button
                size="lg"
                className="w-full border-0 font-medium"
                style={{
                  background: 'linear-gradient(135deg, hsl(var(--jh-amber)) 0%, hsl(var(--jh-amber-dim)) 100%)',
                  color: 'hsl(var(--jh-bone))',
                  boxShadow: '0 8px 24px -10px hsl(var(--jh-amber) / 0.5)',
                }}
                asChild
              >
                <Link to="/holding-checkup">
                  開始持股健檢
                  <ArrowRight className="h-4 w-4 ml-2 warroom-arrow transition-transform" />
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <style>{`
          .warroom-path-card { transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease; }
          .warroom-path-card:hover { transform: translateY(-2px); }
          .warroom-path-card:hover .warroom-arrow { transform: translateX(4px); }
        `}</style>
      </section>
      </LazyOnVisible>



      {/* Final CTA — 卷軸落款（紙面延續，無過渡） */}
      <LazyOnVisible mode="content-visibility" minHeight={400}>
      <section
        className="relative overflow-hidden py-section"
        style={{ background: 'hsl(var(--jh-paper))' }}
      >
        {/* 紙紋 */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none opacity-[0.08] mix-blend-multiply"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35  0 0 0 0 0.27  0 0 0 0 0.15  0 0 0 0.45 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />
        {/* 右下朱印 */}
        <div
          aria-hidden="true"
          className="absolute pointer-events-none hidden md:block"
          style={{
            right: '8%',
            bottom: '12%',
            width: 64,
            height: 64,
            border: '2px solid hsl(var(--jh-candle) / 0.55)',
            color: 'hsl(var(--jh-candle) / 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: '"Noto Serif TC", serif',
            fontSize: 30,
            letterSpacing: 0,
            transform: 'rotate(-6deg)',
            boxShadow: 'inset 0 0 0 1px hsl(var(--jh-candle) / 0.25)',
          }}
        >
          印
        </div>
        <div className="container relative">
          <div className="max-w-2xl mx-auto text-center">
            {/* 暗金細線 */}
            <div
              aria-hidden="true"
              className="mx-auto mb-md"
              style={{
                width: 64,
                height: 1,
                background: 'linear-gradient(90deg, transparent, hsl(var(--jh-amber) / 0.55), transparent)',
              }}
            />
            <p
              className="text-xs tracking-[0.32em] uppercase mb-xs"
              style={{ color: 'hsl(var(--jh-amber-dim))' }}
            >
              江湖入口已開，挑一個方式起手
            </p>
            <h2
              className="text-h2 mb-md"
              style={{ color: 'hsl(var(--jh-ink))', fontFamily: '"Noto Serif TC", serif' }}
            >
              準備好開始了嗎？
            </h2>
            <div className="flex flex-col sm:flex-row gap-md justify-center">
              <Button
                size="xl"
                className="border-0 text-white"
                style={{ background: 'hsl(var(--jh-candle))' }}
                asChild
              >
                <Link to="/experts">
                  探索專家
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              <Button
                size="xl"
                variant="outline"
                className="border-2"
                style={{
                  borderColor: 'hsl(var(--jh-candle))',
                  color: 'hsl(var(--jh-candle))',
                  background: 'transparent',
                }}
                asChild
              >
                <Link to="/holding-checkup">
                  免費健檢
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
            <div className="mt-md">
              <Link
                to="/auth/register"
                className="text-sm underline underline-offset-4"
                style={{ color: 'hsl(var(--jh-earth))' }}
              >
                或先免費註冊帳號 →
              </Link>
            </div>
          </div>
        </div>
      </section>
      </LazyOnVisible>

    </PortalLayout>
  );
};

export default Index;
