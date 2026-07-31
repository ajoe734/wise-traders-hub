// HoldingsFilterBar — 抽自 FreeCheckup.jsx (原 IIFE @ L3739-L3858)。
// 行為對等：搜尋框 + 折疊式 Filter chips + Active tags + 計數器。
// React.memo 保護：父層每秒 quote tick 不會 re-render filter bar，但 Set props 變動時仍會更新。
// @analytics-required: checkup_holdings_filter_change
import { memo } from 'react';
import { validateProps } from '@/checkup/lib/validateProps.js';
import { track } from '@/lib/analytics/events';

// Bug B7 fix：原本的 `trackFilter` helper 未被任何呼叫者使用，且與下方 inline 版本邏輯重複。
// 已移除，避免維護誤用；analytics 一律走 FilterGroup 內的 inline 版（見下方修正）。

const SCHEMA = {
  totalCount: 'number',
  filteredCount: 'number',
  searchQ: 'string',
  setSearchQ: 'function',
  filterDecision: 'object',
  setFilterDecision: 'function',
  filterThesis: 'object',
  setFilterThesis: 'function',
  filterUrgency: 'object',
  setFilterUrgency: 'function',
  filterConflict: 'object',
  setFilterConflict: 'function',
  filterPnl: 'object',
  setFilterPnl: 'function',
  filterStrategy: 'object',
  setFilterStrategy: 'function',
  strategyOptions: 'array',
  toggleSetItem: 'function',
  clearAllFilters: 'function',
  C: 'object',
  alpha: 'function',
};

const DEC_LABEL = { hold: '持有', review: '檢查', exit: '出場' };
const TH_LABEL  = { intact: '完整', weakening: '弱化', broken: '破裂' };
const UR_LABEL  = { now: '立即', soon: '近期', monitor: '觀察' };
const CF_LABEL  = { conflict: '有衝突', no_conflict: '無衝突' };
const PNL_LABEL = { win: '獲利', loss: '虧損', flat: '平盤' };

const DEC_OPTS = [['hold', '持有'], ['review', '檢查'], ['exit', '出場']];
const TH_OPTS  = [['intact', '完整'], ['weakening', '弱化'], ['broken', '破裂']];
const UR_OPTS  = [['now', '立即'], ['soon', '近期'], ['monitor', '觀察']];
const CF_OPTS  = [['conflict', '有衝突'], ['no_conflict', '無衝突']];
const PNL_OPTS = [['win', '獲利'], ['loss', '虧損'], ['flat', '平盤']];

function chipBtn(active, onClick, label, key, C, alpha) {
  return (
    <button key={key} onClick={onClick} style={{
      background: active ? alpha(C.text, '12') : 'transparent',
      color: active ? C.text : C.textMute,
      border: `1px solid ${active ? alpha(C.text, '20') : C.border}`,
      borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 400,
      cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.02em',
    }}>{label}</button>
  );
}

function FilterGroup({ label, dimension, options, set, setter, toggleSetItem, C, alpha }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, color: C.textMute, letterSpacing: '0.08em', fontWeight: 400, minWidth: 36 }}>{label}</span>
      {options.map(([val, l]) =>
        chipBtn(set.has(val), () => {
          // Bug B7 fix：先算 action 再 toggle，避免 setter 執行後 set 的 snapshot 與 action 不一致
          const action = set.has(val) ? 'remove' : 'add';
          toggleSetItem(setter)(val);
          try {
            track('checkup_holdings_filter_change', {
              dimension, value: String(val), action,
            });
          } catch {}
        }, l, val, C, alpha)
      )}
    </div>
  );
}

