import { memo } from "react";

// §5 中文化：所有英文欄名對照 handoff §5 表
const SORT_OPTIONS = [
  ['decision', '決策'],
  ['value', '市值'],
  ['pnl', '損益'],
  ['pct', '報酬'],
  ['urgency', '急迫度'],
  ['confidence', '信心'],
  ['updated', '更新'],
];
const SORT_LABEL_MAP = Object.fromEntries(SORT_OPTIONS);

/**
 * HoldingsFooterBar — 卡片牆底部狀態列：HOLDINGS 計數 + SORT BY 下拉 + grid/list 切換
 * 抽自 HoldingsTab.jsx（B4）。
 */
function HoldingsFooterBar({
  sortedCount,
  sortBy, setSortBy, sortDir, setSortDir,
  sortMenuOpen, setSortMenuOpen,
  viewMode, setViewMode,
  WB,
}) {
  const currentSortLabel = SORT_LABEL_MAP[sortBy] || 'PRIORITY';

  return (
    <div style={{
      marginTop:24,paddingTop:14,
      borderTop:`1px solid ${WB.hair}`,
      display:'flex',justifyContent:'space-between',alignItems:'center',
      fontSize:10,color:WB.inkMute,letterSpacing:'0.16em',fontWeight:500,
    }}>
      <span>{sortedCount} HOLDINGS</span>
      <div style={{display:'flex',alignItems:'center',gap:14}}>
        {/* SORT BY 下拉選單 */}
        <div style={{position:'relative'}}>
          <button
            type="button"
            onClick={() => setSortMenuOpen(v => !v)}
            aria-haspopup="listbox"
            aria-expanded={sortMenuOpen}
            aria-label={`依 ${currentSortLabel} 排序，目前為${sortDir === 'desc' ? '降冪' : '升冪'}`}
            style={{
              background:'transparent', border:'none', padding:0, margin:0,
              fontSize:10, color:WB.inkMute, letterSpacing:'0.16em', fontWeight:500,
              cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6,
              fontFamily:'inherit',
            }}
          >
            SORT BY <span style={{color:WB.ink}}>
              {currentSortLabel} {sortMenuOpen ? '▴' : '▾'}
            </span>
          </button>
          {sortMenuOpen && (
            <>
              <div
                onClick={() => setSortMenuOpen(false)}
                style={{position:'fixed', inset:0, zIndex:40}}
              />
              <div style={{
                position:'absolute', bottom:'calc(100% + 6px)', right:0, zIndex:50,
                background:WB.surface, border:`1px solid ${WB.hairStrong}`, borderRadius:0,
                minWidth:140, padding:'6px 0',
              }}>
                {SORT_OPTIONS.map(([k, l]) => {
                  const active = sortBy === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        if (active) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                        else { setSortBy(k); setSortDir('desc'); }
                        setSortMenuOpen(false);
                      }}
                      style={{
                        display:'flex', alignItems:'center', justifyContent:'space-between',
                        width:'100%', padding:'7px 14px', background:'transparent',
                        border:'none', cursor:'pointer', fontFamily:'inherit',
                        fontSize:10, letterSpacing:'0.14em', fontWeight:active?500:400,
                        color: active ? WB.ink : WB.inkMute, textAlign:'left',
                      }}
                    >
                      <span>{l}</span>
                      {active && <span style={{fontSize:9,opacity:0.7}}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <span style={{width:1,height:12,background:WB.hair}}/>
        {/* 檢視模式切換 */}
        <span style={{display:'flex',gap:4}}>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            aria-label="格狀檢視"
            aria-pressed={viewMode === 'grid'}
            style={{
              display:'inline-flex',alignItems:'center',justifyContent:'center',
              width:22,height:22,
              border:`1px solid ${viewMode === 'grid' ? WB.ink : WB.hair}`,
              color: viewMode === 'grid' ? WB.ink : WB.inkLight,
              background:'transparent', padding:0, cursor:'pointer',
              fontSize:10, borderRadius:2, fontFamily:'inherit',
              transition:'all 0.15s',
            }}
          >▦</button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            aria-label="清單檢視"
            aria-pressed={viewMode === 'list'}
            style={{
              display:'inline-flex',alignItems:'center',justifyContent:'center',
              width:22,height:22,
              border:`1px solid ${viewMode === 'list' ? WB.ink : WB.hair}`,
              color: viewMode === 'list' ? WB.ink : WB.inkLight,
              background:'transparent', padding:0, cursor:'pointer',
              fontSize:10, borderRadius:2, fontFamily:'inherit',
              transition:'all 0.15s',
            }}
          >≡</button>
        </span>
      </div>
    </div>
  );
}

export default memo(HoldingsFooterBar);
