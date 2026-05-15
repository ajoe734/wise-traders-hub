import React, { Suspense, lazy } from 'react';
import { validateProps } from './_validateProps';

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
  DEMO_TAB_NOTICE_COPY: 'object',
  demoDailyMode: 'string',
  setDemoDailyMode: 'function',
  dailyReport: { type: 'object', optional: true },
  setDailyReport: 'function',
  analyzing: 'boolean',
  analyzeStep: { type: 'string', optional: true },
  runDailyAnalysis: 'function',
  hasReachedDailyLimit: 'boolean',
  quota: { type: 'object', optional: true },
  formatResetCountdown: 'function',
  tier: 'string',
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
  DEMO_TAB_NOTICE_COPY,
  // demo 子模式
  demoDailyMode, setDemoDailyMode,
  // 報告
  dailyReport, setDailyReport,
  analyzing, analyzeStep,
  runDailyAnalysis,
  // 配額
  hasReachedDailyLimit, quota, formatResetCountdown, tier,
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
  return (
    <>
          {isDemo && (
            <div style={{marginBottom:12,padding:"12px 14px",background:alpha(C.amber,'06'),border:`1px solid ${alpha(C.amber,'25')}`,borderRadius:8}}>
              <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:4,letterSpacing:"0.02em"}}>{DEMO_TAB_NOTICE_COPY.daily.title}</div>
              <div style={{fontSize:11,color:C.textMute,lineHeight:1.7,marginBottom:8}}>{DEMO_TAB_NOTICE_COPY.daily.body}</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={() => { try { startLineLogin?.(); } catch { navigate('/auth/login?redirect=/checkup'); } }} style={{background:"#06C755",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:500,cursor:"pointer",letterSpacing:"0.02em"}}>LINE 登入解鎖</button>
                <button onClick={() => navigate('/auth/login?redirect=/checkup')} style={{background:"transparent",color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:400,cursor:"pointer",letterSpacing:"0.02em"}}>Email 登入</button>
              </div>
              <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${alpha(C.border,'80')}`}}>
                <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.08em",marginBottom:6,fontWeight:500}}>DEMO 收盤分析來源</div>
                <div style={{display:"flex",gap:6}}>
                  {[
                    { k: 'static', label: '靜態範例', hint: '預錄文案，不消耗配額' },
                    { k: 'live', label: '即時 AI + 知識庫', hint: '呼叫真實 edge / 知識庫' },
                  ].map(opt => {
                    const active = demoDailyMode === opt.k;
                    return (
                      <button key={opt.k} onClick={() => setDemoDailyMode(opt.k)} title={opt.hint}
                        style={{flex:1,padding:"6px 10px",borderRadius:6,fontSize:11,fontWeight:active?500:400,letterSpacing:"0.02em",cursor:"pointer",
                          background: active ? C.text : "transparent",
                          color: active ? C.bg : C.textSec,
                          border: `1px solid ${active ? C.text : C.border}`}}>
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <div style={{fontSize:10,color:C.textMute,marginTop:6,lineHeight:1.6,opacity:0.8}}>
                  {demoDailyMode === 'live' ? '⚡ 將呼叫真實 AI / 知識庫，回傳內容會基於目前 demo 持倉動態生成。' : '📋 顯示預錄範例文案，配合 demo 持倉產生個股漲跌列。'}
                </div>
              </div>
            </div>
          )}
          {/* 手動觸發按鈕 */}
           {!dailyReport && !analyzing && (
             <div style={{textAlign:"center",padding:"36px 16px",marginBottom:14}}>
               <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400,marginBottom:10}}>每 日 收 盤 分 析</div>
               <div style={{fontSize:13,color:C.textMute,marginBottom:20,lineHeight:1.8,fontWeight:400}}>
                 分析今日股價變動與事件連動性<br/>自動比對持倉漲跌、異常波動、策略建議
               </div>
               <button onClick={runDailyAnalysis} disabled={hasReachedDailyLimit} style={{
                 padding:"10px 24px",borderRadius:8,
                 border:`1px solid ${alpha(C.teal,'30')}`,
                 background:alpha(C.teal,'06'),
                 color:hasReachedDailyLimit ? C.textMute : C.teal,fontSize:13,fontWeight:400,
                 cursor:hasReachedDailyLimit ? "not-allowed" : "pointer",
                 opacity:hasReachedDailyLimit ? 0.5 : 1,
                 letterSpacing:"0.04em"}}>
                 {hasReachedDailyLimit ? `🔒 ${quota?.period === 'week' ? '本週' : '本月'}配額已用完` : "開始今日收盤分析"}
                </button>
                <div style={{fontSize:11,color:C.textMute,marginTop:10,opacity:0.75,lineHeight:1.7}}>
                  {hasReachedDailyLimit
                    ? <>
                        {formatResetCountdown(quota?.resets_at)}
                        {(tier === 'free' || tier === 'basic') && (
                          <>　・　<a href="/pricing#checkup" style={{color:C.blue,textDecoration:"none"}}>升級方案 →</a></>
                        )}
                      </>
                    : "收盤後按下即可開始分析"}
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
                  ⚠ 收盤分析失敗
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
                  disabled={analyzing || dailyRetryLocked || hasReachedDailyLimit}
                  aria-busy={analyzing || dailyRetryLocked}
                  title={dailyRetryLocked || analyzing ? '重試中，請稍候' : '重新嘗試收盤分析'}
                  style={{
                    padding:"6px 14px",borderRadius:6,
                    border:`1px solid ${alpha(C.teal,'40')}`,
                    background:alpha(C.teal,'08'),
                    color:C.teal,fontSize:12,fontWeight:400,
                    cursor:(analyzing||dailyRetryLocked||hasReachedDailyLimit)?"not-allowed":"pointer",
                    opacity:(analyzing||dailyRetryLocked||hasReachedDailyLimit)?0.5:1,
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
              <div style={{fontSize:13,color:C.textSec,fontWeight:400,marginBottom:10,letterSpacing:"0.04em"}}>
                {analyzeStep || "正在分析今日收盤數據..."}
              </div>
              <div style={{fontSize:11,color:C.textMute,marginTop:8,display:"flex",justifyContent:"center",gap:8,flexWrap:"wrap"}}>
                {["取得股價","比對事件","AI策略分析","大腦進化"].map((s,i)=>(
                  <span key={i} style={{fontSize:10,color:C.textMute,fontWeight:400,opacity:0.6}}>{s}</span>
                ))}
              </div>
              <div style={{width:"100%",height:2,background:alpha(C.textMute,'08'),borderRadius:1,marginTop:16,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:1,
                  background:C.teal,
                  width:"70%",
                  transition:"width 0.5s ease"}} />
              </div>
            </div>
          )}

          {dailyReport && !analyzing && <>
            {/* 今日損益摘要 */}
            <div id="daily-report-top" style={{
              background:alpha(dailyReport.totalTodayPnl>=0?C.up:C.down,'06'),
              borderRadius:12,padding:"18px 18px 16px",marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <button onClick={()=>setDailyReport(null)} style={{fontSize:11,padding:"3px 8px",borderRadius:6,border:"none",background:"transparent",color:C.textMute,cursor:"pointer",fontWeight:400}}>← 返回</button>
                    <span style={{fontSize:12,fontWeight:400,color:C.textSec}}>{dailyReport.date}</span>
                  </div>
                  <div style={{fontSize:11,color:C.textMute,marginTop:2,fontWeight:400}}>{dailyReport.time} 更新</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",marginBottom:4,fontWeight:400}}>TODAY P&L</div>
                  <div style={{fontSize:28,fontWeight:500,color:pc(dailyReport.totalTodayPnl),lineHeight:1}}>
                    {dailyReport.totalTodayPnl>=0?"+":""}{dailyReport.totalTodayPnl.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>


            {/* AI 策略分析 — Markdown 渲染 */}
            {dailyReport.aiInsight && (
              <div style={{marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
                  <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400}}>AI 策 略 分 析</span>
                </div>
                <Suspense fallback={null}><Md text={dailyReport.aiInsight} color={C.textSec} /></Suspense>
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
              <div style={{marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400,marginBottom:10}}>
                  自 動 驗 證 · {dailyReport.autoVerified.length}件
                </div>
                {dailyReport.autoVerified.map((v,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"6px 0",borderBottom:i<dailyReport.autoVerified.length-1?`1px solid ${alpha(C.textMute,'04')}`:"none"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:400,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.title}</div>
                      <div style={{fontSize:11,color:C.textMute,marginTop:2,fontWeight:400}}>
                        預測{v.pred==="up"?"看漲":"看跌"} → 實際{v.actual==="up"?"漲":v.actual==="down"?"跌":"中性"}
                      </div>
                    </div>
                    <span style={{fontSize:11,fontWeight:400,flexShrink:0,
                      color:v.correct?C.teal:C.up}}>
                      {v.correct?"命中":"失誤"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 需要復盤的事件 */}
            {(dailyReport.needsReview||[]).length>0 && (
              <div style={{marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                <div style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400,marginBottom:10}}>
                  需 要 復 盤 · {dailyReport.needsReview.length}件
                </div>
                {dailyReport.needsReview.map(e=>(
                  <div key={e.id} style={{marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:400,color:C.text}}>{e.title}</div>
                    <div style={{fontSize:11,color:C.textMute,marginTop:2,fontWeight:400}}>{e.date} — 預測{e.pred==="up"?"看漲":"看跌"}</div>
                    <button onClick={()=>{setTab("news");setExpandedNews(new Set([e.id]))}}
                      style={{marginTop:4,padding:"4px 10px",borderRadius:4,border:"none",
                        background:"transparent",color:C.textSec,fontSize:11,cursor:"pointer",fontWeight:400}}>
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


            {/* 重新分析 */}
            <button onClick={runDailyAnalysis} disabled={analyzing} style={{
              width:"100%",padding:"11px",borderRadius:8,border:`1px solid ${C.border}`,
              background:"transparent",color:C.textMute,fontSize:13,cursor:"pointer",
              marginBottom:16}}>
              重新分析
            </button>
          </>}

          {/* 策略大腦 */}
          {strategyBrain && (
            <div style={{marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400}}>策 略 大 腦</span>
                <span style={{fontSize:11,color:C.textMute,fontWeight:400}}>
                  更新：{strategyBrain.lastUpdate||"—"} | 分析：{strategyBrain.stats?.totalAnalyses||0}次
                </span>
              </div>

              {(strategyBrain.rules||[]).length>0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:C.textMute,fontWeight:400,letterSpacing:"0.08em",marginBottom:5}}>核心策略規則</div>
                  {strategyBrain.rules.map((r,i)=>(
                    <div key={i} style={{fontSize:12,color:C.textSec,lineHeight:1.8,fontWeight:400,
                      padding:"3px 0",borderBottom:`1px solid ${alpha(C.textMute,'04')}`}}>
                      {i+1}. {r}
                    </div>
                  ))}
                </div>
              )}

              {(strategyBrain.commonMistakes||[]).length>0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:C.textMute,fontWeight:400,letterSpacing:"0.08em",marginBottom:5}}>常犯錯誤</div>
                  {strategyBrain.commonMistakes.map((m,i)=>(
                    <div key={i} style={{fontSize:12,color:C.textSec,lineHeight:1.8,fontWeight:400}}>{m}</div>
                  ))}
                </div>
              )}

              {(strategyBrain.lessons||[]).length>0 && (
                <div>
                  <div style={{fontSize:10,color:C.textMute,fontWeight:400,letterSpacing:"0.08em",marginBottom:5}}>
                    最近教訓（共 {strategyBrain.lessons.length} 條）
                  </div>
                  {strategyBrain.lessons.slice(-5).reverse().map((l,i)=>(
                    <div key={i} style={{fontSize:11,color:C.textMute,lineHeight:1.7,fontWeight:400,
                      padding:"4px 0",borderBottom:`1px solid ${alpha(C.textMute,'04')}`}}>
                      <span style={{color:C.textSec}}>[{l.date}]</span> {l.text}
                    </div>
                  ))}
                </div>
              )}

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
                <div style={{fontSize:11,color:C.textMute,fontWeight:400}}>
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
            <div style={{marginBottom:14,textAlign:"center",padding:"16px 0"}}>
              <div style={{fontSize:12,color:C.textMute,fontWeight:400}}>
                執行第一次收盤分析後，策略大腦將自動建立並持續進化
              </div>
            </div>
          )}

          {/* 歷史分析 */}
          {(analysisHistory||[]).length>0 && (()=>{
            // Filter out entries without real data (hardcoded/empty)
            const validHistory = (analysisHistory||[]).filter(r => r.changes && r.changes.length > 0);
            if (validHistory.length === 0) return null;
            return (
              <div style={{marginTop:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.12em",fontWeight:400}}>歷 史 記 錄</span>
                  <span style={{fontSize:11,color:C.textMute,fontWeight:400}}>共 {validHistory.length} 筆</span>
                </div>
                {validHistory.slice(0,15).map(r=>{
                  const isExpanded = dailyReport?.id === r.id;
                  return (
                  <div key={r.id}>
                    <div onClick={()=>{
                        if (isExpanded) { setDailyReport(null); } else { setDailyReport(r); }
                      }}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                        padding:"8px 0",cursor:"pointer",
                        borderBottom:`1px solid ${alpha(C.textMute,'06')}`,
                        transition:"background 0.15s"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,color:C.textMute,transition:"transform 0.15s",
                          display:"inline-block",transform:isExpanded?"rotate(90deg)":"rotate(0deg)"}}>▶</span>
                        <span style={{fontSize:12,color:C.text,fontWeight:400}}>{r.date}</span>
                        <span style={{fontSize:10,color:C.textMute,fontWeight:400}}>{r.time}</span>
                      </div>
                      <span style={{fontSize:12,fontWeight:500,
                        color:pc(r.totalTodayPnl)}}>
                        {r.totalTodayPnl>=0?"+":""}{r.totalTodayPnl.toLocaleString()}
                      </span>
                    </div>
                    {isExpanded && (
                      <div style={{padding:"10px 0",borderBottom:`1px solid ${alpha(C.textMute,'06')}`,marginBottom:4}}>
                        {r.aiInsight && (
                          <div style={{marginBottom:6}}>
                            <Suspense fallback={null}><Md text={r.aiInsight} color={C.textSec} /></Suspense>
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
