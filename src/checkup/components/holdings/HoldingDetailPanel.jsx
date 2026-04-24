import { HOLDINGS_TOKENS, valueColor } from './holdingsTokens.js';

const fmt = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString() : '—';

const SectionTitle = ({ children }) => (
  <div
    style={{
      fontSize: 10,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: HOLDINGS_TOKENS.inkLight,
      marginBottom: 10,
      fontWeight: 500,
    }}
  >
    {children}
  </div>
);

/**
 * HoldingDetailPanel — 右側研究筆記面板
 *
 * 桌面版 sticky 在右側，寬度 360px。
 * 內容由上而下：
 *   1. 標題 (代碼 + 名稱)
 *   2. 大字報酬率 + 絕對損益
 *   3. Decision (建議動作 + 一句話原因)
 *   4. Thesis (投資論點摘要)
 *   5. Target / Stop (目標/停損)
 *   6. Timeline (近期事件)
 *   7. 操作列
 */
export default function HoldingDetailPanel({
  selected = null,
  decision = null,
  meta = null,
  targetPrice = null,
  upside = null,
  relatedEvents = [],
  onOpenDrawer = () => {},
  onOverrideToHold = () => {},
  hasOverride = false,
}) {
  if (!selected) {
    return (
      <div
        style={{
          padding: '40px 20px',
          textAlign: 'center',
          color: HOLDINGS_TOKENS.inkLight,
          fontSize: 12,
          fontWeight: 400,
          letterSpacing: '0.04em',
        }}
      >
        <SectionTitle>研究筆記</SectionTitle>
        <div style={{ marginTop: 18, lineHeight: 1.8 }}>
          選擇一檔股票
          <br />
          查看完整研究筆記
        </div>
      </div>
    );
  }

  const h = selected;
  const pct = Number(h.pct ?? 0);
  const pnl = Number(h.pnl ?? 0);
  const value = Number(h.value ?? 0);
  const pctColor = valueColor(pct);

  const actionType = decision?.actionType || 'hold';
  const actionLabel =
    actionType === 'exit'
      ? '建議出場'
      : actionType === 'review'
      ? '需要檢視'
      : actionType === 'add'
      ? '可考慮加碼'
      : '繼續持有';
  const actionColor =
    actionType === 'exit'
      ? HOLDINGS_TOKENS.ink
      : actionType === 'review'
      ? HOLDINGS_TOKENS.accent
      : HOLDINGS_TOKENS.inkMute;

  return (
    <div style={{ padding: '4px 4px 24px' }}>
      {/* 1. 標題 */}
      <div style={{ marginBottom: 18 }}>
        <SectionTitle>研究筆記</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 18,
              fontWeight: 500,
              color: HOLDINGS_TOKENS.ink,
              letterSpacing: '0.02em',
            }}
          >
            {h.name}
          </span>
          <span
            style={{
              fontSize: 12,
              color: HOLDINGS_TOKENS.inkLight,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.04em',
            }}
          >
            {h.code}
          </span>
        </div>
        {meta?.industry && (
          <div
            style={{
              fontSize: 11,
              color: HOLDINGS_TOKENS.inkLight,
              letterSpacing: '0.02em',
            }}
          >
            {meta.industry}
            {meta.strategy ? ` · ${meta.strategy}` : ''}
          </div>
        )}
      </div>

      {/* 2. 大字報酬率 */}
      <div
        style={{
          marginBottom: 22,
          paddingBottom: 18,
          borderBottom: `1px solid ${HOLDINGS_TOKENS.hair}`,
        }}
      >
        <div
          style={{
            fontSize: 44,
            fontWeight: 300,
            color: pctColor,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {pct >= 0 ? '+' : ''}
          {pct.toFixed(2)}
          <span style={{ fontSize: 18, opacity: 0.5, marginLeft: 2 }}>%</span>
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: pctColor,
            opacity: 0.8,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {pnl >= 0 ? '+' : ''}NT$ {fmt(pnl)} · 市值 {fmt(value)}
        </div>
      </div>

      {/* 3. Decision */}
      <div style={{ marginBottom: 22 }}>
        <SectionTitle>決策建議</SectionTitle>
        <div
          style={{
            fontSize: 14,
            color: actionColor,
            fontWeight: 500,
            letterSpacing: '0.02em',
            marginBottom: 8,
          }}
        >
          {actionLabel}
          {hasOverride && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                color: HOLDINGS_TOKENS.inkLight,
                letterSpacing: '0.08em',
              }}
            >
              已手動覆寫
            </span>
          )}
        </div>
        {decision && (
          <div
            style={{
              display: 'flex',
              gap: 14,
              fontSize: 11,
              color: HOLDINGS_TOKENS.inkMute,
              flexWrap: 'wrap',
              letterSpacing: '0.02em',
            }}
          >
            <span>
              論點{' '}
              {decision.thesisState === 'broken'
                ? '破裂'
                : decision.thesisState === 'weakening'
                ? '弱化'
                : '完整'}
            </span>
            <span>
              信心 {decision.confidence === 'high' ? '高' : decision.confidence === 'medium' ? '中' : '低'}
            </span>
            <span>事件 {decision.openEventCount || 0}</span>
            {decision.hasConflict && (
              <span style={{ color: HOLDINGS_TOKENS.accent }}>有衝突</span>
            )}
          </div>
        )}
        {decision?.actionText && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: HOLDINGS_TOKENS.inkMute,
              lineHeight: 1.7,
            }}
          >
            {decision.actionText}
          </div>
        )}
      </div>

      {/* 4. Thesis */}
      {(meta?.strategy || meta?.leader) && (
        <div style={{ marginBottom: 22 }}>
          <SectionTitle>投資論點</SectionTitle>
          <div
            style={{
              fontSize: 12,
              color: HOLDINGS_TOKENS.inkMute,
              lineHeight: 1.8,
            }}
          >
            {meta.strategy}
            {meta.leader && meta.leader !== 'N/A' ? ` · 領頭 ${meta.leader}` : ''}
          </div>
        </div>
      )}

      {/* 5. Target / Stop */}
      {targetPrice && (
        <div style={{ marginBottom: 22 }}>
          <SectionTitle>目標 / 進度</SectionTitle>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 12, color: HOLDINGS_TOKENS.inkMute }}>
              目標價 {Number(targetPrice).toLocaleString()}
            </span>
            <span
              style={{
                fontSize: 12,
                color: upside != null ? valueColor(upside) : HOLDINGS_TOKENS.inkLight,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {upside != null
                ? `距 ${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`
                : '—'}
            </span>
          </div>
          <div
            style={{
              background: HOLDINGS_TOKENS.hair,
              borderRadius: 1,
              height: 2,
              width: '100%',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(
                  Math.max((Number(h.price) / Number(targetPrice)) * 100, 0),
                  100
                )}%`,
                height: '100%',
                background: HOLDINGS_TOKENS.ink,
                opacity: 0.4,
              }}
            />
          </div>
        </div>
      )}

      {/* 6. Timeline */}
      {relatedEvents.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <SectionTitle>近期事件</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {relatedEvents.slice(0, 5).map((e, idx) => {
              const isBreak = e.impact === 'break' || e.decisionImpact === 'break';
              const isWeaken = e.impact === 'weaken' || e.decisionImpact === 'weaken';
              const dot = isBreak
                ? HOLDINGS_TOKENS.ink
                : isWeaken
                ? HOLDINGS_TOKENS.accent
                : HOLDINGS_TOKENS.inkLight;
              return (
                <div
                  key={e.id || idx}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}
                >
                  <span
                    style={{
                      marginTop: 6,
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: dot,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: HOLDINGS_TOKENS.ink,
                        lineHeight: 1.5,
                      }}
                    >
                      {e.summary || e.title || '(無摘要)'}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: HOLDINGS_TOKENS.inkLight,
                        marginTop: 2,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {e.source === 'user'
                        ? '手動'
                        : e.source === 'ai'
                        ? 'AI'
                        : e.source === 'calendar'
                        ? '日曆'
                        : '其他'}
                      {e.date ? ` · ${e.date}` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. 操作列 */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          paddingTop: 14,
          borderTop: `1px solid ${HOLDINGS_TOKENS.hair}`,
        }}
      >
        <button
          type="button"
          onClick={() => onOpenDrawer(h.code)}
          style={{
            flex: 1,
            padding: '10px',
            background: HOLDINGS_TOKENS.ink,
            border: 'none',
            borderRadius: HOLDINGS_TOKENS.radius,
            color: HOLDINGS_TOKENS.paper,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            letterSpacing: '0.06em',
            fontFamily: 'inherit',
          }}
        >
          展開完整研究
        </button>
        {decision && !hasOverride && actionType !== 'hold' && (
          <button
            type="button"
            onClick={() => onOverrideToHold(h.code)}
            style={{
              padding: '10px 14px',
              background: 'transparent',
              border: `1px solid ${HOLDINGS_TOKENS.hairStrong}`,
              borderRadius: HOLDINGS_TOKENS.radius,
              color: HOLDINGS_TOKENS.inkMute,
              fontSize: 12,
              fontWeight: 400,
              cursor: 'pointer',
              letterSpacing: '0.04em',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            覆寫為持有
          </button>
        )}
      </div>
    </div>
  );
}
