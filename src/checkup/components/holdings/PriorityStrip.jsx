import { HOLDINGS_TOKENS, valueColor, valueArrow, valueWeight } from './holdingsTokens.js';

const dotColor = (kind) => {
  if (kind === 'exit') return HOLDINGS_TOKENS.ink;
  if (kind === 'review') return HOLDINGS_TOKENS.accent;
  return HOLDINGS_TOKENS.inkLight;
};

const labelOf = (kind) => {
  if (kind === 'exit') return '出場';
  if (kind === 'review') return '檢視';
  if (kind === 'add') return '加碼';
  return '續抱';
};

/**
 * PriorityStrip — 今日優先 chip 列
 *
 * 水平捲動，每個 chip 顯示：
 *   ● 名稱(代碼) 漲跌% 動作
 *
 * 點擊 chip → onSelect(code) 同步選中右側 detail panel
 */
export default function PriorityStrip({ items = [], selectedCode = null, onSelect = () => {} }) {
  if (!items || items.length === 0) {
    return (
      <div
        style={{
          padding: '14px 0 16px',
          fontSize: 11,
          color: HOLDINGS_TOKENS.inkLight,
          letterSpacing: '0.06em',
          marginBottom: 16,
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            marginRight: 12,
            color: HOLDINGS_TOKENS.inkMute,
          }}
        >
          今日優先
        </span>
        無待處理事項
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 4px 14px',
        marginBottom: 16,
        borderBottom: `1px solid ${HOLDINGS_TOKENS.hair}`,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}
      className="holdings-priority-strip"
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: HOLDINGS_TOKENS.inkMute,
          fontWeight: 400,
          marginRight: 6,
          flexShrink: 0,
        }}
      >
        今日優先
      </span>
      {items.slice(0, 6).map((item) => {
        const isActive = selectedCode === item.code;
        const pct = Number(item.pct ?? 0);
        return (
          <button
            key={item.code}
            type="button"
            onClick={() => onSelect(item.code)}
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 12px 7px 10px',
              borderRadius: 999,
              border: `1px solid ${isActive ? HOLDINGS_TOKENS.ink : HOLDINGS_TOKENS.hair}`,
              background: isActive ? HOLDINGS_TOKENS.surface : 'transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'border-color 120ms ease, background 120ms ease',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: dotColor(item.actionType),
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 12,
                color: HOLDINGS_TOKENS.ink,
                fontWeight: 500,
                letterSpacing: '0.02em',
              }}
            >
              {item.name}
            </span>
            <span
              style={{
                fontSize: 10,
                color: HOLDINGS_TOKENS.inkLight,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {item.code}
            </span>
            <span
              style={{
                fontSize: 12,
                color: valueColor(pct),
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '0.01em',
                fontWeight: valueWeight(pct),
              }}
            >
              {valueArrow(pct)} {pct >= 0 ? '+' : ''}
              {pct.toFixed(2)}%
            </span>
            <span
              style={{
                fontSize: 10,
                color: HOLDINGS_TOKENS.inkMute,
                letterSpacing: '0.08em',
                paddingLeft: 4,
                borderLeft: `1px solid ${HOLDINGS_TOKENS.hair}`,
              }}
            >
              {labelOf(item.actionType)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
