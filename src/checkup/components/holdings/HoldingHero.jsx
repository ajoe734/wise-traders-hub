import { HOLDINGS_TOKENS, valueColor, valueArrow, valueWeight } from './holdingsTokens.js';

/**
 * HoldingHero — 持倉摘要列
 *
 * 高度約 120–140px，4 個 KPI 水平排列，無強色塊。
 * 報酬率 / 損益由 Header 提供，這裡專注：
 *   今日損益・部位數・累積成本・平均報酬
 */
export default function HoldingHero({
  totalCost = 0,
  totalValue = 0,
  totalPnl = 0,
  totalPct = 0,
  todayPnl = null,
  todayPct = null,
  positionCount = 0,
}) {
  const fmt = (n) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString() : '—';
  const fmtPct = (n) =>
    typeof n === 'number' && Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—';
  const sign = (n) => (typeof n === 'number' && n >= 0 ? '+' : '');

  const kpis = [
    {
      label: '總市值',
      value: `NT$ ${fmt(totalValue)}`,
      color: HOLDINGS_TOKENS.ink,
      weight: 400,
      sub: `成本 ${fmt(totalCost)}`,
    },
    {
      label: '今日損益',
      value:
        todayPnl != null
          ? `${valueArrow(todayPnl)} ${sign(todayPnl)}${fmt(todayPnl)}`.trim()
          : '—',
      color: todayPnl != null ? valueColor(todayPnl) : HOLDINGS_TOKENS.inkLight,
      weight: todayPnl != null ? valueWeight(todayPnl) : 400,
      sub: todayPct != null ? fmtPct(todayPct) : '尚無報價',
    },
    {
      label: '累積報酬',
      value: `${valueArrow(totalPnl)} ${fmtPct(totalPct)}`.trim(),
      color: valueColor(totalPnl),
      weight: valueWeight(totalPnl),
      sub: `${sign(totalPnl)}${fmt(totalPnl)}`,
    },
    {
      label: '部位',
      value: `${positionCount} 檔`,
      color: HOLDINGS_TOKENS.ink,
      weight: 400,
      sub: '\u00A0',
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        padding: '20px 4px 22px',
        marginBottom: 16,
        borderBottom: `1px solid ${HOLDINGS_TOKENS.hair}`,
      }}
      className="holdings-hero"
    >
      {kpis.map((k, idx) => (
        <div
          key={k.label}
          style={{
            paddingLeft: idx === 0 ? 0 : 18,
            borderLeft: idx === 0 ? 'none' : `1px solid ${HOLDINGS_TOKENS.hair}`,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: HOLDINGS_TOKENS.inkLight,
              fontWeight: 400,
              letterSpacing: '0.14em',
              marginBottom: 8,
              textTransform: 'uppercase',
            }}
          >
            {k.label}
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: k.weight,
              color: k.color,
              letterSpacing: '-0.01em',
              lineHeight: 1.1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {k.value}
          </div>
          <div
            style={{
              fontSize: 11,
              color: HOLDINGS_TOKENS.inkLight,
              marginTop: 6,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.02em',
            }}
          >
            {k.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
