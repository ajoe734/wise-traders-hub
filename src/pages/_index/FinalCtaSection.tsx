import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { LazyOnVisible } from '@/components/LazyOnVisible';

export const FinalCtaSection = () => (
  <>


      {/* Final CTA — 卷軸落款（紙面延續，無過渡） */}
      <LazyOnVisible mode="content-visibility" minHeight={400}>
      <section
        className="relative overflow-hidden py-section jh-night-section"
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
                <Link to="/experts" data-cta="footer_experts" data-cta-section="footer">
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
                <Link to="/holding-checkup" data-cta="footer_checkup" data-cta-section="footer">
                  免費健檢
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
            <div className="mt-md">
              <Link
                to="/auth/register"
                data-cta="footer_register"
                data-cta-section="footer"
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
  </>
);
