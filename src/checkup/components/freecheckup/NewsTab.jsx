import React from 'react';
import { NewsEventRow } from './NewsEventRow';

/**
 * NewsTab — Free Checkup「新聞分析」tab。
 * 抽自 FreeCheckup.jsx L6287-L6524（純展示，無內部 state）。
 * 行為與原 inline JSX 完全一致；callbacks 都靠 props 傳入。
 */
function NewsTabImpl({
  // 模式
  isDemo,
  // 資料
  newsEvents,
  predictingEvents,
  // 樣式
  C, alpha, card, lbl,
  DEMO_TAB_NOTICE_COPY,
  // 新增事件
  showAddEvent, setShowAddEvent,
  newEvent, setNewEvent,
  addEvent,
  coerceStocksString,
  toast,
  // News rows
  expandedNews,
  reviewingEvent,
  reviewForm,
  stableToggleNews,
  stableStartReview,
  stableCancelReview,
  stableChangeReview,
  stableSubmitReview,
  // 摺疊
  newsVerifyingExpanded, setNewsVerifyingExpanded,
  newsPendingExpanded, setNewsPendingExpanded,
  newsPastExpanded, setNewsPastExpanded,
  // 導頁
  startLineLogin,
  navigate,
}) {
  const NE = newsEvents || [];
  const past      = NE.filter(e=>e.status==="past").sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const verifying = NE.filter(e=>e.status==="verifying").sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const pending   = NE.filter(e=>e.status==="pending").sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const hits    = NE.filter(e=>e.correct===true).length;
  const misses  = NE.filter(e=>e.correct===false).length;

  // 每隔一個卡片用不同底色，保持莫蘭迪跳色感
  const tints = [C.card, C.cardBlue, C.cardAmber, C.cardOlive, C.cardRose];
  const tint  = (i) => tints[i % tints.length];

  const renderRow = (e, i) => (
    <NewsEventRow
      key={e.id}
      e={e}
      idx={i}
      tintBg={tint(i)}
      open={expandedNews.has(e.id)}
      isReviewing={reviewingEvent === e.id}
      reviewForm={reviewingEvent === e.id ? reviewForm : undefined}
      onToggle={stableToggleNews}
      onStartReview={stableStartReview}
      onCancelReview={stableCancelReview}
      onChangeReview={stableChangeReview}
      onSubmitReview={stableSubmitReview}
    />
  );

  return (
    <>
      {isDemo && (
        <div style={{marginBottom:12,padding:"12px 14px",background:alpha(C.amber,'06'),border:`1px solid ${alpha(C.amber,'25')}`,borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:4,letterSpacing:"0.02em"}}>{DEMO_TAB_NOTICE_COPY.news.title}</div>
          <div style={{fontSize:11,color:C.textMute,lineHeight:1.7,marginBottom:8}}>{DEMO_TAB_NOTICE_COPY.news.body}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={() => { try { startLineLogin?.(); } catch { navigate('/auth/login?redirect=/checkup'); } }} style={{background:"#06C755",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:500,cursor:"pointer",letterSpacing:"0.02em"}}>LINE 登入解鎖</button>
            <button onClick={() => navigate('/auth/login?redirect=/checkup')} style={{background:"transparent",color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:400,cursor:"pointer",letterSpacing:"0.02em"}}>Email 登入</button>
          </div>
        </div>
      )}

      {/* 準確率摘要 */}
      <div style={{
        display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:14,
      }}>
        {[
          ["已驗證", `${hits+misses}`, C.textSec, C.card],
          ["預測正確", `${hits}`, C.up, C.cardRose],
          ["命中率", hits+misses>0?`${Math.round(hits/(hits+misses)*100)}%`:"—", C.amber, C.cardAmber],
        ].map(([l,v,c,bg])=>(
          <div key={l} style={{background:bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 11px"}}>
            <div style={{fontSize:12,color:C.textMute,letterSpacing:"0.06em"}}>{l}</div>
            <div style={{fontSize:18,fontWeight:500,color:c,marginTop:4}}>{v}</div>
          </div>
        ))}
      </div>

      {/* 新增事件按鈕 */}
      <button onClick={()=>setShowAddEvent(!showAddEvent)} style={{
        width:"100%",padding:"10px",marginBottom:10,borderRadius:8,
        background:showAddEvent?C.subtle:alpha(C.blue,'22'),
        border:`1px solid ${showAddEvent?C.border:alpha(C.blue,'55')}`,
        color:showAddEvent?C.textMute:C.blue,fontSize:13,fontWeight:500,cursor:"pointer"}}>
        {showAddEvent?"取消":"＋ 新增事件（法說會、財報、營收、催化劑）"}
      </button>

      {showAddEvent && (
        <div style={{...card,marginBottom:12,borderLeft:`2px solid ${alpha(C.blue,'88')}`}}>
          <div style={{...lbl,color:C.blue}}>新增事件</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}>
            <div>
              <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>日期</div>
              <input value={newEvent.date} onChange={e=>setNewEvent(p=>({...p,date:e.target.value}))}
                placeholder="如 2026/04/01"
                style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                  borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
            </div>
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                <div style={{fontSize:12,color:C.textMute}}>相關個股（頓號 / 逗號分隔）</div>
                {(() => {
                  const { value: previewStr, changed } = coerceStocksString(newEvent.stocks || "");
                  if (!previewStr || !changed) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setNewEvent(p => ({ ...p, stocks: previewStr }));
                        toast.success("已套用標準化", { description: previewStr, duration: 3000 });
                      }}
                      style={{
                        background:"transparent",border:`1px solid ${alpha(C.blue,'66')}`,
                        color:C.blue,fontSize:11,padding:"2px 8px",borderRadius:5,
                        cursor:"pointer",fontFamily:"inherit",
                      }}
                      title={`預覽：${previewStr}`}
                    >
                      預覽修正 → {previewStr.length > 22 ? previewStr.slice(0,22)+"…" : previewStr}
                    </button>
                  );
                })()}
              </div>
              <input value={newEvent.stocks}
                onChange={e=>setNewEvent(p=>({...p,stocks:e.target.value}))}
                onBlur={() => {
                  const { value: norm, changed } = coerceStocksString(newEvent.stocks || "");
                  if (changed) setNewEvent(p => ({ ...p, stocks: norm }));
                }}
                data-edge-field="stocks"
                ref={(el)=>{ if(typeof window!=='undefined'){ window.__edgeFieldApply=window.__edgeFieldApply||{}; if(el){ window.__edgeFieldApply.stocks=(v)=>setNewEvent(p=>({...p,stocks:String(v)})) } } }}
                placeholder="如 2330 台積電、2317 鴻海（離開欄位會自動標準化）"
                style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                  borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
            </div>
          </div>
          <div style={{marginBottom:7}}>
            <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>事件標題</div>
            <input value={newEvent.title} onChange={e=>setNewEvent(p=>({...p,title:e.target.value}))}
              placeholder="如：台燿 Q1 財報法說會"
              style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
          </div>
          <div style={{marginBottom:7}}>
            <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>事件細節</div>
            <textarea value={newEvent.detail} onChange={e=>setNewEvent(p=>({...p,detail:e.target.value}))}
              placeholder="關鍵觀察重點..."
              style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                borderRadius:7,padding:8,color:C.text,fontSize:13,resize:"none",
                minHeight:50,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
          </div>
          <div style={{marginBottom:7}}>
            <div style={{fontSize:12,color:C.textMute,marginBottom:4}}>預測方向</div>
            <div style={{display:"flex",gap:6}}>
              {["up","down","neutral"].map(v=>(
                <button key={v} onClick={()=>setNewEvent(p=>({...p,pred:v}))}
                  style={{flex:1,padding:"6px",borderRadius:6,fontSize:12,fontWeight:500,cursor:"pointer",
                    background:newEvent.pred===v?(v==="up"?C.upBg:v==="down"?C.downBg:C.subtle):"transparent",
                    color:newEvent.pred===v?(v==="up"?C.up:v==="down"?C.down:C.textSec):C.textMute,
                    border:`1px solid ${newEvent.pred===v?(v==="up"?alpha(C.up,'55'):v==="down"?alpha(C.down,'55'):C.border):C.border}`}}>
                  {v==="up"?"↑ 看漲":v==="down"?"↓ 看跌":"— 中性"}
                </button>
              ))}
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>預測邏輯</div>
            <textarea value={newEvent.predReason} onChange={e=>setNewEvent(p=>({...p,predReason:e.target.value}))}
              placeholder="為什麼這樣預測？依據是什麼？"
              style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                borderRadius:7,padding:8,color:C.text,fontSize:13,resize:"none",
                minHeight:50,outline:"none",fontFamily:"inherit",lineHeight:1.7}}/>
          </div>
          <button onClick={addEvent}
            disabled={!newEvent.title.trim()||!newEvent.date.trim()}
            style={{width:"100%",padding:"10px",borderRadius:8,border:"none",fontSize:14,
              fontWeight:500,cursor:newEvent.title.trim()&&newEvent.date.trim()?"pointer":"not-allowed",
              background:newEvent.title.trim()&&newEvent.date.trim()?alpha(C.blue,'cc'):C.subtle,
              color:newEvent.title.trim()&&newEvent.date.trim()?"#fff":C.textMute}}>
            新增事件
          </button>
        </div>
      )}

      {/* 待驗證（7天內，AI已預測） */}
      {verifying.length > 0 && (<>
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          marginBottom:8,
        }}>
          <div style={{...lbl, marginBottom:0, color:C.amber}}>⏳ 待驗證 · {verifying.length} 件</div>
          <span style={{fontSize:12,color:C.textMute}}>7天內事件・AI已預測</span>
        </div>
        {predictingEvents && (
          <div style={{fontSize:13,color:C.amber,marginBottom:8,textAlign:"center"}}>⏳ AI 正在預測中...</div>
        )}
        {(()=>{
          const LIMIT = 10;
          const show = newsVerifyingExpanded ? verifying : verifying.slice(0, LIMIT);
          return <>
            {show.map(renderRow)}
            {verifying.length > LIMIT && (
              <button onClick={()=>setNewsVerifyingExpanded(!newsVerifyingExpanded)} style={{
                width:"100%",padding:"8px 0",border:`1px dashed ${C.border}`,borderRadius:8,
                background:"transparent",color:C.amber,fontSize:13,fontWeight:500,cursor:"pointer",
                marginTop:4,marginBottom:4,
              }}>{newsVerifyingExpanded ? "▲ 收合" : `▼ 展開其餘 ${verifying.length - LIMIT} 則`}</button>
            )}
          </>;
        })()}
      </>)}

      {/* 待觀察（>7天） */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        marginBottom:8, marginTop: verifying.length > 0 ? 16 : 0,
      }}>
        <div style={{...lbl, marginBottom:0}}>待觀察 · {pending.length} 件</div>
        <span style={{fontSize:12,color:C.textMute}}>7天以上</span>
      </div>
      {(()=>{
        const LIMIT = 10;
        const show = newsPendingExpanded ? pending : pending.slice(0, LIMIT);
        return <>
          {show.map(renderRow)}
          {pending.length > LIMIT && (
            <button onClick={()=>setNewsPendingExpanded(!newsPendingExpanded)} style={{
              width:"100%",padding:"8px 0",border:`1px dashed ${C.border}`,borderRadius:8,
              background:"transparent",color:C.blue,fontSize:13,fontWeight:500,cursor:"pointer",
              marginTop:4,marginBottom:4,
            }}>{newsPendingExpanded ? "▲ 收合" : `▼ 展開其餘 ${pending.length - LIMIT} 則`}</button>
          )}
        </>;
      })()}

      {/* 已發生 */}
      <div style={{...lbl, marginBottom:8, marginTop:16}}>已發生 · 驗證 {hits+misses}/{past.length} 件</div>
      {(()=>{
        const LIMIT = 10;
        const show = newsPastExpanded ? past : past.slice(0, LIMIT);
        return <>
          {show.map(renderRow)}
          {past.length > LIMIT && (
            <button onClick={()=>setNewsPastExpanded(!newsPastExpanded)} style={{
              width:"100%",padding:"8px 0",border:`1px dashed ${C.border}`,borderRadius:8,
              background:"transparent",color:C.blue,fontSize:13,fontWeight:500,cursor:"pointer",
              marginTop:4,
            }}>{newsPastExpanded ? "▲ 收合" : `▼ 展開其餘 ${past.length - LIMIT} 則`}</button>
          )}
        </>;
      })()}
    </>
  );
}

const NewsTab = React.memo(NewsTabImpl);
export default NewsTab;
