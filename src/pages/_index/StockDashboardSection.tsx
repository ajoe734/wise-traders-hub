import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, ArrowRight, BarChart3, LineChart, Lightbulb, ScrollText } from 'lucide-react';
import { LazyOnVisible } from '@/components/LazyOnVisible';

export const StockDashboardSection = () => (
  <>
      {/* Seam: 戰報榜(墨) → 持股卷宗(紙) */}
      {/* Seam: 戰報榜(暗褐) → 持股卷宗(紙) — 短版墨色退場，50px */}
      <div
        aria-hidden="true"
        className="relative w-full jh-seam-report-to-stock"
        style={{
          height: 56,
          background:
            'linear-gradient(180deg, hsl(var(--jh-report-bg)) 0%, hsl(var(--jh-report-bg) / 0.72) 40%, hsl(var(--jh-paper) / 0.85) 80%, hsl(var(--jh-paper)) 100%)',
        }}
      />
      {/* Stock Dashboard Section - 持股卷宗（江湖卷宗風） */}
      <LazyOnVisible mode="content-visibility" minHeight={900}>
      <section
        className="relative overflow-hidden py-section jh-night-section"
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
                  <p
                    className="text-sm mb-3"
                    style={{ color: 'hsl(var(--jh-earth))', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.04em' }}
                  >
                    先用自己的股票試一次
                  </p>
                  <Button
                    size="xl"
                    className="text-white border-0"
                    style={{ background: 'hsl(var(--jh-candle))' }}
                    asChild
                  >
                    <Link to="/holding-checkup" data-cta="jianghu_free_trial" data-cta-section="jianghu">
                      免費試用持股卷宗
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Link>
                  </Button>
                  <p className="text-[11px] mt-3" style={{ color: 'hsl(var(--jh-stone))' }}>
                    不用註冊，先看懂手上的部位。
                  </p>
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
                      <span className={`text-sm font-semibold tabular-nums ${h.tone === 'up' ? 'jh-pct-up' : 'jh-pct-down'}`}>
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
  </>
);
