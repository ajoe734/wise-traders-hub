// HoldingsReversalSection — 抽自 FreeCheckup.jsx (原 details @ L3637-L3727)。
// 行為對等：列出虧損持股、可展開設定反轉條件並儲存。
// P3-perf 改動：移除 document.getElementById('rv-*') uncontrolled pattern，改 controlled
// useState（每列自己一個 ReversalRow，draft 隨打字 setState；行為等價，但避免 DOM probe）。
import { memo, useState, useEffect } from 'react';
import { validateProps } from '@/checkup/lib/validateProps.js';

const SCHEMA = {
  losers: 'array',
  reversalConditions: { type: 'object', optional: true },
  reviewingEvent: { type: 'string', optional: true },
  setReviewingEvent: 'function',
  updateReversal: 'function',
  C: 'object',
  alpha: 'function',
};

function ReversalRow({ holding: h, rc, editing, setEditing, updateReversal, C, alpha }) {
  const [draft, setDraft] = useState(() => rc || { signal: '', target: '', stopLoss: '', note: '' });

  // 切換為 editing 時，每次重置 draft 為最新 rc（避免下次展開帶舊 buffer）
  useEffect(() => {
    if (editing) setDraft(rc || { signal: '', target: '', stopLoss: '', note: '' });
  }, [editing, rc]);

  const inputStyle = {
    width: '100%', background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 6, padding: '6px 8px', color: C.text, fontSize: 13, outline: 'none', fontFamily: 'inherit',
  };
  const labelStyle = { fontSize: 12, color: C.textMute, marginBottom: 2 };

  return (
    <div style={{ marginTop: 8, padding: '8px 0', borderBottom: `1px solid ${alpha(C.textMute, '06')}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 400, color: C.text }}>{h.name}</span>
          <span style={{ fontSize: 12, color: C.down, marginLeft: 6 }}>{h.pct}%</span>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          style={{
            padding: '3px 9px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
            background: 'transparent', border: `1px solid ${C.border}`, color: C.textMute,
          }}
        >
          {rc ? '查看條件' : '設定反轉條件'}
        </button>
      </div>
      {rc && !editing && (
        <div style={{ fontSize: 12, color: C.textSec, marginTop: 4, lineHeight: 1.7 }}>
          反轉訊號：{rc.signal} | 目標：{rc.target} | 停損：{rc.stopLoss}
        </div>
      )}
      {editing && (
        <div style={{ marginTop: 8, background: C.subtle, borderRadius: 7, padding: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
            <div>
              <div style={labelStyle}>反轉目標價</div>
              <input value={draft.target} onChange={(e) => setDraft((d) => ({ ...d, target: e.target.value }))} placeholder="如 130" style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>停損價</div>
              <input value={draft.stopLoss} onChange={(e) => setDraft((d) => ({ ...d, stopLoss: e.target.value }))} placeholder="如 85" style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 6 }}>
            <div style={labelStyle}>反轉訊號（什麼條件出現代表反轉？）</div>
            <input value={draft.signal} onChange={(e) => setDraft((d) => ({ ...d, signal: e.target.value }))} placeholder="如：月營收連續兩月成長、法人轉買超" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={labelStyle}>備註</div>
            <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="其他觀察..." style={inputStyle} />
          </div>
          <button
            onClick={() => {
              updateReversal(h.code, {
                signal: draft.signal,
                target: draft.target,
                stopLoss: draft.stopLoss,
                note: draft.note,
              });
              setEditing(false);
            }}
            style={{
              width: '100%', padding: '8px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textSec, fontSize: 13, fontWeight: 400, cursor: 'pointer',
            }}
          >
            儲存反轉條件
          </button>
        </div>
      )}
    </div>
  );
}

function HoldingsReversalSectionImpl(props) {
  validateProps('HoldingsReversalSection', props, SCHEMA);
  const { losers, reversalConditions, reviewingEvent, setReviewingEvent, updateReversal, C, alpha } = props;

  if (!losers || losers.length === 0) return null;

  return (
    <details style={{ marginBottom: 14 }}>
      <summary style={{
        cursor: 'pointer', listStyle: 'none',
        fontSize: 11, color: C.textMute, fontWeight: 400, letterSpacing: '0.06em',
        padding: '6px 0', display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: C.down }} />
        反轉追蹤 · {losers.length} 檔虧損持股
        <span style={{ opacity: 0.5, marginLeft: 2 }}>展開設定</span>
      </summary>
      <div style={{ paddingLeft: 12, marginTop: 6 }}>
        {losers.map((h) => {
          const rc = (reversalConditions || {})[h.code];
          const editing = reviewingEvent === `rev-${h.code}`;
          const setEditing = (v) => setReviewingEvent(v ? `rev-${h.code}` : null);
          return (
            <ReversalRow
              key={h.code}
              holding={h}
              rc={rc}
              editing={editing}
              setEditing={setEditing}
              updateReversal={updateReversal}
              C={C}
              alpha={alpha}
            />
          );
        })}
      </div>
    </details>
  );
}

const HoldingsReversalSection = memo(HoldingsReversalSectionImpl);
HoldingsReversalSection.displayName = 'HoldingsReversalSection';
export default HoldingsReversalSection;
