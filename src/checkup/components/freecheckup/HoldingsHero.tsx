// HoldingsHero — Monocle 改版（2026-07-15）：
// 原 4 欄 KPI 帶已刪。只留「未實現損益」+ 大字損益（% accent）+ 右側一行「市值 X 萬 · N 檔 · 即時」。
// 保持所有 props signature 不變（HoldingsTab 呼叫端不需改）。
// fontSize ≥ 32 (clamp 36-52) 已配 className="wb-hero-pnl-num"，繼承 FreeCheckup.jsx 既有 media query。
// 2026-07-21：新增「更新於 HH:MM · N 分鐘前」與手動刷新按鈕；每 30 秒 tick 讓相對時間跟得上時鐘。
import { memo, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fmtSigned, fmtSignedInt, fmtWan } from '@/checkup/lib/checkupFormat';
import { validateProps } from '@/checkup/lib/validateProps.js';
import { AUTO_REFRESH_OPTIONS, useAutoRefreshMinutes } from '@/checkup/lib/autoRefreshInterval';

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
  holdings: { type: 'array', optional: true }, // Array<Holding>，用來彙總價格來源與最舊抓取時間
};

// 對齊 stockPriceWaterfall 的 label 映射，讓 hero 顯示與卡片/抽屜一致
const SRC_LABEL: Record<string, string> = {
  screenshot: '截圖',
  live: '即時',
  high: '最高',
  ask: '賣一',
  yclose: '昨收',
  demo: 'DEMO',
  regularMarketPrice: '收盤',
  previousClose: '昨收',
  chartClose: '已收K',
  twse: 'TWSE',
  yahoo: 'Yahoo',
  realtime: '即時',
};

function summarizePriceSources(holdings: any[] | undefined) {
  if (!Array.isArray(holdings) || holdings.length === 0) return null;
  const counts = new Map<string, number>();
  let oldest = Number.POSITIVE_INFINITY;
  let newest = 0;
  let missing = 0;
  for (const h of holdings) {
    const src = h?.priceSource;
    if (src) counts.set(src, (counts.get(src) || 0) + 1);
    else missing += 1;
    const t = h?.priceUpdatedAt ? new Date(h.priceUpdatedAt).getTime() : 0;
    if (t > 0) {
      if (t < oldest) oldest = t;
      if (t > newest) newest = t;
    }
  }
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return {
    entries, // [[srcKey, count], ...]
    missing,
    oldest: Number.isFinite(oldest) ? oldest : 0,
    newest,
  };
}


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
    holdings,
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
  const [autoMin, setAutoMin] = useAutoRefreshMinutes();

  // 價格來源分佈 + 最舊抓取時間（讓使用者判斷是否有個股停留在舊 tick）
  const priceSummary = summarizePriceSources(holdings);
  const oldestMs = priceSummary?.oldest || 0;
  const oldestText = oldestMs
    ? new Date(oldestMs).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const oldestAgeMin = oldestMs ? Math.floor((nowMs - oldestMs) / 60000) : 0;
  const oldestStale = oldestMs > 0 && (nowMs - oldestMs) > 15 * 60 * 1000; // > 15 min 視為過期
  const summaryTitle = priceSummary
    ? [
        priceSummary.entries.length
          ? `價格來源：${priceSummary.entries.map(([k, v]) => `${SRC_LABEL[k] || k} ${v}`).join('、')}`
          : null,
        priceSummary.missing ? `${priceSummary.missing} 檔尚未同步報價` : null,
        oldestMs ? `最舊 tick：${new Date(oldestMs).toLocaleString('zh-TW')}（${oldestAgeMin} 分鐘前）` : null,
        priceSummary.newest ? `最新 tick：${new Date(priceSummary.newest).toLocaleString('zh-TW')}` : null,
      ].filter(Boolean).join('\n')
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
                aria-label={refreshing ? '同步中，正在刷新持倉報價' : (hasError ? '重試同步持倉報價' : '立即更新持倉報價')}
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
            {/* 自動刷新間隔設定 */}
            <label
              data-testid="holdings-hero-auto-refresh"
              title="自動刷新持倉報價的間隔（依網路狀況調整）"
              style={{
                marginLeft: 4,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                color: 'var(--cm-ink-mute)',
                letterSpacing: '0.06em',
              }}
            >
              <span style={{ color: 'var(--cm-hair-strong)' }}>·</span>
              <select
                aria-label="自動刷新間隔"
                data-testid="holdings-hero-auto-refresh-select"
                value={autoMin}
                onChange={(e) => setAutoMin(Number(e.target.value))}
                disabled={refreshing}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--cm-hair)',
                  borderRadius: 3,
                  color: autoMin === 0 ? 'var(--cm-ink-mute)' : 'var(--cm-ink-sub)',
                  fontSize: 10,
                  padding: '1px 4px',
                  letterSpacing: '0.06em',
                  cursor: refreshing ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {AUTO_REFRESH_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>

          </div>

          {/* 價格來源與最舊抓取時間（Handoff §3.5：資料新鮮度可視化） */}
          {priceSummary && (priceSummary.entries.length > 0 || priceSummary.missing > 0) && (
            <div
              data-testid="holdings-hero-price-sources"
              title={summaryTitle}
              style={{
                fontSize: 10,
                letterSpacing: '0.08em',
                color: 'var(--cm-ink-mute)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                maxWidth: '100%',
              }}
            >
              <span style={{ color: 'var(--cm-ink-mute)' }}>來源</span>
              {priceSummary.entries.map(([src, count], idx) => (
                <span key={src} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
                  {idx > 0 && <span style={{ color: 'var(--cm-hair-strong)' }}>·</span>}
                  <span
                    data-price-src={src}
                    style={{ color: 'var(--cm-ink-sub)', fontWeight: 500 }}
                  >
                    {SRC_LABEL[src] || src}
                  </span>
                  <span className="cm-num" style={{ color: 'var(--cm-ink-mute)' }}>{count}</span>
                </span>
              ))}
              {priceSummary.missing > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
                  {priceSummary.entries.length > 0 && <span style={{ color: 'var(--cm-hair-strong)' }}>·</span>}
                  <span style={{ color: 'var(--cm-loss)', fontWeight: 500 }}>未同步</span>
                  <span className="cm-num" style={{ color: 'var(--cm-loss)' }}>{priceSummary.missing}</span>
                </span>
              )}
              {oldestText && (
                <>
                  <span style={{ color: 'var(--cm-hair-strong)' }}>｜</span>
                  <span style={{ color: 'var(--cm-ink-mute)' }}>最舊抓取</span>
                  <span
                    className="cm-num"
                    data-testid="holdings-hero-oldest-fetch"
                    style={{
                      color: oldestStale ? 'var(--cm-loss)' : 'var(--cm-ink-sub)',
                      fontWeight: oldestStale ? 600 : 500,
                    }}
                  >
                    {oldestText}
                  </span>
                  {oldestStale && (
                    <span style={{ color: 'var(--cm-loss)', fontSize: 9 }}>
                      （{oldestAgeMin} 分鐘前）
                    </span>
                  )}
                </>
              )}
            </div>
          )}

        </div>

      </div>
      <style>{`@keyframes holdingsHeroSpin { to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}

const HoldingsHero = memo(HoldingsHeroImpl);
HoldingsHero.displayName = 'HoldingsHero';
export default HoldingsHero;
