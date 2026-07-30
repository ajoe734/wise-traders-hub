import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { LazyOnVisible } from '@/components/LazyOnVisible';

export const HowItWorksSection = () => (
  <>

      {/* How It Works - Dual Path · 門派入口卷軸（淺紙） */}
      <LazyOnVisible mode="content-visibility" minHeight={900}>
      <section
        className="relative overflow-hidden py-section jh-night-section"
        style={{ background: 'hsl(var(--jh-paper))' }}
      >
        {/* 同屬紙場景，不再加暗金分隔線，避免「柵欄感」 */}
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
                <Link to="/holding-checkup" data-cta="warroom_checkup" data-cta-section="warroom">
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
  </>
);
