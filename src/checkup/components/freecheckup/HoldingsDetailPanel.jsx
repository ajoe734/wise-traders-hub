import React from 'react';

/**
 * HoldingsDetailPanel — Holdings tab 桌面側欄細節面板
 * 抽自 FreeCheckup.jsx renderDetailPanel (L4215-L4431)。
 * 純展示元件，不引入新 state owner；所有狀態與 callback 都靠 props 傳入。
 */
function HoldingsDetailPanelImpl({
  selected,
  decisionsMap = {},
  stockMeta = {},
  targets,
  avgTarget,
  normalizedEvents = [],
  orderedDisplayed = [],
  WB,
  setExpandedDecision,
  openHoldingDrawer,
}) {
  if (!selected) return null;
  const h = selected;
  const dec = decisionsMap[h.code];
  const meta = stockMeta[h.code] || null;
  const T = targets?.[h.code];
  const tp = T && avgTarget ? avgTarget(h.code) : null;
  const upside = tp && h.price ? ((tp - h.price) / h.price * 100) : null;
  const actionLabel = dec?.actionType === 'exit' ? 'EXIT' : dec?.actionType === 'review' ? 'REVIEW' : 'HOLD';
  const pctVal = h.pct ?? 0;
  const urgencyLevel = dec?.urgency === 'now' ? 4 : dec?.urgency === 'soon' ? 3 : dec?.urgency === 'monitor' ? 2 : 1;
  const relatedEvents = (normalizedEvents || [])
    .filter(e => (e.relatedCodes || []).includes(h.code) && e.source !== 'demo')
    .slice(0, 5);

  const visibleList = orderedDisplayed;
  const curIdx = visibleList.findIndex(x => x.code === h.code);
  const prev = curIdx > 0 ? visibleList[curIdx - 1] : null;
  const next = curIdx < visibleList.length - 1 ? visibleList[curIdx + 1] : null;
  const tomorrowEv = relatedEvents[0];

  return (
    <div>
      {/* 頂部 nav: < > × */}
      <div style={{
        display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'12px 16px',borderBottom:`1px solid ${WB.hair}`,
      }}>
        <div style={{display:'flex',gap:4}}>
          <button
            onClick={() => prev && setExpandedDecision(prev.code)}
            disabled={!prev}
            aria-label={prev ? `上一檔：${prev.name || ''} ${prev.code}` : '已經是第一檔'}
            style={{
              width:26,height:26,border:`1px solid ${WB.hair}`,background:'transparent',
              cursor: prev?'pointer':'not-allowed',color: prev?WB.ink:WB.inkLight,
              fontSize:12,borderRadius:2,fontFamily:'inherit',
            }}
          >‹</button>
          <button
            onClick={() => next && setExpandedDecision(next.code)}
            disabled={!next}
            aria-label={next ? `下一檔：${next.name || ''} ${next.code}` : '已經是最後一檔'}
            style={{
              width:26,height:26,border:`1px solid ${WB.hair}`,background:'transparent',
              cursor: next?'pointer':'not-allowed',color: next?WB.ink:WB.inkLight,
              fontSize:12,borderRadius:2,fontFamily:'inherit',
            }}
          >›</button>
        </div>
        <span style={{fontSize:10,color:WB.inkMute,letterSpacing:'0.16em',fontWeight:500}}>
          {String(curIdx+1).padStart(2,'0')} / {String(visibleList.length).padStart(2,'0')}
        </span>
        <button
          onClick={() => setExpandedDecision(null)}
          aria-label="關閉持倉細節"
          style={{
            width:26,height:26,border:`1px solid ${WB.hair}`,background:'transparent',
            cursor:'pointer',color:WB.ink,fontSize:14,borderRadius:2,fontFamily:'inherit',
          }}
        >×</button>
      </div>

      <div style={{padding:'18px 22px 24px'}}>
        {/* Header */}
        <div style={{marginBottom:18}}>
          <div style={{fontSize:9,color:WB.inkLight,letterSpacing:'0.12em',marginBottom:6,fontWeight:500,display:'flex',alignItems:'center',gap:8}}>
            <span>持倉細節</span>
            {/^[03567]\d{5}$/.test(String(h.code || '')) && (
              <span style={{
                fontSize:9,letterSpacing:'0.08em',padding:'1px 6px',borderRadius:2,
                background:`${WB.accent}1A`,color:WB.accent,fontWeight:500,
              }}>權證 · 現價差估算</span>
            )}
          </div>
          <div style={{display:'flex',alignItems:'baseline',gap:8,marginBottom:4}}>
            <span style={{fontSize:11,color:WB.inkMute,fontVariantNumeric:'tabular-nums',letterSpacing:'0.04em'}}>{h.code}</span>
            <span style={{fontSize:18,fontWeight:500,color:WB.ink,letterSpacing:'-0.005em'}}>{h.name}</span>
          </div>
          {(meta?.industry || meta?.strategy) && (
            <div style={{fontSize:11,color:WB.inkMute,letterSpacing:'0.02em'}}>
              {meta?.industry || ''}{meta?.industry && meta?.strategy ? ' · ' : ''}{meta?.strategy || ''}
            </div>
          )}
        </div>

        {/* PnL */}
        <div style={{marginBottom:20,paddingBottom:16,borderBottom:`1px solid ${WB.hair}`}}>
          <div className="wb-card-pnl-num" style={{
            fontSize:48,fontWeight:500,color:WB.ink,
            letterSpacing:'-0.03em',lineHeight:1,
            fontVariantNumeric:'tabular-nums',
          }}>
            {pctVal>=0?'+':''}{pctVal.toFixed(2)}<span className="wb-card-pnl-pct" style={{fontSize:18,opacity:0.55,marginLeft:2}}>%</span>
          </div>
          <div style={{marginTop:8,fontSize:12,color:WB.inkMute,fontVariantNumeric:'tabular-nums',letterSpacing:'0.02em'}}>
            {h.pnl>=0?'+':''}{Math.round(h.pnl||0).toLocaleString()} ・ VALUE {h.value?.toLocaleString() || '—'}
          </div>
        </div>

        {/* DECISION 黑底盒 */}
        <div style={{
          background:WB.ink,color:'#F4F1EC',
          padding:'18px 18px 20px',marginBottom:18,borderRadius:3,
        }}>
          <div style={{fontSize:9,color:'rgba(244,241,236,0.55)',letterSpacing:'0.20em',marginBottom:8,fontWeight:500}}>DECISION</div>
          <div style={{
            fontSize:22,fontWeight:500,color:WB.accent,letterSpacing:'0.04em',
            marginBottom:14,
          }}>{actionLabel}</div>
          <div style={{fontSize:12,color:'#E8E4DD',lineHeight:1.7,marginBottom:6}}>
            {dec?.actionText || (
              actionLabel==='EXIT' ? '建議出場：論點已破裂或重大事件衝擊。' :
              actionLabel==='REVIEW' ? '需要檢查：論點弱化或有未決事件。' :
              '繼續持有：論點完整,無近期催化事件。'
            )}
          </div>
          {dec && (
            <div style={{fontSize:11,color:'rgba(244,241,236,0.65)',lineHeight:1.7,letterSpacing:'0.02em'}}>
              論點 {dec.thesisState==='broken'?'破裂':dec.thesisState==='weakening'?'弱化':'完整'}
              {' · 信心 '}{dec.confidence==='high'?'高':dec.confidence==='medium'?'中':'低'}
              {' · 事件 '}{dec.openEventCount || 0}
            </div>
          )}
        </div>

        {/* URGENCY 五點 */}
        <div style={{marginBottom:18,display:'flex',alignItems:'center',gap:14}}>
          <span style={{fontSize:9,color:WB.inkLight,letterSpacing:'0.12em',fontWeight:500}}>急迫程度</span>
          <div style={{display:'flex',gap:6,flex:1}}>
            {[1,2,3,4,5].map(i => (
              <span key={i} style={{
                width:7,height:7,borderRadius:'50%',
                background: i <= urgencyLevel ? WB.accent : 'transparent',
                border: i <= urgencyLevel ? 'none' : `1px solid ${WB.hairStrong}`,
              }} />
            ))}
          </div>
          <span style={{fontSize:10,color:WB.inkMute,letterSpacing:'0.10em'}}>
            {dec?.urgency==='now'?'NOW':dec?.urgency==='soon'?'SOON':dec?.urgency==='monitor'?'MONITOR':'LOW'}
          </span>
        </div>

        {/* Targets */}
        {tp && (
          <div style={{marginBottom:18}}>
            <div style={{fontSize:9,color:WB.inkLight,letterSpacing:'0.20em',marginBottom:8,fontWeight:500}}>TARGET</div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
              <span style={{fontSize:12,color:WB.inkSub,fontVariantNumeric:'tabular-nums'}}>{tp.toLocaleString()}</span>
              <span style={{fontSize:12,color:WB.accent,fontVariantNumeric:'tabular-nums'}}>
                {upside>=0?'+':''}{upside?.toFixed(1)}%
              </span>
            </div>
            <div style={{background:WB.hair,height:2,width:'100%',overflow:'hidden'}}>
              <div style={{
                width:`${Math.min(Math.max((h.price/tp)*100,0),100)}%`,
                height:'100%',background:WB.accent,opacity:0.8,
              }}/>
            </div>
          </div>
        )}

        {/* EVENT TIMELINE */}
        {relatedEvents.length > 0 && (
          <div style={{marginBottom:18}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
              <span style={{fontSize:9,color:WB.inkLight,letterSpacing:'0.12em',fontWeight:500}}>事件時程</span>
              {tomorrowEv && (
                <span style={{
                  fontSize:9,color:WB.surface,background:WB.accent,
                  padding:'2px 7px',letterSpacing:'0.16em',fontWeight:500,borderRadius:2,
                }}>TOMORROW</span>
              )}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {relatedEvents.map((e, idx) => (
                <div key={e.id || idx} style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                  <span style={{
                    marginTop:6,width:5,height:5,borderRadius:'50%',
                    background: idx===0 ? WB.accent : WB.hairStrong,flexShrink:0,
                  }} />
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:WB.inkSub,fontWeight:400,lineHeight:1.5}}>
                      {e.summary || e.title || '(無摘要)'}
                    </div>
                    <div style={{fontSize:10,color:WB.inkLight,marginTop:2,letterSpacing:'0.04em'}}>
                      {e.source==='user'?'手動':e.source==='ai'?'AI':e.source==='calendar'?'日曆':'其他'}
                      {e.date ? ` · ${e.date}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 研究筆記入口（持倉數量/成本只能透過上傳成交修改） */}
        <div style={{
          paddingTop:14,marginTop:6,borderTop:`1px solid ${WB.hair}`,
        }}>
          <button
            onClick={() => openHoldingDrawer && openHoldingDrawer(h.code)}
            style={{
              width:'100%',padding:'12px',background:'transparent',
              border:`1px solid ${WB.hair}`,borderRadius:2,
              color:WB.inkSub,fontSize:12,fontWeight:400,cursor:'pointer',
              letterSpacing:'0.08em',fontFamily:'inherit',
            }}
            title="開啟研究筆記與決策紀錄。持倉數量與成本請透過「上傳成交」修改。"
          >研究筆記</button>
        </div>
      </div>
    </div>
  );
}

const HoldingsDetailPanel = React.memo(HoldingsDetailPanelImpl);
export default HoldingsDetailPanel;
