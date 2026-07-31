import React, { Suspense, lazy } from 'react';
import { validateProps } from '@/checkup/lib/validateProps.js';
import { formatTaipeiYMD } from '@/checkup/utils/formatTaipeiDate';
import { trackPaywall } from '@/lib/paywallTracking';

const Md = lazy(() => import('@/checkup/components/Md'));

/**
 * DailyTab — Free Checkup「收盤分析」tab。
 * 抽自 FreeCheckup.jsx L4747-L5229（純展示，無內部 state）。
 * 行為與原 inline JSX 完全一致；callbacks 都靠 props 傳入。
 *
 * Props schema 與型別檢查見 DAILY_TAB_PROP_SCHEMA / dev validateProps。
 */
const DAILY_TAB_PROP_SCHEMA = {
  isDemo: 'boolean',
  navigate: 'function',
  startLineLogin: { type: 'function', optional: true },
  C: 'object',
  alpha: 'function',
  
  demoDailyMode: 'string',
  setDemoDailyMode: 'function',
  dailyReport: { type: 'object', optional: true },
  setDailyReport: 'function',
  analyzing: 'boolean',
  analyzeStep: { type: 'string', optional: true },
  runDailyAnalysis: 'function',
  runDailyAnalysisInBackground: { type: 'function', optional: true },
  hasReachedDailyLimit: 'boolean',
  quota: { type: 'object', optional: true },
  formatResetCountdown: 'function',
  tier: 'string',
  needsAddFriend: { type: 'boolean', optional: true },
  dailyLastError: { type: 'object', optional: true },
  setDailyLastError: 'function',
  dailyErrorRef: 'object',
  dailyRetryHistory: 'array',
  dailyRetryLocked: 'boolean',
  handleDailyRetry: 'function',
  pc: 'function',
  setTab: 'function',
  setExpandedNews: 'function',
  coverageOpen: 'boolean',
  setCoverageOpen: 'function',
  coverageReport: { type: 'object', optional: true },
  setCoverageReport: 'function',
  strategyBrain: { type: 'object', optional: true },
  setStrategyBrain: 'function',
  save: 'function',
  cloudSync: 'boolean',
  analysisHistory: { type: 'array', optional: true },
};

