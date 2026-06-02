// @ts-nocheck — F-Maint-R4：與其他 holdings 元件一致採漸進式 TS，完整型別化留待後續
// F-Maint-R3：原 createElement(h, ...) 全面改寫為 JSX。語意/樣式逐行對照原版維持 1:1。
import { useState } from 'react';
import { C, alpha } from '../../theme.js';
import { IND_COLOR, STOCK_META } from '../../seedData.js';
import { getHoldingMarketValue, getHoldingReturnPct } from '../../lib/holdings.js';
import { reportMissingSymbols } from '../../lib/missingPriceClient.js';

/* ── 是枝裕和《小偷家族》×《海街日記》融合美學 ──
 * 1. 極微色底取代漸層，邊框完全移除
 * 2. 字重降至 400–500，字距加大，數字「呼吸」
 * 3. 移除所有 boxShadow，用 24px 間距取代邊線
 * 4. Emoji 全部移除，改為純文字標題 + 寬字距
 * 5. 色彩極淡化，只有數字本身帶色
 */

const sectionTitle = {
  fontSize: 10,
  color: C.textMute,
  letterSpacing: '0.12em',
  fontWeight: 400,
  marginBottom: 12,
  textTransform: 'uppercase' as const,
};

/**
 * Holdings Summary — 溫暖極簡 Hero
 */
export function HoldingsSummary({ holdings, totalVal, totalCost }) {
  const totalPnl = totalVal - totalCost;
  const totalPct = totalCost > 0 ? ((totalPnl / totalCost) * 100) : 0;
  const isUp = totalPnl >= 0;
  const heroColor = isUp ? C.up : C.down;

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Hero — 極微色底，無邊框，無陰影 */}
      <div
        style={{
          background: alpha(heroColor, '06'),
          borderRadius: 12,
          padding: '24px 20px',
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: C.textMute,
            letterSpacing: '0.12em',
            marginBottom: 10,
            fontWeight: 400,
          }}
        >
          總 損 益
        </div>
        <div
          className="tn"
          style={{
            fontSize: 28,
            fontWeight: 500,
            color: heroColor,
            lineHeight: 1.3,
            letterSpacing: '0.02em',
          }}
        >
          {`${isUp ? '+' : ''}${Math.round(totalPnl).toLocaleString()}`}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            fontWeight: 400,
            color: heroColor,
            opacity: 0.7,
            letterSpacing: '0.04em',
          }}
        >
          {`${isUp ? '+' : ''}${totalPct.toFixed(2)}%`}
        </div>
      </div>

      {/* Sub-metrics — 無邊框，純文字排列 */}
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '0 8px' }}>
        {[
          ['總成本', totalCost.toLocaleString()],
          ['總市值', totalVal.toLocaleString()],
          ['持股', `${holdings.length} 檔`],
        ].map(([label, value]) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 9,
                color: C.textMute,
                letterSpacing: '0.1em',
                marginBottom: 4,
                fontWeight: 400,
              }}
            >
              {label}
            </div>
            <div
              className="tn"
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: C.textSec,
                letterSpacing: '0.02em',
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Holdings Integrity Warning — 保持功能，簡化視覺
 */
