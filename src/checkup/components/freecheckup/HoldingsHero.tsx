// HoldingsHero — Monocle 改版（2026-07-15）：
// 原 4 欄 KPI 帶已刪。只留「未實現損益」+ 大字損益（% accent）+ 右側一行「市值 X 萬 · N 檔 · 即時」。
// 保持所有 props signature 不變（HoldingsTab 呼叫端不需改）。
// fontSize ≥ 32 (clamp 36-52) 已配 className="wb-hero-pnl-num"，繼承 FreeCheckup.jsx 既有 media query。
// 2026-07-21：新增「更新於 HH:MM · N 分鐘前」與手動刷新按鈕；每 30 秒 tick 讓相對時間跟得上時鐘。
import { memo, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
  refreshing: { type: 'boolean', optional: true },
  onRefreshPrices: { type: 'function', optional: true },
  refreshError: { type: 'string', optional: true },
  isDemo: 'boolean',
  WB: 'object',
  wbTone: 'function',
};

function formatRelative(fromMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - fromMs);
  if (diff < 45 * 1000) return '剛剛更新';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function HoldingsHeroImpl(props) {
  validateProps('HoldingsHero', props, SCHEMA);
  const {
    totalVal, totalCost, holdingsCount,
    rtConnected, lastUpdate, isDemo,
    refreshing, onRefreshPrices, refreshError,
  } = props;
  const hasError = !refreshing && !!refreshError;

  const totalPnl = totalVal - totalCost;
  const totalPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;
  const isUp = totalPnl >= 0;

  const statusText = rtConnected ? '即時' : (isDemo ? 'DEMO' : '離線');
  const timeText = lastUpdate
    ? lastUpdate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';

  // 30 秒 tick → 讓「N 分鐘前」隨時鐘推進
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!lastUpdate) return;
    const id = setInterval(() => setNowMs(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, [lastUpdate]);
  const relText = lastUpdate ? formatRelative(lastUpdate.getTime(), nowMs) : '';
  const isStale = lastUpdate ? (nowMs - lastUpdate.getTime()) > 5 * 60 * 1000 : false;

  const canRefresh = typeof onRefreshPrices === 'function' && !refreshing;

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

          {/* 更新時間 + 手動刷新 */}
          <div
            className="cm-label cm-num"
            data-testid="holdings-hero-updated-at"
            style={{
              color: hasError ? 'var(--cm-loss)' : (isStale ? 'var(--cm-loss)' : 'var(--cm-ink-mute)'),
              letterSpacing: '0.10em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            {refreshing ? (
              <span data-testid="holdings-hero-refreshing" style={{ color: 'var(--cm-ink-sub)' }}>
                同步中…
              </span>
            ) : hasError ? (
              <span
                data-testid="holdings-hero-refresh-error"
                title={refreshError}
                style={{
                  color: 'var(--cm-loss)',
                  fontWeight: 600,
                  maxWidth: 260,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                ✕ 同步失敗{timeText ? `（上次 ${timeText}）` : ''}
              </span>
            ) : timeText ? (
              <>
                <span>更新於 {timeText}</span>
                <span style={{ color: 'var(--cm-hair-strong)' }}>·</span>
                <span>{relText}</span>
              </>
            ) : (
              <span>尚未同步報價</span>
            )}
            {typeof onRefreshPrices === 'function' && (
              <button
                type="button"
                onClick={() => { if (canRefresh) onRefreshPrices(); }}
                disabled={!canRefresh}
                aria-label={hasError ? '重試刷新持倉報價' : '立即刷新持倉報價'}
                data-testid={hasError ? 'holdings-hero-retry' : 'holdings-hero-refresh'}
                style={{
                  marginLeft: 4,
                  border: hasError ? '1px solid var(--cm-loss)' : 'none',
                  background: 'transparent',
                  cursor: canRefresh ? 'pointer' : 'default',
                  padding: hasError ? '2px 8px' : 2,
                  borderRadius: hasError ? 4 : 0,
                  color: hasError ? 'var(--cm-loss)' : 'var(--cm-ink-sub)',
                  opacity: canRefresh ? 1 : 0.4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: hasError ? 11 : undefined,
                  fontWeight: hasError ? 600 : undefined,
                  letterSpacing: hasError ? '0.06em' : undefined,
                }}
              >
                <RefreshCw
                  size={12}
                  style={{
                    animation: refreshing ? 'holdingsHeroSpin 0.9s linear infinite' : undefined,
                  }}
                />
                {hasError && <span>重試</span>}
              </button>
            )}
          </div>

        </div>
      </div>
      <style>{`@keyframes holdingsHeroSpin { to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}

const HoldingsHero = memo(HoldingsHeroImpl);
HoldingsHero.displayName = 'HoldingsHero';
export default HoldingsHero;
