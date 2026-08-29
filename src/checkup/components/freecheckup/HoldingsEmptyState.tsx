import { memo } from "react";
import "../../styles/holdingsStates.css";

/**
 * HoldingsEmptyState — 零持倉時的 3 步教學 + 上傳成交 CTA
 * 抽自 HoldingsTab.jsx（B2）。
 */
function HoldingsEmptyState({ WB, onUpload }) {
  const steps = [
    {
      n: '1',
      title: '新增成交',
      desc: '上傳券商截圖或手動輸入',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="1.5"/>
          <circle cx="12" cy="12" r="3.2"/>
          <path d="M8 5l1.5-2h5L16 5"/>
        </svg>
      ),
    },
    {
      n: '2',
      title: '辨識或填寫',
      desc: '截圖自動辨識，或逐筆填寫',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M4 12h10M4 17h16"/>
          <circle cx="19" cy="12" r="2"/>
        </svg>
      ),
    },
    {
      n: '3',
      title: '確認更新',
      desc: '逐條檢視後一鍵建立',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4 4 10-10"/>
        </svg>
      ),
    },
  ];

  return (
    <div
      className="wb-span-full holdings-empty-guide"
      style={{
        background:'transparent',
        border:`1px dashed ${WB.hairStrong}`,
        borderRadius:4,
        color:WB.ink,
        fontFamily:'inherit',
        display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
        gap:24,
        padding:'48px 24px',
      }}
    >
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
        <span style={{fontSize:18,fontWeight:500,letterSpacing:'0.08em',color:WB.ink}}>還沒有持倉資料</span>
        <span style={{fontSize:13,fontWeight:400,lineHeight:1.7,color:WB.inkMute,textAlign:'center',maxWidth:420}}>
          可上傳下單 App 的持倉截圖由系統自動辨識，或手動輸入成交，您只需逐條確認即可。
        </span>
      </div>

      <div className="holdings-empty-steps" style={{
        display:'grid',
        gridTemplateColumns:'repeat(3, minmax(0, 1fr))',
        gap:16,
        width:'100%',
        maxWidth:560,
      }}>
        {steps.map((s) => (
          <div key={s.n} style={{
            display:'flex',flexDirection:'column',alignItems:'center',gap:8,
            padding:'16px 8px',
            border:`1px solid ${WB.hair}`,
            borderRadius:4,
            background:'transparent',
          }}>
            <div style={{
              display:'flex',alignItems:'center',justifyContent:'center',
              width:36,height:36,borderRadius:'50%',
              border:`1px solid ${WB.hairStrong}`,
              color:WB.ink,
            }}>
              {s.icon}
            </div>
            <span style={{fontSize:11,fontWeight:500,letterSpacing:'0.18em',color:WB.inkMute}}>
              {/* i18n-allow:visual-decoration 步驟編號裝飾 */}
              STEP {s.n}
            </span>
            <span style={{fontSize:13,fontWeight:500,color:WB.ink,letterSpacing:'0.04em'}}>{s.title}</span>
            <span style={{fontSize:11,fontWeight:400,color:WB.inkMute,textAlign:'center',lineHeight:1.6}}>{s.desc}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onUpload}
        className="holdings-empty-cta"
        style={{
          marginTop:4,
          background:WB.ink,
          color:'#fff',
          border:'none',
          borderRadius:2,
          padding:'14px 28px',
          fontFamily:'inherit',
          fontSize:13,
          fontWeight:500,
          letterSpacing:'0.18em',
          cursor:'pointer',
        }}
      >
        新增成交
      </button>

      <span style={{fontSize:11,fontWeight:400,letterSpacing:'0.12em',color:WB.inkMute}}>
        支援 JPG / PNG 截圖，或切換手動輸入
      </span>
    </div>
  );
}

export default memo(HoldingsEmptyState);
