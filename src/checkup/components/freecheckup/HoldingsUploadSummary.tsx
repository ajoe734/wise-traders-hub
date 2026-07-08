import { memo } from "react";

/**
 * HoldingsUploadSummary — 上傳成交回來後顯示的新增/更新摘要橫幅
 * 抽自 HoldingsTab.jsx（B1）。純展示，不含邏輯。
 */
function HoldingsUploadSummary({ uploadSummary, setUploadSummary, C, alpha }) {
  if (!uploadSummary) return null;
  const total = uploadSummary.added.length + uploadSummary.updated.length;
  if (total === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginBottom: 14,
        padding: "12px 14px",
        border: `1px solid ${alpha(C.amber, '55')}`,
        background: alpha(C.amber, '10'),
        borderRadius: 8,
        fontFamily: "inherit",
      }}
    >
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6,gap:12}}>
        <div style={{fontSize:13,fontWeight:500,color:C.text,letterSpacing:"0.04em"}}>
          上傳成功 · 新增 {uploadSummary.added.length}・更新 {uploadSummary.updated.length}
          {uploadSummary.corrected ? "（已套用修正）" : ""}
        </div>
        <button
          onClick={() => setUploadSummary(null)}
          aria-label="關閉摘要"
          style={{background:"transparent",border:"none",color:C.textMute,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}
        >關閉</button>
      </div>
      {uploadSummary.added.length > 0 && (
        <div style={{fontSize:12,color:C.textSec,marginBottom:4,lineHeight:1.7}}>
          <span style={{color:C.textMute,marginRight:6}}>新增</span>
          {uploadSummary.added.map((it, i) => (
            <span key={it.code || `a-${i}`} style={{marginRight:10}}>
              {it.name || it.code} <span style={{color:C.textMute}}>·{it.code}</span> {it.qty}股
            </span>
          ))}
        </div>
      )}
      {uploadSummary.updated.length > 0 && (
        <div style={{fontSize:12,color:C.textSec,lineHeight:1.7}}>
          <span style={{color:C.textMute,marginRight:6}}>更新</span>
          {uploadSummary.updated.map((it, i) => (
            <span key={`u-${i}`} style={{marginRight:10}}>
              {it.name || it.code} <span style={{color:C.textMute}}>·{it.code}</span> {it.action} {it.qty}股
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(HoldingsUploadSummary);
