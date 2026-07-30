import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export const HeroSection = () => (
  <>
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
          {/* LCP candidate (`h1`) must paint immediately — no fade-in on the
              wrapper or it pushes p95 LCP past hero animation duration. */}
          <div className="max-w-xl">

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
                style={{ backgroundColor: 'hsl(var(--cta))', color: 'hsl(var(--primary-foreground))' }}
                className="hover:brightness-110 border-0 shadow-[0_10px_30px_-12px_hsl(var(--cta)/0.65)]"
              >
                <Link to="/holding-checkup" data-cta="hero_checkup" data-cta-section="hero">
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
                <Link to="/experts" data-cta="hero_experts" data-cta-section="hero">
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
                data-cta="hero_pricing_link"
                data-cta-section="hero"
                className="text-xs text-primary-foreground/55 hover:text-primary-foreground/90 underline underline-offset-4"
              >
                查看方案比較 →
              </Link>
            </div>
          </div>
        </div>
      </section>
  </>
);
