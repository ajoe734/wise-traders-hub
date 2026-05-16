import { memo } from "react";

/**
 * HoldingsNoMatchState — 有持倉但被篩選/搜尋過濾掉時的空狀態 + 清除全部篩選 CTA
 * 抽自 HoldingsTab.jsx（B3）。
 */
function HoldingsNoMatchState({ totalCount, WB, onClearAll }) {
  return (
    <div
      className="wb-span-full"
      style={{
        background:'transparent',
        border:`1px dashed ${WB.hair}`,
        borderRadius:4,
        color:WB.ink,
        fontFamily:'inherit',
        display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
        gap:14,
        padding:'48px 24px',
        minHeight:200,
      }}
    >
      <span style={{fontSize:14,fontWeight:500,letterSpacing:'0.06em',color:WB.ink}}>沒有符合條件的持倉</span>
      <span style={{fontSize:12,fontWeight:400,lineHeight:1.7,color:WB.inkMute,textAlign:'center',maxWidth:360}}>
        目前 {totalCount} 檔持倉中沒有符合搜尋與篩選條件的標的，試著放寬條件。
      </span>
      <button
        onClick={onClearAll}
        style={{
          background:'transparent',
          color:WB.ink,
          border:`1px solid ${WB.hairStrong}`,
          borderRadius:2,
          padding:'10px 22px',
          fontFamily:'inherit',
          fontSize:12,
          fontWeight:500,
          letterSpacing:'0.16em',
          cursor:'pointer',
          transition:'background 160ms ease, color 160ms ease',
        }}
        onMouseEnter={(e)=>{e.currentTarget.style.background=WB.ink;e.currentTarget.style.color='#fff';}}
        onMouseLeave={(e)=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=WB.ink;}}
      >
        清除所有篩選
      </button>
    </div>
  );
}

export default memo(HoldingsNoMatchState);
