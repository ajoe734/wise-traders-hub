import React from 'react';

/**
 * LogTab — Free Checkup「交易記錄」tab。
 * 抽自 FreeCheckup.jsx L3984-L4078（純展示，無內部 state）。
 * Allowed by inline-rendering constitution as a tab-container-level component
 * (Phase A2-4, 2026-05). Pure display, all data via props, no `<style>` strings,
 * does not touch Hero / .wb-card.
 */
function LogTabImpl({
  isDemo,
  tradeLog,
  C, alpha, card,
  DEMO_TAB_NOTICE_COPY,
  startLineLogin,
  navigate,
}) {
  return (
    <>
      {isDemo && (
        <div style={{marginBottom:12,padding:"12px 14px",background:alpha(C.amber,'06'),border:`1px solid ${alpha(C.amber,'25')}`,borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:4,letterSpacing:"0.02em"}}>{DEMO_TAB_NOTICE_COPY.log.title}</div>
          <div style={{fontSize:11,color:C.textMute,lineHeight:1.7,marginBottom:8}}>{DEMO_TAB_NOTICE_COPY.log.body}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={() => { try { startLineLogin?.(); } catch { navigate('/auth/login?redirect=/checkup'); } }} style={{background:"#06C755",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:500,cursor:"pointer",letterSpacing:"0.02em"}}>LINE 登入解鎖</button>
            <button onClick={() => navigate('/auth/login?redirect=/checkup')} style={{background:"transparent",color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:400,cursor:"pointer",letterSpacing:"0.02em"}}>Email 登入</button>
          </div>
        </div>
      )}
      {(!tradeLog||tradeLog.length===0) ? (
        <div style={{...card,textAlign:"center",padding:"36px 16px"}}>
          <div style={{fontSize:20,marginBottom:10,opacity:0.2}}>◌</div>
          <div style={{fontSize:15,color:C.textMute,fontWeight:400}}>
            還沒有交易記錄<br/>
            <span style={{fontSize:13}}>上傳成交截圖後自動記錄在這裡</span>
          </div>
        </div>
      ) : (
        (() => {
          const sorted = [...(tradeLog||[])];
          const dateGroups = [];
          let currentGroup = null;
          sorted.forEach(log => {
            const d = log.date || "未知日期";
            if (!currentGroup || currentGroup.date !== d) {
              currentGroup = { date: d, logs: [] };
              dateGroups.push(currentGroup);
            }
            currentGroup.logs.push(log);
          });
          return dateGroups.map((group, gi) => (
            <div key={"grp-"+gi}>
              <div style={{fontSize:12,fontWeight:400,color:C.textMute,letterSpacing:"0.08em",marginBottom:8,marginTop:gi===0?0:6}}>
                {group.date}
              </div>
              {(() => {
                const timeGroups = [];
                let curTime = null;
                group.logs.forEach(log => {
                  if (!curTime || log.time !== curTime.time) {
                    curTime = { time: log.time, items: [] };
                    timeGroups.push(curTime);
                  }
                  curTime.items.push(log);
                });
                return timeGroups.map((tg, ti) => (
                  <div key={"tg-"+ti}>
                    {tg.items.map((log, li) => (
                      <div key={log.id} style={{marginBottom:0,padding:"10px 0",
                        borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                          <div style={{display:"flex",alignItems:"center",gap:7}}>
                            <span style={{
                              color: log.action==="買進" ? C.up : C.down,
                              fontSize:11, fontWeight:400}}>
                              {log.action}
                            </span>
                            <span style={{fontSize:13,fontWeight:500,color:C.text}}>{log.name}</span>
                            <span style={{fontSize:10,color:C.textMute}}>{log.code}</span>
                          </div>
                          {li === 0 && <div style={{fontSize:12,color:C.textMute}}>{log.time}</div>}
                        </div>
                        <div style={{fontSize:13,color:C.textMute,marginBottom: log.qa.length > 0 ? 10 : 0}}>
                          {log.qty}股 @ {log.price?.toLocaleString()}元
                        </div>
                        {log.qa.map((qi,i)=>(
                          <div key={i} style={{marginBottom:8}}>
                            <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>{qi.q}</div>
                            <div style={{fontSize:13,color:C.textSec,background:C.subtle,
                              borderRadius:6,padding:"7px 10px",lineHeight:1.7}}>
                              {qi.a||"（未填）"}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    {ti < timeGroups.length - 1 && (
                      <div style={{height:1,background:C.border,margin:"10px 0"}}/>
                    )}
                  </div>
                ));
              })()}
              {gi < dateGroups.length - 1 && (
                <div style={{height:1,background:C.border,margin:"10px 0 14px"}}/>
              )}
            </div>
          ));
        })()
      )}
    </>
  );
}

const LogTab = React.memo(LogTabImpl);
export default LogTab;
