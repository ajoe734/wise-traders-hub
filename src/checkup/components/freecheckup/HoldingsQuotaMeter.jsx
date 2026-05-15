// HoldingsQuotaMeter — 抽自 FreeCheckup.jsx (原 IIFE @ L3329-L3444)。
// 行為對等：訪客（isDemo）回傳 null；無 quota 顯示 placeholder；其餘顯示 used/limit + 重置倒數 + 升級 CTA。
// React.memo 於父層每秒 quote tick 時可跳過 re-render（quota 物件 reference 穩定）。
import { memo } from 'react';
import { validateProps } from './_validateProps.js';

const SCHEMA = {
  isDemo: 'boolean',
  quota: { type: 'object', optional: true },
  tier: 'string',
  tierLabel: 'string',
  C: 'object',
  alpha: 'function',
  formatResetCountdown: 'function',
};

function HoldingsQuotaMeterImpl(props) {
  validateProps('HoldingsQuotaMeter', props, SCHEMA);
  const { isDemo, quota, tier, tierLabel, C, alpha, formatResetCountdown } = props;

  if (isDemo) return null;

  if (!quota) {
    return (
      <div className="checkup-quota-meter" style={{
        marginBottom: 14, padding: '12px 14px',
        border: `1px solid ${C.border}`, borderRadius: 10, background: C.card,
      }}>
        <div style={{ fontSize: 12, color: C.textMute, letterSpacing: '0.02em', marginBottom: 8 }}>載入配額中…</div>
        <div style={{ height: 4, background: alpha(C.textMute, '18'), borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: '30%', background: alpha(C.textMute, '40'), animation: 'pulse 1.4s ease-in-out infinite' }} />
        </div>
      </div>
    );
  }

  const used = Number(quota.used || 0);
  const limit = Math.max(Number(quota.limit || 1), 1);
  const remain = Math.max(limit - used, 0);
  const pct = Math.min(100, Math.max(0, (used / limit) * 100));
  const ratio = remain / limit;
  const barColor = remain === 0 ? C.down : ratio <= 0.2 ? C.amber : C.teal;
  const periodCN = quota.period === 'week' ? '本週' : '本月';
  const showUpgrade = tier === 'free' || tier === 'basic';

  return (
    <div className="checkup-quota-meter" style={{
      marginBottom: 14,
      padding: '12px 14px',
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      background: C.card,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 10, letterSpacing: '0.08em', color: C.textMute, fontWeight: 500,
            padding: '2px 7px', border: `1px solid ${C.border}`, borderRadius: 4,
          }}>{tierLabel}</span>
          <span style={{ fontSize: 12, color: C.textSec, fontWeight: 400, letterSpacing: '0.02em' }}>
            {periodCN} AI 健檢
          </span>
        </div>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
          <span style={{ color: remain === 0 ? C.down : C.text }}>{used}</span>
          <span style={{ color: C.textMute, margin: '0 2px' }}>/</span>
          <span style={{ color: C.textMute }}>{limit}</span>
        </div>
      </div>
      <div style={{ height: 4, background: alpha(C.textMute, '18'), borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: barColor,
          transition: 'width 360ms ease, background-color 200ms',
        }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, color: C.textMute, letterSpacing: '0.02em', lineHeight: 1.6 }}>
          {remain === 0
            ? <>已用完・<span style={{ color: C.textSec }}>{formatResetCountdown(quota.resets_at)}</span></>
            : <>還剩 <span style={{ color: C.text, fontWeight: 500 }}>{remain}</span> 次・{formatResetCountdown(quota.resets_at)}</>
          }
        </div>
        {showUpgrade && (
          <a href="/pricing#checkup" style={{
            fontSize: 11, color: C.blue, textDecoration: 'none', letterSpacing: '0.02em',
            padding: '3px 8px', border: `1px solid ${alpha(C.blue, '40')}`, borderRadius: 4,
          }}>升級 →</a>
        )}
      </div>
      {remain === 1 && showUpgrade && (
        <div style={{
          marginTop: 8,
          padding: '6px 10px',
          background: alpha(C.amber, '10'),
          border: `1px solid ${alpha(C.amber, '40')}`,
          borderRadius: 6,
          fontSize: 11, color: C.text, letterSpacing: '0.02em', lineHeight: 1.6,
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        }}>
          <span>⚡</span>
          <span style={{ fontWeight: 500 }}>最後一次</span>
          <span style={{ color: C.textSec }}>用完前先升級，下期不間斷</span>
        </div>
      )}
      {remain === 0 && showUpgrade && (
        <div style={{
          marginTop: 8,
          padding: '8px 10px',
          background: alpha(C.blue, '08'),
          border: `1px solid ${alpha(C.blue, '40')}`,
          borderRadius: 6,
          fontSize: 11, color: C.text, letterSpacing: '0.02em', lineHeight: 1.6,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ color: C.textSec }}>
            {tier === 'free'
              ? '想立即繼續？升級 Basic（每週 1 次）或 Pro（每月 22 次）'
              : '升級 Pro 即可每月使用 22 次'}
          </span>
          <a href="/pricing#checkup" style={{
            fontSize: 11, fontWeight: 500, color: '#fff', background: C.blue,
            padding: '4px 10px', borderRadius: 4, textDecoration: 'none', letterSpacing: '0.02em', whiteSpace: 'nowrap',
          }}>{tier === 'free' ? '查看升級方案' : '升級 Pro'}</a>
        </div>
      )}
      <div style={{ fontSize: 10, color: C.textMute, marginTop: 6, opacity: 0.7, letterSpacing: '0.02em' }}>
        截圖解析・收盤分析・新聞彙整・事件預測共用此配額
      </div>
    </div>
  );
}

const HoldingsQuotaMeter = memo(HoldingsQuotaMeterImpl);
HoldingsQuotaMeter.displayName = 'HoldingsQuotaMeter';
export default HoldingsQuotaMeter;
