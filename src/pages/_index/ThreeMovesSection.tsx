import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import featureXianren from '@/assets/feature-xianren.webp';
import featureJiaodai from '@/assets/feature-jiaodai.webp';
import featureFiveFactions from '@/assets/feature-five-factions.webp';

export const ThreeMovesSection = () => (
  <>
      {/* Seam: Hero(墨黑) → 三招(紙) — 短版紙面浮出，40px */}
      <div
        aria-hidden="true"
        className="relative w-full jh-seam-hero-to-trio"
        style={{
          height: 40,
          background:
            'linear-gradient(180deg, #000 0%, hsl(var(--jh-paper) / 0.35) 55%, hsl(var(--jh-paper)) 100%)',
        }}
      />

      {/* Three Core Features Section - Magazine Layout */}
      <section className="relative py-section jh-section-paper">
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
                  <Link to="/pricing" data-cta="mid_pricing" data-cta-section="mid">
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
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl lg:ml-0 lg:mr-10 jh-trio-card"
                style={{ 
                  animation: 'fadeSlideUp 0.6s ease-out forwards',
                  animationDelay: '0.1s',
                  opacity: 0
                }}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03] jh-trio-bg"
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
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl lg:ml-5 lg:mr-5 jh-trio-card"
                style={{ 
                  animation: 'fadeSlideUp 0.6s ease-out forwards',
                  animationDelay: '0.25s',
                  opacity: 0
                }}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03] jh-trio-bg"
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
                className="relative overflow-hidden rounded-xl bg-black group cursor-pointer transition-all duration-300 hover:shadow-2xl lg:ml-10 lg:mr-0 jh-trio-card"
                style={{ 
                  animation: 'fadeSlideUp 0.6s ease-out forwards',
                  animationDelay: '0.4s',
                  opacity: 0
                }}
              >
                <div 
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-[1.03] jh-trio-bg"
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
                  <Link to="/pricing" data-cta="mobile_mid_pricing" data-cta-section="mid">
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

  </>
);
