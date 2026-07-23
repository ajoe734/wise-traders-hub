// HoldingsActionPriority — Monocle 改版（2026-07-15）：從單行 inline 文字流 → 「今日待辦」節區。
// 版面：serif 節標「今日待辦」+ 件數；每列 44px 徽章 + 名稱 + 一句原因 + 報酬率 + 「決策書 →」。
// 列出全部 exit/review（不截斷）；尾行「其餘 N 檔維持持有——今天不需要動作。」（N 從 props 帶入）。
// 點列 → onPick(code)（保留原 setExpandedDecision 進入點）。
// 沿用既有 items schema：[{ code, name, tag, desc, pct }]（tag=EXIT|REVIEW|WATCH）；WB prop 保留但不使用。
import React from 'react';
import SectionRule from './_ui/SectionRule';
import ActionBadge from './_ui/ActionBadge';
import { fmtSigned } from '@/checkup/lib/checkupFormat';

function HoldingsActionPriorityImpl({
  items = [],
  decisionsMap,
  stockMeta,
  holdCount = 0,
  WB, // eslint-disable-line no-unused-vars
  onPick,
}) {
  // items 由 useHoldingsDerivations 預先組裝：已限定 tag ∈ {EXIT, REVIEW}、最多 3 檔、含 desc。
  // 舊版 fallback（從 decisionsMap/stockMeta 就地推導）已下線 —— 分組計算必須集中在 hook 內以確保守恒。
  const actionable = (items || []).filter((it) => it.tag === 'EXIT' || it.tag === 'REVIEW');

  if (actionable.length === 0) {
    return (
      <section aria-label="今日待辦" style={{ marginBottom: 22 }}>
        <SectionRule title="今日待辦" meta="0 件" />
        <p style={{
          margin: '4px 0 0',
          fontSize: 13,
          color: 'var(--cm-ink-sec)',
          lineHeight: 1.7,
          letterSpacing: '0.01em',
        }}>
          {holdCount > 0
            ? `全部 ${holdCount} 檔維持持有——今天不需要動作。`
            : '尚無持倉。上傳成交後這裡會列出當日待辦。'}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="今日待辦" style={{ marginBottom: 22 }}>
      <SectionRule title="今日待辦" meta={`${actionable.length} 件`} />
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          borderTop: '1px solid var(--cm-hair)',
        }}
      >
        {actionable.map((it) => {
          const kind = it.tag === 'EXIT' ? 'exit' : 'review';
          const pct = it.pct ?? 0;
          return (
            <li key={it.code} style={{ borderBottom: '1px solid var(--cm-hair)' }}>
              <button
                type="button"
                data-testid={`checkup-today-todo-${it.code}`}
                onClick={() => onPick && onPick(it.code)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  padding: '14px 4px',
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  alignItems: 'baseline',
                  gap: 14,
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <ActionBadge kind={kind} />
                <span style={{ minWidth: 0 }}>
                  <span style={{
                    display: 'block',
                    fontSize: 14,
                    color: 'var(--cm-ink)',
                    fontWeight: 500,
                    letterSpacing: '0.01em',
                  }}>
                    <span className="cm-num" style={{ color: 'var(--cm-ink-sub)', marginRight: 8 }}>
                      {it.code}
                    </span>
                    {it.name}
                  </span>
                  <span style={{
                    display: 'block',
                    marginTop: 3,
                    fontSize: 12,
                    color: 'var(--cm-ink-sec)',
                    letterSpacing: '0.01em',
                    lineHeight: 1.55,
                  }}>
                    {it.desc}
                  </span>
                </span>
                <span
                  className="cm-num"
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: pct >= 0 ? 'var(--cm-accent)' : 'var(--cm-loss)',
                    letterSpacing: '-0.005em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {fmtSigned(pct, 1)}%
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--cm-ink-mute)',
                    letterSpacing: '0.08em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  決策書 →
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {holdCount > 0 && (
        <p style={{
          margin: '10px 0 0',
          fontSize: 12,
          color: 'var(--cm-ink-mute)',
          lineHeight: 1.7,
          letterSpacing: '0.02em',
        }}>
          其餘 {holdCount} 檔維持持有——今天不需要動作。
        </p>
      )}
    </section>
  );
}

const HoldingsActionPriority = React.memo(HoldingsActionPriorityImpl);
export default HoldingsActionPriority;
