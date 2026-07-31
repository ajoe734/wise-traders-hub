import React from 'react';
import { validateProps } from '@/checkup/lib/validateProps.js';

/**
 * Props schema 守門：增刪同步 freecheckup-tab-prop-schema.test.ts。
 * startLineLogin 保留於 schema 以維持既有守門契約，
 *   但視覺上不再渲染 Demo/LINE banner（§6.5：改由頁腳 DemoFooterHint 提示）。
 */
const LOG_TAB_PROP_SCHEMA = {
  isDemo: 'boolean',
  tradeLog: 'array',
  C: 'object',
  alpha: 'function',
  card: 'object',
  startLineLogin: { type: 'function', optional: true },
  navigate: 'function',
};

/**
 * LogTab — Free Checkup「交易記錄」tab。
 * §6.4 編輯化：serif 日期節標；買進 accent／賣出 --loss；
 * 備忘 → 左髮絲引文（serif）；未填 → faint「（未留筆記）補寫 →」。
 */
function LogTabImpl({
  isDemo: _isDemo,
  tradeLog,
  C, alpha, card,
  startLineLogin: _startLineLogin,
  navigate: _navigate,
}) {
  validateProps('LogTab', arguments[0], LOG_TAB_PROP_SCHEMA);

  const serif = { fontFamily: "'Noto Serif TC', 'Source Serif 4', ui-serif, Georgia, serif" };
  const tab = { fontVariantNumeric: 'tabular-nums' };

  if (!tradeLog || tradeLog.length === 0) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: '48px 16px' }}>
        <div style={{ ...serif, fontSize: 17, color: C.text, marginBottom: 8 }}>還沒有交易記錄</div>
        <div style={{ fontSize: 12, color: C.textMute, lineHeight: 1.7 }}>上傳成交截圖後自動記錄在這裡</div>
      </div>
    );
  }

  const sorted = [...tradeLog];
  const dateGroups = [];
  let currentGroup = null;
  sorted.forEach((log) => {
    const d = log.date || '未知日期';
    if (!currentGroup || currentGroup.date !== d) {
      currentGroup = { date: d, logs: [] };
      dateGroups.push(currentGroup);
    }
    currentGroup.logs.push(log);
  });

  return (
    <>
      {dateGroups.map((group, gi) => (
        <div key={'grp-' + gi} style={{ marginBottom: gi < dateGroups.length - 1 ? 24 : 8 }}>
          {/* serif 日期節標：1px ink 主線 + 序列 */}
          <div style={{ borderTop: '1px solid var(--cm-ink, #0A0A0A)', padding: '14px 0 12px', marginTop: gi === 0 ? 0 : 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <h3 style={{ ...serif, ...tab, margin: 0, fontSize: 16, color: C.text, letterSpacing: 0 }}>
                {group.date}
              </h3>
              <span style={{ fontSize: 10, color: C.textMute, letterSpacing: '0.12em' }}>
                {group.logs.length} 筆
              </span>
            </div>
          </div>

          {group.logs.map((log, li) => {
            const isBuy = log.action === '買進';
            // §1.3 憲法：買進＝accent（橘）、賣出＝--loss（灰）
            const actionColor = isBuy ? 'var(--cm-accent, #FF4D1F)' : 'var(--cm-loss, #8A857F)';
            return (
              <div
                key={log.id}
                style={{
                  padding: '12px 0',
                  borderBottom: li < group.logs.length - 1
                    ? `1px solid ${alpha(C.textMute, '06')}`
                    : 'none',
                }}
              >
                {/* 動作＋名稱＋時間 / 股數＠價 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 12, color: actionColor, letterSpacing: '0.06em' }}>
                      {log.action}
                    </span>
                    <span style={{ ...serif, fontSize: 15, color: C.text, letterSpacing: 0 }}>{log.name}</span>
                    <span style={{ ...tab, fontSize: 11, color: C.textMute }}>{log.code}</span>
                  </div>
                  <div style={{ ...tab, fontSize: 11, color: C.textMute, whiteSpace: 'nowrap' }}>
                    {log.time || ''}
                  </div>
                </div>
                <div style={{ ...tab, fontSize: 12, color: C.textSec, marginBottom: log.qa.length > 0 ? 10 : 0 }}>
                  {log.qty} 股　@　{log.price?.toLocaleString()} 元
                </div>

                {/* 備忘引文：左髮絲線 + serif */}
                {log.qa.map((qi, i) => {
                  const empty = !qi.a || String(qi.a).trim() === '';
                  return (
                    <div key={i} style={{ marginTop: i === 0 ? 4 : 8 }}>
                      <div style={{ fontSize: 10, color: C.textMute, letterSpacing: '0.10em', marginBottom: 4 }}>
                        {qi.q}
                      </div>
                      <div
                        style={{
                          ...serif,
                          borderLeft: `1px solid ${alpha(C.textMute, '30')}`,
                          paddingLeft: 12,
                          fontSize: 13,
                          lineHeight: 1.9,
                          color: empty ? 'var(--cm-ink-faint, #C7C2BA)' : C.textSec,
                        }}
                      >
                        {empty ? (
                          <>
                            （未留筆記）
                            <a
                              href="#"
                              onClick={(e) => e.preventDefault()}
                              style={{ marginLeft: 8, color: C.textMute, textDecoration: 'none', fontFamily: 'inherit' }}
                            >
                              補寫 →
                            </a>
                          </>
                        ) : (
                          qi.a
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

const LogTab = React.memo(LogTabImpl);
LogTab.displayName = 'LogTab';
export default LogTab;
