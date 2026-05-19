import { useEffect, useRef, useState } from 'react';
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
  Lightbulb
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
import dividerChoosePath from '@/assets/divider-choose-path.svg';
import { WeeklyLimitUpLeaderboard } from '@/components/WeeklyLimitUpLeaderboard';
import { LazyOnVisible } from '@/components/LazyOnVisible';
import { useWeeklyLeaderboard } from '@/hooks/useWeeklyLeaderboard';
import { lazy, Suspense } from 'react';

// P5-D: mobile-only carousels are split into their own chunk and only loaded on small screens
const MobilePreviewCarousel = lazy(() =>
  import('./index-sections/MobileCarousels').then((m) => ({ default: m.MobilePreviewCarousel }))
);

// Batch1-#2: idle prefetch moved to centralized prefetchHighTrafficRoutes()
// in src/lib/routePrefetch.ts (invoked from AttributionTracker in App.tsx).


const WeeklyLimitUpLeaderboardSection = () => {
  const { data: entries = [], isLoading } = useWeeklyLeaderboard();
  return <WeeklyLimitUpLeaderboard entries={entries} isLoading={isLoading} />;
};

// 數字 count-up 動畫（載入時自動跑動）
const CountUpNumber = ({
  target,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1600,
  delay = 0,
}: {
  target: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  delay?: number;
}) => {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setValue(target);
      return;
    }

    let startTime = 0;
    const timer = window.setTimeout(() => {
      const tick = (now: number) => {
        if (!startTime) startTime = now;
        const t = Math.min((now - startTime) / duration, 1);
        // easeOutCubic
        const eased = 1 - Math.pow(1 - t, 3);
        setValue(target * eased);
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
        else setValue(target);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, delay]);

  return (
    <span>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
};


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
                <Link to="/free-checkup">
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

      {/* 黑色數據列 — full-width stats bar above 江湖兩派 */}
      <section
        aria-label="平台數據"
        className="relative w-full"
        style={{ backgroundColor: '#070707' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ul
            className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x"
            style={{ borderColor: 'rgba(255,255,255,0.12)' }}
          >
            {[
              { target: 75,   decimals: 0, prefix: '', suffix: '%+',   title: '勝率表現',     sub: '歷史訊號平均勝率' },
              { target: 24,   decimals: 0, prefix: '', suffix: ' / 7', title: '即時市場分析', sub: '不間斷的市場監控' },
              { target: 1000, decimals: 0, prefix: '', suffix: '+',    title: '深度研究報告', sub: '涵蓋全球主要市場' },
              { target: 4.9,  decimals: 1, prefix: '', suffix: ' / 5', title: '用戶滿意度',   sub: '來自真實用戶評價' },
            ].map((s, i) => (
              <li
                key={s.title}
                className="flex flex-col items-center justify-center text-center px-4 py-7 md:py-9"
                style={{
                  borderColor: 'rgba(255,255,255,0.12)',
                  minHeight: 160,
                }}
              >
                <div
                  className="text-3xl md:text-4xl lg:text-[44px] text-white mb-2 tabular-nums"
                  style={{
                    fontFamily: '"Noto Serif TC","Source Serif 4","Georgia",serif',
                    letterSpacing: '0.02em',
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <CountUpNumber
                    target={s.target}
                    decimals={s.decimals}
                    prefix={s.prefix}
                    suffix={s.suffix}
                    delay={120 + i * 140}
                    duration={1600}
                  />
                </div>
                <div
                  className="text-sm md:text-base text-white mb-1"
                  style={{ fontFamily: '"Noto Serif TC",serif', letterSpacing: '0.15em' }}
                >
                  {s.title}
                </div>
                <div
                  className="text-xs md:text-[13px]"
                  style={{ color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em' }}
                >
                  {s.sub}
                </div>
              </li>
            ))}
          </ul>
        </div>
        {/* 橘色銜接圓點 — 跨越黑色與米白交界 */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 -translate-x-1/2"
          style={{ bottom: '-9px', zIndex: 20 }}
        >
          <span
            className="block rounded-full"
            style={{ width: 18, height: 18, backgroundColor: '#EC662D' }}
          />
        </div>
      </section>

      {/* 江湖兩派 — Premium editorial / ink-wash version */}
      <LazyOnVisible mode="content-visibility" minHeight={1400}>
      <section
        className="relative overflow-hidden py-20 md:py-28"
        style={{ backgroundColor: '#F5F0E6' }}
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
            opacity: 0.35,
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
          <div className="text-center mb-12 md:mb-16">
            <p
              className="text-sm md:text-base tracking-[0.4em] mb-4"
              style={{ color: '#EC662D', fontFamily: '"Noto Serif TC", serif' }}
            >
              江湖兩派
            </p>
            <h2
              className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4"
              style={{ color: '#171717', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
            >
              選你的模式
            </h2>
            <p className="text-base md:text-lg" style={{ color: 'rgba(23,23,23,0.65)' }}>
              不同的投資哲學，同樣的致勝之道
            </p>
          </div>

          {/* Two-card grid */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 md:gap-5 items-stretch">
            {/* Left — 跟單派 */}
            <Link
              to="/experts?role=advisor"
              className="jianghu-card group relative block overflow-hidden rounded-2xl"
              style={{
                aspectRatio: '3 / 4',
                border: '1px solid rgba(23,23,23,0.12)',
                backgroundColor: '#1a1a1a',
              }}
            >
              {/* Background image — keep samurai out of bottom-left text safe area */}
              <div
                className="absolute inset-0 bg-no-repeat transition-transform duration-700 group-hover:scale-105"
                style={{
                  backgroundImage: `url(${jianghuFollowBg})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center center',
                }}
              />
              {/* Text-safe overlay — bottom-up dark gradient */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(to top, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0.22) 68%, rgba(0,0,0,0) 100%)',
                }}
              />
              {/* Content wrapper — icon + text in clean dark zone */}
              <div
                className="absolute z-10"
                style={{ bottom: '32px', left: '36px', right: '36px', maxWidth: '420px' }}
              >
                <img
                  src={iconLightningCircle}
                  alt=""
                  className="w-12 h-12 md:w-14 md:h-14 mb-4"
                  loading="lazy"
                />
                <h3
                  className="text-3xl md:text-4xl font-bold text-white mb-2"
                  style={{ fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.08em' }}
                >
                  跟單派
                </h3>
                <p className="text-base md:text-lg mb-2" style={{ color: '#EC662D' }}>
                  跟隨高手，即刻出擊
                </p>
                <p className="text-sm md:text-[15px] text-white/80 leading-relaxed mb-4">
                  接收即時交易訊號，跟隨專業分析師的腳步，捕捉市場機會，追求穩定收益。
                </p>
                <span
                  className="inline-flex items-center gap-2 text-sm md:text-base font-medium"
                  style={{ color: '#EC662D' }}
                >
                  了解更多
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>

            {/* Divider — desktop only, low presence */}
            <div className="hidden md:flex items-center justify-center" style={{ width: '56px' }}>
              <img
                src={dividerChoosePath}
                alt=""
                aria-hidden="true"
                className="w-auto"
                style={{ height: '320px', opacity: 0.7 }}
                loading="lazy"
              />
            </div>

            {/* Right — 修煉派 */}
            <Link
              to="/experts?role=mentor"
              className="jianghu-card group relative block overflow-hidden rounded-2xl"
              style={{
                aspectRatio: '3 / 4',
                border: '1px solid rgba(23,23,23,0.12)',
                backgroundColor: '#1a1a1a',
              }}
            >
              {/* Background image — push subject right/top so it clears bottom-left text area */}
              <div
                className="absolute inset-0 bg-no-repeat transition-transform duration-700 group-hover:scale-105"
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
                    'linear-gradient(to top, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0.22) 68%, rgba(0,0,0,0) 100%)',
                }}
              />
              <div
                className="absolute z-10"
                style={{ bottom: '32px', left: '36px', right: '36px', maxWidth: '420px' }}
              >
                <img
                  src={iconBookCircle}
                  alt=""
                  className="w-12 h-12 md:w-14 md:h-14 mb-4"
                  loading="lazy"
                />
                <h3
                  className="text-3xl md:text-4xl font-bold text-white mb-2"
                  style={{ fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.08em' }}
                >
                  修煉派
                </h3>
                <p className="text-base md:text-lg mb-2" style={{ color: '#EC662D' }}>
                  修煉內功，掌控全局
                </p>
                <p className="text-sm md:text-[15px] text-white/80 leading-relaxed mb-4">
                  學習專業投資框架，深入市場分析邏輯，培養獨立思考能力，成為市場贏家。
                </p>
                <span
                  className="inline-flex items-center gap-2 text-sm md:text-base font-medium"
                  style={{ color: '#EC662D' }}
                >
                  了解更多
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          </div>

          {/* Footnote */}
          <p
            className="text-center mt-10 text-sm md:text-base"
            style={{ color: 'rgba(23,23,23,0.6)' }}
          >
            兩派會員皆可享有 <span style={{ color: '#EC662D', fontWeight: 600 }}>legendflow</span> 完整生態系統服務
          </p>
        </div>

        {/* Scroll Down Indicator */}
        <div className="flex flex-col items-center pt-12">
          <button
            onClick={() => {
              document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex flex-col items-center gap-2 transition-colors group cursor-pointer"
            style={{ color: 'rgba(23,23,23,0.55)' }}
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
      </LazyOnVisible>

      <style>{`
        .jianghu-card {
          transition: transform 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease;
        }
        .jianghu-card:hover {
          transform: translateY(-6px);
          border-color: rgba(236,102,45,0.55) !important;
          box-shadow: 0 20px 40px -20px rgba(236,102,45,0.35), 0 0 0 1px rgba(236,102,45,0.3);
        }
      `}</style>


      {/* Real Interface Preview Section */}
      <LazyOnVisible mode="content-visibility" minHeight={1000}>
      <section id="preview-section" className="py-section bg-card dark:bg-white/[0.03]">
        <div className="container">
          <div className="text-center mb-xl">
            <p className="text-muted-foreground text-sm mb-xs">產品真實畫面</p>
            <h2 className="text-h2 text-foreground">會員戰情室一覽</h2>
            <p className="text-muted-foreground mt-2">訂閱後，你會在戰情室看到這些內容</p>
          </div>

          {/* Mobile Swipeable Carousel */}
          <Suspense fallback={null}><MobilePreviewCarousel /></Suspense>

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
      <LazyOnVisible mode="content-visibility" minHeight={900}>
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
      <LazyOnVisible mode="content-visibility" minHeight={700}>
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
      <LazyOnVisible mode="content-visibility" minHeight={800}>
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
      <LazyOnVisible mode="content-visibility" minHeight={400}>
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
      </LazyOnVisible>

    </PortalLayout>
  );
};

export default Index;
