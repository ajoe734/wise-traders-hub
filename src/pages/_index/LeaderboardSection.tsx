import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Calendar, ArrowRight, Flame, Trophy, Clock, History, ScrollText } from 'lucide-react';
import { LazyOnVisible } from '@/components/LazyOnVisible';

export const LeaderboardSection = () => (
  <>
      {/* Seam: 戰情室(墨褐) → 戰報榜(暗褐) — 同色系內部轉場，僅靠暗金細線 + 標題分層 */}
      <div
        aria-hidden="false"
        className="relative w-full"
        style={{
          background:
            'linear-gradient(180deg, hsl(var(--jh-battle-bg)) 0%, hsl(var(--jh-report-bg)) 100%)',
        }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px"
          aria-hidden="true"
          style={{ background: 'linear-gradient(90deg, transparent, hsl(var(--jh-amber) / 0.4) 30%, hsl(var(--jh-amber) / 0.4) 70%, transparent)' }}
        />
        <div className="container relative py-6 text-center">
          <div
            className="inline-flex items-center gap-3 text-[11px] tracking-[0.36em] uppercase"
            style={{ color: 'hsl(var(--jh-amber-soft) / 0.7)' }}
          >
            <span className="block w-8 h-px" style={{ background: 'hsl(var(--jh-amber) / 0.5)' }} />
            戰情室外，江湖每週開榜一次
            <span className="block w-8 h-px" style={{ background: 'hsl(var(--jh-amber) / 0.5)' }} />
          </div>
        </div>
      </div>

      {/* Weekly Limit Up Leaderboard - War Report Style */}
      <LazyOnVisible mode="content-visibility" minHeight={620}>
      <section
        className="relative overflow-hidden py-12 md:py-14"
        style={{ background: 'hsl(var(--jh-report-bg))' }}
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
            className="relative rounded-md max-w-4xl mx-auto overflow-hidden jh-report-card"
            style={{
              background:
                'linear-gradient(180deg, hsl(var(--jh-report-bg) / 0.94), hsl(var(--jh-report-bg)) 100%)',
              border: '1px solid hsl(var(--jh-amber) / 0.18)',
              boxShadow:
                '0 0 0 1px hsl(var(--jh-amber) / 0.04), 0 30px 60px -30px hsl(var(--jh-candle) / 0.18), inset 0 1px 0 hsl(var(--jh-amber) / 0.06)',
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

            {/* 3-column summary — 榜文三欄記錄，深褐墨色而非純黑 dashboard */}
            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-px"
              style={{
                background: 'hsl(var(--jh-amber) / 0.08)',
                borderTop: '1px solid hsl(var(--jh-amber) / 0.10)',
              }}
            >
              {[
                { icon: Clock, label: '最新追蹤', value: '本週尚無新命中', sub: '等待收盤後更新' },
                { icon: History, label: '歷史命中', value: '回看過去漲停案例', sub: '理解起漲前線索' },
                { icon: Calendar, label: '更新規則', value: '每日收盤後更新', sub: '以實際命中紀錄為準' },
              ].map((item, i) => (
                <div key={i} className="px-5 py-4" style={{ background: 'hsl(var(--jh-report-cell, var(--jh-ink-soft)))' }}>
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
            <div className="px-5 md:px-7 py-5" style={{ borderTop: '1px solid hsl(var(--jh-amber) / 0.10)' }}>
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
                borderTop: '1px solid hsl(var(--jh-amber) / 0.14)',
                background: 'linear-gradient(180deg, transparent, hsl(var(--jh-candle) / 0.03))',
              }}
            >
              <Link
                to="/experts?role=advisor"
                className="jh-report-cta w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-sm text-sm font-medium transition-all"
                style={{
                  background: 'hsl(18 76% 50%)',
                  color: 'hsl(var(--jh-bone))',
                  border: '1px solid hsl(var(--jh-amber) / 0.45)',
                  boxShadow:
                    'inset 0 1px 0 hsl(var(--jh-amber-soft) / 0.25), inset 0 -1px 0 hsl(0 0% 0% / 0.18), 0 6px 18px -10px hsl(var(--jh-candle) / 0.45)',
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
  </>
);