function DailyTabImpl({
  // 模式
  isDemo,
  navigate,
  startLineLogin,
  // 樣式 / 文案
  C, alpha,
  // demo 子模式
  demoDailyMode, setDemoDailyMode,
  // 報告
  dailyReport, setDailyReport,
  analyzing, analyzeStep,
  runDailyAnalysis,
  runDailyAnalysisInBackground,
  // 配額
  hasReachedDailyLimit, quota, formatResetCountdown, tier,
  // B-25：line_only 用戶（未加好友）需顯示加好友引導
  needsAddFriend,
  // 錯誤 / 重試
  dailyLastError, setDailyLastError,
  dailyErrorRef,
  dailyRetryHistory, dailyRetryLocked, handleDailyRetry,
  // 顏色函式
  pc,
  // 切 tab
  setTab, setExpandedNews,
  // 補抓報告
  coverageOpen, setCoverageOpen,
  coverageReport, setCoverageReport,
  // 策略大腦
  strategyBrain, setStrategyBrain,
  save, cloudSync,
  // 歷史
  analysisHistory,
}) {
  validateProps('DailyTab', arguments[0], DAILY_TAB_PROP_SCHEMA);
  return (
    <>
          {/* §6.5 憲法：Demo/LINE 提示改由頁腳 DemoFooterHint 提示，此處只保留 dev-only 的 demo 模式切換（isDemo 時） */}
          {isDemo && (
            <div style={{marginBottom:14,padding:"10px 0",borderBottom:`1px solid ${alpha(C.textMute,'20')}`,display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
              <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em"}}>DEMO 資料來源</span>
              <div style={{display:"flex",gap:8}}>
                {[
                  { k: 'static', label: '靜態範例' },
                  { k: 'live', label: '即時 AI' },
                ].map(opt => {
                  const active = demoDailyMode === opt.k;
                  return (
                    <button key={opt.k} onClick={() => setDemoDailyMode(opt.k)}
                      style={{padding:"4px 10px",fontSize:11,letterSpacing:"0.04em",cursor:"pointer",
                        background:"transparent",
                        color: active ? C.text : C.textMute,
                        border:"none",
                        borderBottom:`1px solid ${active ? C.text : "transparent"}`}}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {/* §6.1 起始態：serif 節標 + 一句提示 + 文字鏈結（刪除置中大 teal 按鈕/字距標題） */}
           {!dailyReport && !analyzing && (
             <div style={{padding:"24px 0 20px",marginBottom:14,borderBottom:`1px solid ${alpha(C.textMute,'20')}`}}>
               <h3 style={{margin:0,fontFamily:"'Noto Serif TC',ui-serif,Georgia,serif",fontSize:20,color:C.text,fontWeight:400,letterSpacing:0}}>收盤分析</h3>
               <div style={{fontSize:13,color:C.textSec,marginTop:10,lineHeight:1.9}}>
                 分析今日股價變動、事件連動性，比對持倉漲跌、異常波動、策略建議。
               </div>
               <div style={{marginTop:16,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                 <button onClick={runDailyAnalysis} disabled={hasReachedDailyLimit} style={{
                   padding:"8px 0",
                   border:"none",borderBottom:`1px solid ${C.text}`,
                   background:"transparent",
                   color:hasReachedDailyLimit ? C.textMute : C.text,
                   fontSize:13,fontWeight:400,
                   cursor:hasReachedDailyLimit ? "not-allowed" : "pointer",
                   opacity:hasReachedDailyLimit ? 0.5 : 1,
                   letterSpacing:"0.04em"}}>
                   {hasReachedDailyLimit ? (tier === 'none' ? '需訂閱方案' : tier === 'line_free' ? '免費配額已用完' : (quota?.period === 'week' ? '本週' : '本月') + '配額已用完') : "開始今日收盤分析 →"}
                  </button>
                  {!hasReachedDailyLimit && typeof runDailyAnalysisInBackground === 'function' && (
                    <button onClick={runDailyAnalysisInBackground} style={{
                      padding:"4px 0",
                      border:"none",background:'transparent',color:C.textMute,
                      fontSize:12,fontWeight:400,cursor:'pointer',letterSpacing:'0.04em'
                    }}>背景執行 →</button>
                  )}
               </div>
               <div style={{fontSize:11,color:C.textMute,marginTop:12,lineHeight:1.8}}>
                    {hasReachedDailyLimit
                      ? <>
                          {(tier !== 'none' && tier !== 'line_free') && formatResetCountdown(quota?.resets_at)}
                          {tier === 'line_free' && <>免費／補償額度已用完（使用日 {formatTaipeiYMD(quota?.last_used_at) || '尚未紀錄'}）</>}
                          {tier === 'none' && '訂閱後即可開始使用'}
                          {(tier === 'free' || tier === 'basic' || tier === 'line_free' || tier === 'none') && (
                            <>　·　<a href="/pricing#checkup" onClick={() => trackPaywall('click_upgrade', 'daily_tab_limit', { tier })} style={{color:C.text,textDecoration:"underline"}}>查看訂閱方案 →</a></>
                          )}
                        </>
                      : (tier === 'line_free'
                          ? ((Number(quota?.entitlement_total || 0) > 0)
                              ? <>已回送補償額度・還可使用 <span style={{color:C.text}}>{Math.max((quota?.limit || 0) - (quota?.used || 0), 0)}</span> 次</>
                              : <>LINE 註冊禮：第一次免費；第二次起需付費・還可使用 <span style={{color:C.text}}>{Math.max((quota?.limit || 0) - (quota?.used || 0), 0)}</span> 次</>)
                          : "收盤後按下即可開始分析")}
                  </div>
             </div>
            )}

          {dailyLastError && !analyzing && (
            <div ref={dailyErrorRef} style={{
              margin:"0 0 14px",padding:"14px 16px",borderRadius:8,
              border:`1px solid ${alpha(C.down,'30')}`,
              background:alpha(C.down,'06'),
            }}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:6}}>
                <div style={{fontSize:12,color:C.down,fontWeight:500,letterSpacing:"0.04em"}}>
                  收盤分析失敗
                </div>
                {dailyRetryHistory.length > 0 && (
                  <div style={{fontSize:10,color:C.textMute,fontWeight:400,opacity:0.8,letterSpacing:"0.04em"}}>
                    已重試 {dailyRetryHistory.length} 次
                  </div>
                )}
              </div>
              <div style={{fontSize:12,color:C.textSec,lineHeight:1.7,fontWeight:400}}>
                錯誤代碼：<code style={{fontSize:11,color:C.text}}>{dailyLastError.code}</code><br/>
                {dailyLastError.message}
              </div>
              <div style={{fontSize:10,color:C.textMute,marginTop:8,fontFamily:"ui-monospace,monospace",lineHeight:1.6,opacity:0.8}}>
                cid: {dailyLastError.cid}<br/>
                操作時間：{dailyLastError.opStartedAt}<br/>
                {dailyLastError.httpStatus ? `HTTP: ${dailyLastError.httpStatus}` : ""}
              </div>
              <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                <button
                  onClick={handleDailyRetry}
                  disabled={analyzing || dailyRetryLocked}
                  aria-busy={analyzing || dailyRetryLocked}
                  title={dailyRetryLocked || analyzing ? '重試中，請稍候' : '重新嘗試收盤分析'}
                  style={{
                    padding:"6px 14px",borderRadius:6,
                    border:`1px solid ${C.text}`,
                    background:"transparent",
                    color:C.text,fontSize:12,fontWeight:400,
                    cursor:(analyzing||dailyRetryLocked)?"not-allowed":"pointer",
                    opacity:(analyzing||dailyRetryLocked)?0.5:1,
                    letterSpacing:"0.04em"}}>
                  {(analyzing || dailyRetryLocked) ? "重試中…" : "重試"}
                </button>
                <button onClick={() => setDailyLastError(null)} style={{
                  padding:"6px 14px",borderRadius:6,
                  border:`1px solid ${alpha(C.textMute,'25')}`,
                  background:"transparent",
                  color:C.textMute,fontSize:12,fontWeight:400,
                  cursor:"pointer",letterSpacing:"0.04em"}}>
                  關閉
                </button>
              </div>
              {dailyRetryHistory.length > 0 && (
                <div style={{
                  marginTop:14,paddingTop:12,
                  borderTop:`1px dashed ${alpha(C.textMute,'20')}`,
                }}>
                  <div style={{fontSize:10,color:C.textMute,fontWeight:500,letterSpacing:"0.06em",marginBottom:8,opacity:0.7}}>
                    重試時間軸
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {dailyRetryHistory.map((r) => {
                      const inProgress = r.endedAt == null;
                      const dotColor = inProgress ? C.amber : (r.success ? C.up : C.down);
                      const startStr = new Date(r.startedAt).toLocaleTimeString('zh-TW',{hour12:false});
                      const endStr = r.endedAt ? new Date(r.endedAt).toLocaleTimeString('zh-TW',{hour12:false}) : '—';
                      const dur = r.durationMs != null ? `${(r.durationMs/1000).toFixed(1)}s` : '進行中';
                      const statusLabel = inProgress ? '進行中' : (r.success ? '成功' : '失敗');
                      return (
                        <div key={r.id} style={{
                          display:"grid",
                          gridTemplateColumns:"10px 50px 1fr",
                          gap:8,alignItems:"start",
                          fontSize:10,fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",
                          lineHeight:1.5,
                        }}>
                          <span style={{
                            display:"inline-block",width:8,height:8,borderRadius:"50%",
                            background:dotColor,marginTop:4,
                          }} />
                          <span style={{color:C.textMute,opacity:0.8}}>#{r.attempt}</span>
                          <div style={{minWidth:0}}>
                            <div style={{color:C.textSec}}>
                              <span style={{color:dotColor,fontWeight:500}}>{statusLabel}</span>
                              <span style={{color:C.textMute,opacity:0.7,marginLeft:6}}>
                                {startStr} → {endStr}（{dur}）
                              </span>
                            </div>
                            {!inProgress && !r.success && (
                              <div style={{color:C.textMute,opacity:0.75,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                                {r.code || 'UNKNOWN'}
                                {r.httpStatus ? ` · HTTP ${r.httpStatus}` : ''}
                                {r.cid ? ` · cid:${String(r.cid).slice(0,18)}` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {analyzing && (
            <div style={{textAlign:"center",padding:"36px 16px"}}>
              <div style={{fontSize:13,color:C.text,fontWeight:400,marginBottom:10,letterSpacing:"0.04em"}}>
                {analyzeStep || "正在分析今日收盤數據..."}
              </div>
              <div style={{fontSize:11,color:C.textMute,marginTop:8,display:"flex",justifyContent:"center",gap:10,flexWrap:"wrap"}}>
                {["取得股價","比對事件","AI 策略分析","大腦進化"].map((s,i)=>(
                  <span key={i} style={{fontSize:10,color:C.textMute,fontWeight:400,letterSpacing:"0.04em"}}>{s}</span>
                ))}
              </div>
              <div style={{width:"100%",height:1,background:alpha(C.textMute,'12'),marginTop:16,overflow:"hidden"}}>
                <div style={{height:"100%",
                  background:C.text,
                  width:"70%",
                  transition:"width 0.5s ease"}} />
              </div>
            </div>
          )}

          {dailyReport && !analyzing && <>
            {/* 今日損益摘要（編輯化：無色卡、無圓角、serif 日期） */}
            <div id="daily-report-top" style={{
              padding:"18px 0 16px",marginBottom:14,
              borderBottom:`1px solid ${alpha(C.textMute,'20')}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
                <div>
                  <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:4}}>
                    <button onClick={()=>setDailyReport(null)} style={{fontSize:12,padding:0,border:"none",background:"transparent",color:C.textMute,cursor:"pointer",fontWeight:400,letterSpacing:"0.04em"}}>← 返回</button>
                    <span style={{fontFamily:"'Noto Serif TC',ui-serif,Georgia,serif",fontSize:18,color:C.text,fontWeight:400,fontVariantNumeric:"tabular-nums"}}>{dailyReport.date}</span>
                  </div>
                  <div style={{fontSize:11,color:C.textMute,letterSpacing:"0.04em"}}>{dailyReport.time} 更新</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",marginBottom:4}}>今日損益</div>
                  <div style={{fontSize:"clamp(22px, 6vw, 28px)",fontWeight:500,color:pc(dailyReport.totalTodayPnl),lineHeight:1,fontVariantNumeric:"tabular-nums"}}>
                    {dailyReport.totalTodayPnl>=0?"+":"−"}{Math.abs(dailyReport.totalTodayPnl).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>


            {/* AI 策略分析 — Markdown 渲染 */}
            {dailyReport.aiInsight && (
              <div style={{marginBottom:18,paddingBottom:16,borderBottom:`1px solid ${alpha(C.textMute,'20')}`}}>
                <div style={{borderTop:`1px solid ${C.text}`,paddingTop:12,marginBottom:12}}>
                  <h3 style={{margin:0,fontFamily:"'Noto Serif TC',ui-serif,Georgia,serif",fontSize:16,color:C.text,fontWeight:400,letterSpacing:0}}>AI 策略分析</h3>
                </div>
                <div style={{fontSize:15,lineHeight:2,color:C.text}}>
                  <Suspense fallback={null}><Md text={dailyReport.aiInsight} color={C.text} /></Suspense>
                </div>
              </div>
            )}

            {!dailyReport.aiInsight && (
              <div style={{marginBottom:14,padding:"8px 0"}}>
                <div style={{fontSize:12,color:C.textMute,textAlign:"center",fontWeight:400}}>
                  AI 分析未產生
                </div>
              </div>
            )}

            {/* 自動驗證事件結果 */}
            {(dailyReport.autoVerified||[]).length>0 && (
              <div style={{marginBottom:18,paddingBottom:16,borderBottom:`1px solid ${alpha(C.textMute,'20')}`}}>
                <div style={{borderTop:`1px solid ${C.text}`,paddingTop:12,marginBottom:12,display:"flex",alignItems:"baseline",justifyContent:"space-between"}}>
                  <h3 style={{margin:0,fontFamily:"'Noto Serif TC',ui-serif,Georgia,serif",fontSize:16,color:C.text,fontWeight:400,letterSpacing:0}}>自動驗證</h3>
                  <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em"}}>{dailyReport.autoVerified.length} 件</span>
                </div>
                {dailyReport.autoVerified.map((v,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,
                    padding:"8px 0",borderBottom:i<dailyReport.autoVerified.length-1?`1px solid ${alpha(C.textMute,'10')}`:"none"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.title}</div>
                      <div style={{fontSize:11,color:C.textMute,marginTop:2}}>
                        預測{v.pred==="up"?"看漲":"看跌"} → 實際{v.actual==="up"?"漲":v.actual==="down"?"跌":"中性"}
                      </div>
                    </div>
                    <span style={{fontSize:12,flexShrink:0,letterSpacing:"0.04em",
                      color:v.correct?"var(--cm-accent, #FF4D1F)":C.textMute}}>
                      {v.correct?"命中":"未中"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 需要復盤的事件 */}
            {(dailyReport.needsReview||[]).length>0 && (
              <div style={{marginBottom:18,paddingBottom:16,borderBottom:`1px solid ${alpha(C.textMute,'20')}`}}>
                <div style={{borderTop:`1px solid ${C.text}`,paddingTop:12,marginBottom:12,display:"flex",alignItems:"baseline",justifyContent:"space-between"}}>
                  <h3 style={{margin:0,fontFamily:"'Noto Serif TC',ui-serif,Georgia,serif",fontSize:16,color:C.text,fontWeight:400,letterSpacing:0}}>需要復盤</h3>
                  <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em"}}>{dailyReport.needsReview.length} 件</span>
                </div>
                {dailyReport.needsReview.map(e=>(
                  <div key={e.id} style={{padding:"8px 0",borderBottom:`1px solid ${alpha(C.textMute,'10')}`}}>
                    <div style={{fontSize:13,color:C.text}}>{e.title}</div>
                    <div style={{fontSize:11,color:C.textMute,marginTop:2}}>{e.date} — 預測{e.pred==="up"?"看漲":"看跌"}</div>
                    <button onClick={()=>{setTab("news");setExpandedNews(new Set([e.id]))}}
                      style={{marginTop:6,padding:0,border:"none",
                        background:"transparent",color:C.text,fontSize:11,cursor:"pointer",letterSpacing:"0.04em",textDecoration:"underline"}}>
                      前往復盤 →
                    </button>
                  </div>
                ))}
              </div>
      )}

      {/* ══════════ 補抓報告 ══════════ */}
      {coverageOpen && coverageReport && (() => {
        const { requested, fetched, missingRows } = coverageReport;
        const successCount = requested - missingRows.length;
        const reasonText = (r) => {
          if (r === 'invalid_format') return '非台股代號格式（系統僅支援台股上市櫃 / ETF / 權證）';
          if (r === 'not_found') return 'TWSE / TPEx 都查無此代碼，可能已下市或代號錯誤';
          if (r === 'no_price') return '查到代碼但無有效報價（停牌或當日無成交）';
          return r || '未知原因';
        };
        const close = () => { setCoverageOpen(false); setCoverageReport(null); };
        return (
          <div
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:120,
              display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
            onClick={close}
          >
            <div onClick={e => e.stopPropagation()}
              style={{background:C.card, borderRadius:10, width:'min(640px, 100%)',
                maxHeight:'min(86vh, 720px)', display:'flex', flexDirection:'column',
                border:`1px solid ${C.border}`}}>
              <div style={{padding:'18px 22px 12px',borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{fontSize:15,fontWeight:500,color:C.text,letterSpacing:'0.02em'}}>補抓報告</div>
                  <button onClick={close} style={{
                    background:'transparent',border:'none',color:C.textMute,cursor:'pointer',fontSize:18,padding:0,lineHeight:1}}>✕</button>
                </div>
                <div style={{fontSize:12,color:C.textSec,lineHeight:1.6}}>
                  補抓 <b style={{color:C.text}}>{requested}</b> 檔　·　成功 <b style={{color:C.olive}}>{successCount}</b>　·　仍失敗 <b style={{color:C.down}}>{missingRows.length}</b>
                </div>
              </div>

              <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:alpha(C.subtle,'66'),color:C.textMute,letterSpacing:'0.05em'}}>
                      <th style={{textAlign:'left',padding:'8px 14px',fontWeight:400,fontSize:11}}>代碼</th>
                      <th style={{textAlign:'left',padding:'8px 8px',fontWeight:400,fontSize:11}}>名稱</th>
                      <th style={{textAlign:'left',padding:'8px 8px',fontWeight:400,fontSize:11}}>類型</th>
                      <th style={{textAlign:'left',padding:'8px 14px',fontWeight:400,fontSize:11}}>無法補抓的原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingRows.map(r => (
                      <tr key={r.code} style={{borderBottom:`1px solid ${alpha(C.border,'88')}`}}>
                        <td style={{padding:'8px 14px',fontFamily:'ui-monospace,monospace',color:C.text}}>{r.code}</td>
                        <td style={{padding:'8px 8px',color:C.text}}>{r.name}</td>
                        <td style={{padding:'8px 8px',color:C.textMute}}>{r.type || '—'}</td>
                        <td style={{padding:'8px 14px',color:C.down,fontSize:11,lineHeight:1.5}}>{reasonText(r.reason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{padding:'10px 22px',borderTop:`1px solid ${C.border}`,fontSize:11,color:C.textMute,lineHeight:1.6}}>
                若您持有美股、港股、加密貨幣等海外標的，目前不支援自動報價，請於該檔持倉手動填入價格。
              </div>
            </div>
          </div>
        );
      })()}


            {/* 重新分析（頁腳文字鏈結） */}
            <div style={{padding:"14px 0",marginBottom:16,borderTop:`1px solid ${alpha(C.textMute,'20')}`,textAlign:"right"}}>
              <button onClick={runDailyAnalysis} disabled={analyzing} style={{
                padding:"6px 0",border:"none",
                background:"transparent",color:analyzing?C.textMute:C.text,fontSize:12,cursor:analyzing?"not-allowed":"pointer",
                letterSpacing:"0.04em",textDecoration:"underline"}}>
                重新分析 →
              </button>
            </div>
          </>}

          {/* 策略大腦 */}
          {strategyBrain && (
            <div style={{marginBottom:18,paddingBottom:16,borderBottom:`1px solid ${alpha(C.textMute,'20')}`}}>
              <div style={{borderTop:`1px solid ${C.text}`,paddingTop:12,marginBottom:12,display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                <h3 style={{margin:0,fontFamily:"'Noto Serif TC',ui-serif,Georgia,serif",fontSize:16,color:C.text,fontWeight:400,letterSpacing:0}}>策略大腦</h3>
                <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.06em"}}>
                  更新 {strategyBrain.lastUpdate||"—"} ｜ 分析 {strategyBrain.stats?.totalAnalyses||0} 次
                </span>
              </div>

              {(strategyBrain.rules||[]).length>0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.10em",marginBottom:6}}>核心策略規則</div>
                  {strategyBrain.rules.map((r,i)=>(
                    <div key={i} style={{fontSize:13,color:C.text,lineHeight:1.9,
                      padding:"4px 0",borderBottom:`1px solid ${alpha(C.textMute,'10')}`}}>
                      <span style={{color:C.textMute,marginRight:8,fontVariantNumeric:"tabular-nums"}}>{String(i+1).padStart(2,'0')}</span>{r}
                    </div>
                  ))}
                </div>
              )}

              {(strategyBrain.commonMistakes||[]).length>0 && (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.10em",marginBottom:6}}>常犯錯誤</div>
                  {strategyBrain.commonMistakes.map((m,i)=>(
                    <div key={i} style={{fontSize:13,color:C.textSec,lineHeight:1.9,padding:"3px 0"}}>{m}</div>
                  ))}
                </div>
              )}

              {(strategyBrain.lessons||[]).length>0 && (
                <div>
                  <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.10em",marginBottom:6}}>
                    最近教訓（共 {strategyBrain.lessons.length} 條）
                  </div>
                  {strategyBrain.lessons.slice(-5).reverse().map((l,i)=>(
                    <div key={i} style={{fontSize:12,color:C.textSec,lineHeight:1.8,
                      padding:"4px 0",borderBottom:`1px solid ${alpha(C.textMute,'10')}`}}>
                      <span style={{color:C.textMute,marginRight:8,fontVariantNumeric:"tabular-nums"}}>{l.date}</span>{l.text}
                    </div>
                  ))}
                </div>
              )}

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
                <div style={{fontSize:11,color:C.textSec,fontWeight:400,letterSpacing:"0.04em"}}>
                  命中率：{strategyBrain.stats?.hitRate||"計算中"}
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>{
                    const json = JSON.stringify(strategyBrain, null, 2);
                    const blob = new Blob([json], {type:"application/json"});
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `strategy-brain-${new Date().toISOString().slice(0,10)}.json`;
                    a.click();
                  }} style={{fontSize:11,padding:"3px 8px",borderRadius:4,border:"none",background:"transparent",color:C.textMute,cursor:"pointer",fontWeight:400}}>
                    匯出
                  </button>
                  <button onClick={()=>{
                    if (confirm("確定要重置策略大腦？所有累積的規則和教訓將被清除。")) {
                      setStrategyBrain(null);
                      save("pf-brain-v1", null);
                    }
                  }} style={{fontSize:11,padding:"3px 8px",borderRadius:4,border:"none",background:"transparent",color:C.textMute,cursor:"pointer",fontWeight:400}}>
                    重置
                  </button>
                </div>
              </div>
              <div style={{fontSize:11,color:C.textMute,marginTop:6,fontWeight:400,opacity:0.6}}>
                {cloudSync ? "雲端同步" : "本機模式"}
              </div>
            </div>
          )}

          {!strategyBrain && (
            <div style={{marginBottom:14,padding:"16px 0",borderTop:`1px solid ${alpha(C.textMute,'20')}`}}>
              <div style={{fontSize:12,color:C.textMute,fontWeight:400,lineHeight:1.8,letterSpacing:"0.04em"}}>
                執行第一次收盤分析後，策略大腦將自動建立並持續進化。
              </div>
            </div>
          )}

          {/* 歷史分析 */}
          {(analysisHistory||[]).length>0 && (()=>{
            // Filter out entries without real data (hardcoded/empty)
            const validHistory = (analysisHistory||[]).filter(r => r.changes && r.changes.length > 0);
            if (validHistory.length === 0) return null;
            return (
              <div style={{marginTop:18}}>
                <div style={{borderTop:`1px solid ${C.text}`,paddingTop:12,marginBottom:8,display:"flex",alignItems:"baseline",justifyContent:"space-between"}}>
                  <h3 style={{margin:0,fontFamily:"'Noto Serif TC',ui-serif,Georgia,serif",fontSize:16,color:C.text,fontWeight:400,letterSpacing:0}}>歷史記錄</h3>
                  <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em"}}>共 {validHistory.length} 筆</span>
                </div>
                {validHistory.slice(0,15).map(r=>{
                  const isExpanded = dailyReport?.id === r.id;
                  return (
                  <div key={r.id}>
                    <div onClick={()=>{
                        if (isExpanded) { setDailyReport(null); } else { setDailyReport(r); }
                      }}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                        padding:"10px 0",cursor:"pointer",
                        borderBottom:`1px solid ${alpha(C.textMute,'10')}`}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                        <span style={{fontSize:11,color:C.textMute,fontVariantNumeric:"tabular-nums"}}>{isExpanded?"—":"›"}</span>
                        <span style={{fontFamily:"'Noto Serif TC',ui-serif,Georgia,serif",fontSize:14,color:C.text,fontVariantNumeric:"tabular-nums"}}>{r.date}</span>
                        <span style={{fontSize:11,color:C.textMute,fontVariantNumeric:"tabular-nums"}}>{r.time}</span>
                      </div>
                      <span style={{fontSize:13,fontVariantNumeric:"tabular-nums",
                        color:pc(r.totalTodayPnl)}}>
                        {r.totalTodayPnl>=0?"+":""}{r.totalTodayPnl.toLocaleString()}
                      </span>
                    </div>
                    {isExpanded && (
                      <div style={{padding:"10px 0",borderBottom:`1px solid ${alpha(C.textMute,'06')}`,marginBottom:4}}>
                        {r.aiInsight && (
                          <div style={{marginBottom:6}}>
                            <Suspense fallback={null}><Md text={r.aiInsight} color={C.text} /></Suspense>
                          </div>
                        )}
                        <button onClick={(ev)=>{ev.stopPropagation();setDailyReport(r);
                          setTimeout(()=>document.getElementById("daily-report-top")?.scrollIntoView({behavior:"smooth"}),50);
                        }} style={{marginTop:4,padding:"4px 10px",borderRadius:4,border:"none",
                          background:"transparent",color:C.textSec,fontSize:11,cursor:"pointer",width:"100%",fontWeight:400}}>
                          查看完整報告 ↑
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            );
          })()}
    </>
  );
}

const DailyTab = React.memo(DailyTabImpl);
DailyTab.displayName = 'DailyTab';
export default DailyTab;
