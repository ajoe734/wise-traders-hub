// HoldingsHero — Monocle 改版（2026-07-15）：
// 原 4 欄 KPI 帶已刪。只留「未實現損益」+ 大字損益（% accent）+ 右側一行「市值 X 萬 · N 檔 · 即時」。
// 保持所有 props signature 不變（HoldingsTab 呼叫端不需改）。
// fontSize ≥ 32 (clamp 36-52) 已配 className="wb-hero-pnl-num"，繼承 FreeCheckup.jsx 既有 media query。
import { memo } from 'react';
import { fmtSigned, fmtSignedInt, fmtWan } from '@/checkup/lib/checkupFormat';
import { validateProps } from './_validateProps.js';

const SCHEMA = {
  totalVal: 'number',
  totalCost: 'number',
  holdingsCount: 'number',
  winnersCount: 'number',
  exitListLength: 'number',
  reviewListLength: 'number',
  maxHoldings: 'number',
  rtConnected: 'boolean',
  lastUpdate: { type: 'object', optional: true },
  isDemo: 'boolean',
  WB: 'object',
  wbTone: 'function',
};

function HoldingsHeroImpl(props) {
  validateProps('HoldingsHero', props, SCHEMA);
  const {
    totalVal, totalCost, holdingsCount,
    rtConnected, lastUpdate, isDemo,
  } = props;

  const totalPnl = totalVal - totalCost;
  const totalPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;
  const isUp = totalPnl >= 0;

  const statusText = rtConnected ? '即時' : (isDemo ? 'DEMO' : '離線');
  const timeText = lastUpdate
    ? lastUpdate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';

  return (
    <section
      aria-label="持倉概覽"
      data-testid="holdings-hero"
      style={{
        padding: '24px 4px 22px',
        marginBottom: 18,
        borderBottom: '1px solid var(--cm-hair)',
      }}
    >
      <div
        className="wb-hero-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 24,
          alignItems: 'flex-end',
        }}
      >
        {/* 左：未實現損益 大字 */}
        <div>
          <div className="cm-label" style={{ marginBottom: 12 }}>未實現損益</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <span
              className="wb-hero-pnl-num cm-num"
              style={{
                fontSize: 'clamp(36px, 7vw, 52px)',
                fontWeight: isUp ? 500 : 400,
                color: 'var(--cm-ink)',
                letterSpacing: '-0.03em',
                lineHeight: 0.95,
              }}
            >
              {fmtSignedInt(totalPnl)}
            </span>
            <span
              className="wb-hero-pnl-pct cm-num"
              style={{
                fontSize: 22,
                fontWeight: 500,
                color: isUp ? 'var(--cm-accent)' : 'var(--cm-loss)',
                letterSpacing: '-0.01em',
              }}
            >
              {fmtSigned(totalPct)}%
            </span>
          </div>
        </div>

        {/* 右：市值 · 檔數 · 即時 一行 */}
        <div
          className="wb-hero-market"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
            paddingBottom: 4,
          }}
        >
          <div className="cm-num" style={{
            fontSize: 12,
            color: 'var(--cm-ink-sub)',
            letterSpacing: '0.04em',
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 6,
          }}>
            <span style={{ color: 'var(--cm-ink-mute)' }}>市值</span>
            <span style={{ color: 'var(--cm-ink)', fontWeight: 500 }}>
              {totalVal > 0 ? fmtWan(totalVal) : '—'}
            </span>
            <span style={{ color: 'var(--cm-hair-strong)' }}>·</span>
            <span>{holdingsCount > 0 ? `${holdingsCount} 檔` : '— 檔'}</span>
            <span style={{ color: 'var(--cm-hair-strong)' }}>·</span>
            <span
              style={{
                color: rtConnected ? 'var(--cm-accent)' : 'var(--cm-ink-mute)',
                fontWeight: rtConnected ? 500 : 400,
              }}
            >{statusText}</span>
          </div>
          {timeText && (
            <div className="cm-label cm-num" style={{
              color: 'var(--cm-ink-mute)', letterSpacing: '0.10em',
            }}>
              更新於 {timeText}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const HoldingsHero = memo(HoldingsHeroImpl);
HoldingsHero.displayName = 'HoldingsHero';
export default HoldingsHero;