function HoldingsFilterBarImpl(props) {
  validateProps('HoldingsFilterBar', props, SCHEMA);
  const {
    totalCount, filteredCount,
    searchQ, setSearchQ,
    filterDecision, setFilterDecision,
    filterThesis, setFilterThesis,
    filterUrgency, setFilterUrgency,
    filterConflict, setFilterConflict,
    filterPnl, setFilterPnl,
    filterStrategy, setFilterStrategy,
    strategyOptions, toggleSetItem, clearAllFilters,
    C, alpha,
  } = props;

  const activeTags = [];
  if (searchQ.trim()) activeTags.push({ key: 'q', label: `搜尋："${searchQ.trim()}"`, clear: () => setSearchQ('') });
  filterDecision.forEach((v) => activeTags.push({ key: `d-${v}`, label: `決策：${DEC_LABEL[v] || v}`, clear: () => toggleSetItem(setFilterDecision)(v) }));
  filterThesis.forEach((v) => activeTags.push({ key: `t-${v}`, label: `論點：${TH_LABEL[v] || v}`, clear: () => toggleSetItem(setFilterThesis)(v) }));
  filterUrgency.forEach((v) => activeTags.push({ key: `u-${v}`, label: `緊急：${UR_LABEL[v] || v}`, clear: () => toggleSetItem(setFilterUrgency)(v) }));
  filterConflict.forEach((v) => activeTags.push({ key: `c-${v}`, label: CF_LABEL[v] || v, clear: () => toggleSetItem(setFilterConflict)(v) }));
  filterPnl.forEach((v) => activeTags.push({ key: `p-${v}`, label: `損益：${PNL_LABEL[v] || v}`, clear: () => toggleSetItem(setFilterPnl)(v) }));
  filterStrategy.forEach((v) => activeTags.push({ key: `s-${v}`, label: `題材：${v}`, clear: () => toggleSetItem(setFilterStrategy)(v) }));

  return (
    <div id="holdings-filter-bar" style={{
      marginBottom: 14, padding: '10px 12px',
      background: alpha(C.textMute, '04'),
      border: `1px solid ${alpha(C.textMute, '10')}`,
      borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10,
      position: 'sticky', top: 0, zIndex: 5,
    }}>
      {/* 搜尋框 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text" value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="搜尋代碼／名稱／題材／策略"
            style={{
              width: '100%', padding: '7px 28px 7px 10px',
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 6, fontSize: 12, color: C.text,
              outline: 'none', fontFamily: 'inherit',
            }}
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', color: C.textMute, fontSize: 14, cursor: 'pointer', lineHeight: 1, padding: 0,
            }}>✕</button>
          )}
        </div>
      </div>

      {/* Filter chips（預設折疊） */}
      <details>
        <summary style={{
          cursor: 'pointer', listStyle: 'none',
          fontSize: 10, color: C.textMute, fontWeight: 400, letterSpacing: '0.10em',
          textTransform: 'uppercase', padding: '2px 0',
        }}>
          Filters {activeTags.length > 0 ? `(${activeTags.length})` : ''} <span style={{ opacity: 0.5, marginLeft: 4 }}>▾</span>
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <FilterGroup label="決策" dimension="decision" options={DEC_OPTS} set={filterDecision} setter={setFilterDecision} toggleSetItem={toggleSetItem} C={C} alpha={alpha} />
          <FilterGroup label="論點" dimension="thesis" options={TH_OPTS} set={filterThesis} setter={setFilterThesis} toggleSetItem={toggleSetItem} C={C} alpha={alpha} />
          <FilterGroup label="緊急" dimension="urgency" options={UR_OPTS} set={filterUrgency} setter={setFilterUrgency} toggleSetItem={toggleSetItem} C={C} alpha={alpha} />
          <FilterGroup label="衝突" dimension="conflict" options={CF_OPTS} set={filterConflict} setter={setFilterConflict} toggleSetItem={toggleSetItem} C={C} alpha={alpha} />
          <FilterGroup label="損益" dimension="pnl" options={PNL_OPTS} set={filterPnl} setter={setFilterPnl} toggleSetItem={toggleSetItem} C={C} alpha={alpha} />
          {strategyOptions.length > 0 && (
            <FilterGroup label="題材" dimension="strategy" options={strategyOptions.map((s) => [s, s])} set={filterStrategy} setter={setFilterStrategy} toggleSetItem={toggleSetItem} C={C} alpha={alpha} />
          )}
        </div>
      </details>

      {/* Active tags + counter */}
      {activeTags.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', borderTop: `1px dashed ${alpha(C.textMute, '15')}`, paddingTop: 8 }}>
          {activeTags.map((t) => (
            <span key={t.key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: alpha(C.text, '08'), color: C.textSec,
              padding: '2px 4px 2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 400,
            }}>
              {t.label}
              <button onClick={t.clear} style={{ background: 'transparent', border: 'none', color: C.textMute, cursor: 'pointer', padding: '0 4px', fontSize: 12, lineHeight: 1 }}>✕</button>
            </span>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: C.textMute, fontWeight: 400 }}>
            已篩選 {filteredCount} / {totalCount} 檔
          </span>
          <button onClick={clearAllFilters} style={{
            background: 'transparent', border: 'none', color: C.textMute, fontSize: 11, cursor: 'pointer',
            textDecoration: 'underline', fontWeight: 400,
          }}>清除全部</button>
        </div>
      )}
      {activeTags.length === 0 && (
        <div style={{ fontSize: 11, color: C.textMute, textAlign: 'right', fontWeight: 400 }}>
          共 {totalCount} 檔
        </div>
      )}
    </div>
  );
}

const HoldingsFilterBar = memo(HoldingsFilterBarImpl);
HoldingsFilterBar.displayName = 'HoldingsFilterBar';
export default HoldingsFilterBar;