export function HoldingsIntegrityWarning({ issues, onRetry }) {
  const [retrying, setRetrying] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  if (!issues || issues.length === 0) return null;

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    setHint(null);
    try {
      const codes = issues.map((it) => String(it?.code || '').trim()).filter(Boolean);
      const res = await reportMissingSymbols(codes);
      if (res?.fetched > 0) {
        setHint(`已補回 ${res.fetched} / ${codes.length} 檔，可重新整理`);
        if (typeof onRetry === 'function') onRetry();
      } else {
        setHint('仍無法補抓，請稍後再試或聯繫客服');
      }
    } catch (e) {
      setHint('補抓失敗，請稍後再試');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      style={{
        marginBottom: 24,
        padding: '10px 14px',
        fontSize: 10,
        color: C.amber,
        lineHeight: 1.7,
        borderLeft: `1px solid ${alpha(C.amber, '20')}`,
        background: alpha(C.amber, '04'),
        borderRadius: 4,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        {`${issues.length} 檔持股缺少可用價格，市值可能暫時不完整 — `}
        {issues.slice(0, 5).map((item) => `${item.name || item.code}`).join('、')}
        {issues.length > 5 ? ' …' : ''}
        {'。'}
        {hint ? <div style={{ marginTop: 4, color: C.textMute }}>{hint}</div> : null}
      </div>
      <button
        onClick={handleRetry}
        disabled={retrying}
        style={{
          flexShrink: 0,
          fontSize: 10,
          padding: '4px 10px',
          color: C.amber,
          background: 'transparent',
          border: `1px solid ${alpha(C.amber, '30')}`,
          borderRadius: 4,
          cursor: retrying ? 'default' : 'pointer',
          letterSpacing: '0.05em',
          opacity: retrying ? 0.5 : 1,
        }}
      >
        {retrying ? '補抓中…' : '重試補抓'}
      </button>
    </div>
  );
}

/**
 * Portfolio Health Check — 灰階產業條 + 最大產業主題色
 */
export function PortfolioHealthCheck({ holdings }) {
  if (!holdings || holdings.length === 0) return null;

  const indMap: Record<string, number> = {};
  holdings.forEach((item) => {
    const m = STOCK_META[item.code];
    if (!m) return;
    indMap[m.industry] = (indMap[m.industry] || 0) + getHoldingMarketValue(item);
  });
  const indArr = Object.entries(indMap).sort((a, b) => b[1] - a[1]);
  const indTotal = indArr.reduce((s, x) => s + x[1], 0) || 1;

  const stratMap: Record<string, number> = {};
  holdings.forEach((item) => {
    const m = STOCK_META[item.code];
    if (!m) return;
    stratMap[m.strategy] = (stratMap[m.strategy] || 0) + 1;
  });

  const periodMap: Record<string, number> = {};
  holdings.forEach((item) => {
    const m = STOCK_META[item.code];
    if (!m) return;
    periodMap[m.period] = (periodMap[m.period] || 0) + 1;
  });

  const posMap: Record<string, number> = {};
  holdings.forEach((item) => {
    const m = STOCK_META[item.code];
    if (!m) return;
    posMap[m.position] = (posMap[m.position] || 0) + getHoldingMarketValue(item);
  });

  const warnings = indArr.filter(([ind, val]) => {
    const count = holdings.filter((item) => STOCK_META[item.code]?.industry === ind).length;
    return count >= 3 || val / indTotal > 0.25;
  });

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={sectionTitle}>投 組 健 檢</div>

      {/* Industry bar — 灰階為主，最大產業用原色 */}
      <div
        style={{
          display: 'flex',
          borderRadius: 3,
          overflow: 'hidden',
          height: 6,
          marginBottom: 14,
          background: alpha(C.textMute, '10'),
        }}
      >
        {indArr.map(([ind, val], i) => (
          <div
            key={ind}
            style={{
              width: `${(val / indTotal) * 100}%`,
              height: '100%',
              background: i === 0 ? (IND_COLOR[ind] || C.teal) : alpha(C.textMute, '25'),
              transition: 'width 0.4s ease',
            }}
          />
        ))}
      </div>

      {/* Industry labels */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {indArr.map(([ind, val], i) => {
          const pct = ((val / indTotal) * 100).toFixed(0);
          const count = holdings.filter((item) => STOCK_META[item.code]?.industry === ind).length;
          const isTop = i === 0;
          return (
            <span
              key={ind}
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 4,
                color: isTop ? C.text : C.textMute,
                background: isTop ? alpha(IND_COLOR[ind] || C.teal, '10') : 'transparent',
                fontWeight: isTop ? 500 : 400,
                letterSpacing: '0.02em',
              }}
            >
              {`${ind} ${count}檔 ${pct}%`}
            </span>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <div
          style={{
            borderLeft: `2px solid ${alpha(C.amber, '30')}`,
            background: alpha(C.amber, '04'),
            borderRadius: 4,
            padding: '8px 12px',
            marginBottom: 14,
            fontSize: 10,
            color: C.amber,
            lineHeight: 1.6,
            fontWeight: 400,
          }}
        >
          {'產業集中：'}
          {warnings
            .map(([ind]) => {
              const count = holdings.filter((item) => STOCK_META[item.code]?.industry === ind).length;
              return `${ind}(${count}檔)`;
            })
            .join('、')}
          {warnings.some(([, val]) => val / indTotal > 0.3) && ' — 建議分散風險'}
        </div>
      )}

      {/* Three column distributions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: C.textMute, marginBottom: 6, letterSpacing: '0.08em', fontWeight: 400 }}>策略</div>
          {Object.entries(stratMap)
            .sort((a, b) => b[1] - a[1])
            .map(([s, n]) => (
              <div key={s} style={{ fontSize: 10, color: C.textSec, marginBottom: 3, fontWeight: 400 }}>
                {s}{' '}
                <span style={{ color: C.text, fontWeight: 500 }}>{n}</span>
              </div>
            ))}
        </div>
        <div>
          <div style={{ fontSize: 9, color: C.textMute, marginBottom: 6, letterSpacing: '0.08em', fontWeight: 400 }}>週期</div>
          {Object.entries(periodMap).map(([p, n]) => (
            <div key={p} style={{ fontSize: 10, color: C.textSec, marginBottom: 3, fontWeight: 400 }}>
              {p === '短' ? '短期' : p === '中' ? '中期' : p === '短中' ? '短中期' : '中長期'}{' '}
              <span style={{ color: C.text, fontWeight: 500 }}>{n}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 9, color: C.textMute, marginBottom: 6, letterSpacing: '0.08em', fontWeight: 400 }}>定位</div>
          {/* C5 (audit 2026-06)：定位佔比分母原為 indTotal（產業總值），語義錯誤 → 應為 posMap 自身總和。 */}
          {(() => {
            const posTotal = Object.values(posMap).reduce((s, v) => s + (v || 0), 0) || 1;
            return Object.entries(posMap)
              .sort((a, b) => b[1] - a[1])
              .map(([p, val]) => (
                <div key={p} style={{ fontSize: 10, color: C.textSec, marginBottom: 3, fontWeight: 400 }}>
                  {p}{' '}
                  <span style={{ color: C.text, fontWeight: 500 }}>{`${((val / posTotal) * 100).toFixed(0)}%`}</span>
                </div>
              ));
          })()}
        </div>
      </div>
    </div>
  );
}

/**
 * Top 5 Holdings — 移除圓環，改為排名數字 + 簡約進度條
 */
export function Top5Holdings({ holdings, totalVal }) {
  const top5 = [...holdings]
    .sort((a, b) => getHoldingMarketValue(b) - getHoldingMarketValue(a))
    .slice(0, 5);

  if (top5.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={sectionTitle}>市 值 佔 比</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {top5.map((holding, i) => {
          const pct = (getHoldingMarketValue(holding) / Math.max(totalVal, 1)) * 100;
          return (
            <div key={holding.code}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: i === 0 ? C.teal : C.textMute,
                      fontWeight: i === 0 ? 500 : 400,
                      width: 14,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {`${i + 1}`}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: C.textSec,
                      fontWeight: 400,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {holding.name}
                  </span>
                </div>
                <span
                  className="tn"
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: i === 0 ? C.text : C.textSec,
                    letterSpacing: '0.02em',
                  }}
                >
                  {`${pct.toFixed(1)}%`}
                </span>
              </div>
              <div
                style={{
                  height: 2,
                  borderRadius: 1,
                  background: alpha(C.textMute, '0a'),
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: i === 0 ? C.teal : alpha(C.textMute, '20'),
                    borderRadius: 1,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Winners and Losers — 移除左邊色帶，純文字列表
 */
export function WinLossSummary({ winners, losers }) {
  const renderList = (items, color, prefix) => (
    <div>
      <div
        style={{
          ...sectionTitle,
          color: alpha(color, '80'),
          marginBottom: 10,
        }}
      >
        {`${prefix} ${items.length} 檔`}
      </div>
      {items.slice(0, 5).map((holding) => {
        const pct = getHoldingReturnPct(holding);
        return (
          <div
            key={holding.code}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 0',
              borderBottom: `1px solid ${alpha(C.textMute, '06')}`,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: C.textSec,
                fontWeight: 400,
                letterSpacing: '0.02em',
              }}
            >
              {holding.name}
            </span>
            <span
              className="tn"
              style={{
                fontSize: 11,
                fontWeight: 500,
                color,
                letterSpacing: '0.02em',
              }}
            >
              {`${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
      {renderList(winners, C.up, '獲利')}
      {renderList(losers, C.down, '虧損')}
    </div>
  );
}

/**
 * Main Holdings Panel
 */
export function HoldingsPanel({
  holdings = [],
  totalVal = 0,
  totalCost = 0,
  winners = [],
  losers = [],
  top5: _top5 = [],
  holdingsIntegrityIssues = [],
  showReversal: _showReversal = false,
  setShowReversal: _setShowReversal = () => {},
  reversalConditions: _reversalConditions = {},
  children,
}) {
  return (
    <div>
      <HoldingsSummary holdings={holdings} totalVal={totalVal} totalCost={totalCost} />
      <HoldingsIntegrityWarning issues={holdingsIntegrityIssues} />
      <PortfolioHealthCheck holdings={holdings} />
      <Top5Holdings holdings={holdings} totalVal={totalVal} />
      <WinLossSummary winners={winners} losers={losers} />
      {children}
    </div>
  );
}
