import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown } from 'lucide-react';
import jianghuFollowBg from '@/assets/jianghu-follow-bg.png';
import jianghuStudyBg from '@/assets/jianghu-study-bg.png';
import jianghuSectionBg from '@/assets/jianghu-section-bg.jpg';
import iconLightningCircle from '@/assets/icon-lightning-circle.svg';
import iconBookCircle from '@/assets/icon-book-circle.svg';
import { LazyOnVisible } from '@/components/LazyOnVisible';

export const JianghuFactionsSection = () => (
  <>
      {/* 江湖兩派 — Premium editorial / ink-wash version */}
      <LazyOnVisible mode="content-visibility" minHeight={1400}>
      <section
        className="relative overflow-hidden pt-6 md:pt-8 pb-0 jh-section-paper"
      >
        {/* Ink-wash mountain backdrop — very faint, top of section only */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 pointer-events-none jh-mountain-backdrop"
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
          className="absolute inset-0 pointer-events-none jh-paper-grain"
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
              className="text-xs md:text-sm tracking-[0.4em] mb-2 jh-mode-eyebrow"
              style={{ color: '#EC662D', fontFamily: '"Noto Serif TC", serif' }}
            >
              看懂三招之後，挑一條你想走的路
            </p>
            <h2
              className="text-3xl md:text-4xl lg:text-5xl font-bold mb-2 jh-mode-title"
              style={{ color: '#171717', fontFamily: '"Noto Serif TC", serif', letterSpacing: '0.05em' }}
            >
              選你的模式
            </h2>
            <p className="text-sm md:text-base mb-1.5 jh-mode-sub" style={{ color: 'rgba(23,23,23,0.65)' }}>
              不同的投資哲學，同樣的致勝之道
            </p>
            <p className="text-xs md:text-sm jh-mode-sub-soft" style={{ color: 'rgba(23,23,23,0.5)' }}>
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
                  width={48}
                  height={48}
                  className="w-10 h-10 md:w-12 md:h-12 mb-3"
                  loading="lazy"
                  decoding="async"
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
                className="my-3 text-[10px] tracking-[0.45em] writing-vertical-rl jh-mode-divider-text"
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
                  width={48}
                  height={48}
                  className="w-10 h-10 md:w-12 md:h-12 mb-3"
                  loading="lazy"
                  decoding="async"
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
            className="text-center mt-6 text-sm md:text-base jh-mode-footnote"
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
            className="flex flex-col items-center gap-1.5 cursor-pointer text-center px-6 jh-mode-cta-line"
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



  </>
);
