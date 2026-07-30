import { Card } from '@/components/ui/card';
import { BookOpen, Zap, Lightbulb } from 'lucide-react';
import { LazyOnVisible } from '@/components/LazyOnVisible';

export const WarRoomSection = () => (
  <>
      {/* Seam: 選你的模式(紙) → 會員戰情室(墨褐) — 章節分界：暗金細線 + 中央菱形 */}
      <div
        aria-hidden="true"
        className="relative w-full flex items-center justify-center jh-seam-mode-to-battle"
        style={{
          height: 64,
          background:
            'linear-gradient(180deg, hsl(var(--jh-paper)) 0%, hsl(var(--jh-paper)) 48%, hsl(var(--jh-battle-bg)) 52%, hsl(var(--jh-battle-bg)) 100%)',
        }}
      >
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex items-center justify-center px-8">
          <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(var(--jh-amber) / 0.55) 30%, hsl(var(--jh-amber) / 0.55) 70%, transparent)' }} />
          <span
            className="mx-4 rotate-45 block"
            style={{
              width: 8,
              height: 8,
              background: 'hsl(var(--jh-amber) / 0.85)',
              boxShadow: '0 0 0 1px hsl(var(--jh-battle-bg))',
            }}
          />
          <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(var(--jh-amber) / 0.55) 30%, hsl(var(--jh-amber) / 0.55) 70%, transparent)' }} />
        </div>
      </div>

      {/* Real Interface Preview Section — 會員戰情室 */}
      <LazyOnVisible mode="content-visibility" minHeight={1000}>
      <section
        id="preview-section"
        className="relative py-section overflow-hidden"
        style={{ backgroundColor: 'hsl(var(--jh-battle-bg))' }}
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
                  backgroundColor: 'var(--wr-bg)',
                  border: '1px solid var(--wr-border-orange)',
                  boxShadow: 'var(--wr-card-shadow)',
                }}
              >
                {/* Card header — 固定高度功能列 */}
                <div
                  className="flex items-center justify-between px-5 py-4 border-b"
                  style={{ borderColor: 'var(--wr-divider-orange)', minHeight: 64 }}
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
                      style={{ color: 'var(--wr-ink)', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
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
                  style={{ borderColor: 'var(--wr-divider-soft)', backgroundColor: 'var(--wr-trust-bg)' }}
                >
                  <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--wr-ink-faint)', letterSpacing: '0.03em' }}>
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
                        backgroundColor: 'var(--wr-row-bg)',
                        borderLeft: `2px solid ${r.tagColor}`,
                        borderBottom: idx < arr.length - 1 ? '1px solid var(--wr-row-divider)' : 'none',
                        marginBottom: idx < arr.length - 1 ? 4 : 0,
                      }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-[11px] font-mono tracking-wider" style={{ color: 'var(--wr-ink-mute)' }}>
                            {r.code}
                          </span>
                          <span className="text-sm font-semibold truncate" style={{ color: 'var(--wr-ink)', fontFamily: '"Noto Serif TC", serif' }}>
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
                      <p className="text-[11.5px] mb-2 leading-relaxed" style={{ color: 'var(--wr-ink-soft)' }}>
                        {r.desc}
                      </p>
                      <div className="flex items-center justify-between text-[10px] pt-1" style={{ color: 'var(--wr-ink-faint)', borderTop: '1px dashed var(--wr-divider-soft)' }}>
                        <span className="font-mono tracking-wider">建議區間 {r.price}</span>
                        <span className="font-mono">{r.time}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 本日重點觀察 — 與右卡 教學重點 對齊 */}
                <div
                  className="px-5 py-3 border-t"
                  style={{ borderColor: 'var(--wr-divider-orange)', backgroundColor: 'var(--wr-footer-orange-bg)' }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Zap className="h-3 w-3" style={{ color: '#EC662D' }} />
                    <span className="text-[10px] font-medium tracking-wider uppercase" style={{ color: '#EC662D' }}>
                      本日重點觀察
                    </span>
                  </div>
                  <ul className="space-y-1 text-[11px] leading-snug" style={{ color: 'var(--wr-ink-soft)' }}>
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
                style={{ color: 'var(--wr-ink)', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
              >
                跟單派戰情室
              </h4>
              <p className="text-xs md:text-sm mt-1 leading-relaxed" style={{ color: 'var(--wr-ink-mute)' }}>
                即時接收專家買賣訊號，包含價位區間與操作理由。
              </p>
            </div>

            {/* ── 修煉派週記 ── */}
            <div className="flex flex-col">
              <div
                className="warroom-card flex-1 flex flex-col rounded-xl overflow-hidden"
                style={{
                  backgroundColor: 'var(--wr-bg)',
                  border: '1px solid var(--wr-border-amber)',
                  boxShadow: 'var(--wr-card-shadow)',
                }}
              >
                {/* Card header */}
                <div
                  className="flex items-center justify-between px-5 py-4 border-b"
                  style={{ borderColor: 'var(--wr-divider)', minHeight: 64 }}
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
                      style={{ color: 'var(--wr-ink)', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
                    >
                      本週追蹤紀錄
                    </span>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] tracking-wider"
                    style={{ backgroundColor: 'var(--wr-divider-soft)', color: '#D4A643', border: '1px solid rgba(212,166,67,0.25)' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#D4A643' }} />
                    本週
                  </span>
                </div>

                {/* 可信度輔助說明 */}
                <div
                  className="px-5 py-2 border-b flex items-center justify-between gap-3"
                  style={{ borderColor: 'var(--wr-divider-soft)', backgroundColor: 'var(--wr-trust-bg)' }}
                >
                  <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--wr-ink-faint)', letterSpacing: '0.03em' }}>
                    每週整理操作紀錄，方便回看判斷依據。
                  </p>
                  <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--wr-ink-faint)' }}>
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
                        backgroundColor: 'var(--wr-row-bg)',
                        borderLeft: `2px solid ${r.tagColor}`,
                        borderBottom: i < arr.length - 1 ? '1px solid var(--wr-row-divider)' : 'none',
                        marginBottom: i < arr.length - 1 ? 4 : 0,
                        opacity: r.tag ? 1 : 0.65,
                      }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-baseline gap-2.5 min-w-0">
                          <span className="text-[11px] font-medium shrink-0" style={{ color: 'var(--wr-ink-mute)', fontFamily: '"Noto Serif TC", serif' }}>
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
                              <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--wr-ink-mute)' }}>
                                {r.code}
                              </span>
                              <span className="text-sm font-semibold truncate" style={{ color: 'var(--wr-ink)', fontFamily: '"Noto Serif TC", serif' }}>
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
                      <p className="text-[11.5px] leading-relaxed pl-0" style={{ color: 'var(--wr-ink-soft)' }}>
                        {r.desc}
                      </p>
                    </div>
                  ))}
                </div>

                {/* 本週教學重點 */}
                <div
                  className="px-5 py-3 border-t"
                  style={{ borderColor: 'var(--wr-divider)', backgroundColor: 'var(--wr-footer-amber-bg)' }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Lightbulb className="h-3 w-3" style={{ color: '#D4A643' }} />
                    <span className="text-[10px] font-medium tracking-wider uppercase" style={{ color: '#D4A643' }}>
                      本週教學重點
                    </span>
                  </div>
                  <ul className="space-y-1 text-[11px] leading-snug" style={{ color: 'var(--wr-ink-soft)' }}>
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
                style={{ color: 'var(--wr-ink)', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
              >
                修煉派週記教學
              </h4>
              <p className="text-xs md:text-sm mt-1 leading-relaxed" style={{ color: 'var(--wr-ink-mute)' }}>
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
              linear-gradient(var(--wr-overlay), var(--wr-overlay)),
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
  </>
);
