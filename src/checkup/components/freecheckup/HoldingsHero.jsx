// HoldingsHero — 抽自 FreeCheckup.jsx (原 IIFE @ L3492-L3634)。
// 行為對等：左大 P&L 數字 + 右市場狀態 + 4 欄 KPI 帶。
// fontSize ≥ 32 (88, 48 in clamp) 已配 className="wb-hero-pnl-num"，搭配 FreeCheckup
// 既有 <style> media-query 在 ≤560 / ≤380 縮放，符合 Core 強制規範。
import { memo } from 'react';
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
    totalVal, totalCost,
    holdingsCount, winnersCount,
    exitListLength, reviewListLength,
    maxHoldings, rtConnected, lastUpdate, isDemo,
    WB, wbTone,
  } = props;

  const totalPnl = totalVal - totalCost;
  const totalPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;
  const isUp = totalPnl >= 0;
  // wbTone 為 module-level pure fn，呼叫保留以維持與既有行為一致
  void wbTone(totalPnl);
  const winRate = holdingsCount > 0 ? Math.round((winnersCount / holdingsCount) * 100) : 0;
  const today = new Date();
  const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`;
  const timeStr = today.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  const pendingCount = exitListLength + reviewListLength;

  return (
    <section
      aria-label="Portfolio Overview"
      style={{
        padding: '20px 4px 22px',
        marginBottom: 18,
        borderBottom: `1px solid ${WB.hair}`,
      }}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
        gap: 24,
        alignItems: 'flex-end',
        marginBottom: 22,
      }} className="wb-hero-grid">
        {/* 左：Today's P&L 大字 */}
        <div>
          <div style={{
            fontSize: 11, color: WB.inkMute, letterSpacing: '0.12em',
            textTransform: 'uppercase', fontWeight: 500, marginBottom: 14,
          }}>
            Today's P&amp;L
          </div>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
          }}>
            <span className="wb-hero-pnl-num" style={{
              fontSize: 88, fontWeight: 500, color: WB.ink,
              letterSpacing: '-0.045em', lineHeight: 0.92,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {isUp ? '+' : ''}{Math.round(totalPnl).toLocaleString()}
            </span>
            <span className="wb-hero-pnl-pct" style={{
              fontSize: 22, fontWeight: 500, color: WB.accent,
              letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums',
            }}>
              {isUp ? '+' : ''}{totalPct.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* 右：Market 狀態 */}
        <div className="wb-hero-market" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
          gap: 6, paddingBottom: 8,
        }}>
          <div style={{
            fontSize: 9.5, color: WB.inkMute, letterSpacing: '0.22em',
            textTransform: 'uppercase', fontWeight: 500,
            display: 'inline-flex', alignItems: 'baseline', gap: 8,
          }}>
            Market <span style={{ color: WB.ink }}>TAIWAN</span>
            <span style={{
              display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
              background: WB.accent,
            }} />
          </div>
          <div style={{
            fontSize: 11, color: WB.inkMute, letterSpacing: '0.04em',
            fontVariantNumeric: 'tabular-nums',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: rtConnected ? WB.accent : WB.inkLight,
              opacity: rtConnected ? 1 : 0.5,
              boxShadow: rtConnected ? `0 0 0 2px ${WB.accent}22` : 'none',
              transition: 'all 0.3s ease',
            }} />
            <span>{rtConnected ? '即時' : (isDemo ? 'DEMO' : '離線')}</span>
            <span style={{ color: WB.inkLight }}>·</span>
            <span>
              {lastUpdate
                ? lastUpdate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                : `${dateStr} ${timeStr}`}
            </span>
          </div>
          {pendingCount > 0 && (
            <div style={{
              fontSize: 11, color: WB.accent, letterSpacing: '0.04em',
              marginTop: 2, fontWeight: 500,
            }}>
              {pendingCount} pending action{pendingCount > 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      {/* 4 欄 KPI 帶 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 18,
        paddingTop: 16,
        borderTop: `1px solid ${WB.hair}`,
      }} className="wb-hero-kpi">
        {[
          { label: 'Total Value', value: totalVal > 0 ? Math.round(totalVal).toLocaleString() : '—', sub: 'TWD' },
          { label: 'Holdings', value: holdingsCount > 0 ? `${holdingsCount} / ${maxHoldings}` : '—', sub: holdingsCount > 0 ? (holdingsCount >= maxHoldings - 5 ? '⚠ 接近上限' : 'positions') : '' },
          { label: 'Win Rate', value: holdingsCount > 0 ? `${winRate}` : '—', sub: holdingsCount > 0 ? '%' : '' },
          { label: 'Cost Basis', value: totalCost > 0 ? Math.round(totalCost).toLocaleString() : '—', sub: 'TWD' },
        ].map((item) => (
          <div key={item.label}>
            <div style={{
              fontSize: 9, color: WB.inkLight, letterSpacing: '0.20em',
              marginBottom: 6, textTransform: 'uppercase', fontWeight: 500,
            }}>
              {item.label}
            </div>
            <div style={{
              fontSize: 18, fontWeight: 400, color: WB.ink,
              letterSpacing: '-0.005em', fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {item.value}
              {item.sub && (
                <span style={{
                  fontSize: 10.5, color: WB.inkLight, marginLeft: 4, fontWeight: 400, letterSpacing: '0.04em',
                }}>
                  {item.sub}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const HoldingsHero = memo(HoldingsHeroImpl);
HoldingsHero.displayName = 'HoldingsHero';
export default HoldingsHero;
