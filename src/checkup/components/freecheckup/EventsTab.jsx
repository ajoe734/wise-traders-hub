import React, { useState, useMemo } from 'react';
import { validateProps } from '@/checkup/lib/validateProps.js';

/**
 * EventsTab — Free Checkup「事件追蹤」tab。
 * 抽自 FreeCheckup.jsx L4697-L5201（純展示，無內部 state）。
 * 所有 state / callbacks 透過 props 傳入；行為與原 inline JSX 完全一致。
 *
 * Props schema 與型別檢查見 EVENTS_TAB_PROP_SCHEMA / dev validateProps。
 */
const EVENTS_TAB_PROP_SCHEMA = {
  isDemo: 'boolean',
  navigate: 'function',
  startLineLogin: { type: 'function', optional: true },
  C: 'object',
  alpha: 'function',
  
  TYPE_COLOR: 'object',
  RETRY_MAX: 'number',
  calendarAutoStatus: 'object',
  predictAutoStatus: 'object',
  calendarLoading: 'boolean',
  predictingEvents: 'boolean',
  calendarRetry: 'object',
  predictRetry: 'object',
  calendarLastError: { type: 'object', optional: true },
  predictLastError: { type: 'object', optional: true },
  calendarLastDebug: { type: 'object', optional: true },
  predictLastDebug: { type: 'object', optional: true },
  setCalendarLastDebug: 'function',
  setPredictLastDebug: 'function',
  debugPanelOpen: 'boolean',
  setDebugPanelOpen: 'function',
  updateLog: 'array',
  setUpdateLog: 'function',
  updateLogOpen: 'boolean',
  setUpdateLogOpen: 'function',
  classifyAttempt: 'function',
  deriveSuggestion: 'function',
  holdings: 'array',
  newsEvents: 'array',
  H: 'array',
  CE: 'array',
  filteredEvents: 'array',
  filterType: 'string',
  setFilterType: 'function',
  calendarExpanded: 'boolean',
  setCalendarExpanded: 'function',
  manualRefreshCalendar: 'function',
  runPredictEvents: 'function',
};

function EventsTabImpl({
  // 模式
  isDemo,
  navigate,
  startLineLogin,
  // 樣式 / 文案
  C, alpha,
  TYPE_COLOR,
  RETRY_MAX,
  // 自動更新狀態
  calendarAutoStatus, predictAutoStatus,
  calendarLoading, predictingEvents,
  calendarRetry, predictRetry,
  calendarLastError, predictLastError,
  calendarLastDebug, predictLastDebug,
  setCalendarLastDebug, setPredictLastDebug,
  // 除錯面板
  debugPanelOpen, setDebugPanelOpen,
  updateLog, setUpdateLog,
  updateLogOpen, setUpdateLogOpen,
  classifyAttempt, deriveSuggestion,
  // 資料
  holdings, newsEvents,
  H, CE, filteredEvents,
  // filter / 展開
  filterType, setFilterType,
  calendarExpanded, setCalendarExpanded,
  // 動作
  manualRefreshCalendar,
  runPredictEvents,
}) {
  validateProps('EventsTab', arguments[0], EVENTS_TAB_PROP_SCHEMA);
  // Batch C §6.2：兩態切換（未來 / 已驗證）。已驗證來自 newsEvents (status==='past')
  const [eventsMode, setEventsMode] = useState('upcoming');
  const verifiedList = useMemo(() => {
    return (newsEvents || [])
      .filter(e => e.status === 'past')
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [newsEvents]);
  const hits = verifiedList.filter(e => e.correct === true).length;
  const misses = verifiedList.filter(e => e.correct === false).length;
  const hitRate = (hits + misses) > 0 ? Math.round(hits / (hits + misses) * 100) : null;

  return (
    <>
      {/* Batch C §6.2 報頭 + 兩態 pill */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap',
        paddingBottom: 10, marginBottom: 14,
        borderBottom: `1px solid ${C.text}`,
      }}>
        <h3 style={{
          margin: 0,
          fontFamily: "'Noto Serif TC', ui-serif, Georgia, serif",
          fontSize: 'clamp(18px,3.5vw,22px)', fontWeight: 400, color: C.text,
          letterSpacing: 0,
        }}>事件</h3>
        <div role="tablist" aria-label="事件切換" style={{ display: 'inline-flex', gap: 0, border: `1px solid ${C.border}` }}>
          {[
            { k: 'upcoming', label: `未來 ${filteredEvents?.length ?? 0}` },
            { k: 'verified', label: hitRate != null ? `已驗證 ${verifiedList.length} · 命中率 ${hitRate}%` : `已驗證 ${verifiedList.length}` },
          ].map(m => (
            <button
              key={m.k}
              type="button"
              role="tab"
              aria-selected={eventsMode === m.k}
              data-testid={`events-mode-${m.k}`}
              onClick={() => setEventsMode(m.k)}
              style={{
                padding: '6px 12px', fontSize: 11, letterSpacing: '0.04em',
                border: 'none', cursor: 'pointer',
                background: eventsMode === m.k ? C.text : 'transparent',
                color: eventsMode === m.k ? C.bg : C.textSec,
                fontVariantNumeric: 'tabular-nums',
              }}
            >{m.label}</button>
          ))}
        </div>
      </div>

      {eventsMode === 'verified' ? (
        verifiedList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 16px', fontSize: 13, color: C.textMute }}>
            尚未累積已驗證事件
          </div>
        ) : (
          <div>
            {verifiedList.map(e => {
              const correct = e.correct === true;
              const wrong = e.correct === false;
              const tone = correct ? 'var(--cm-accent)' : C.textMute;
              const label = correct ? '命中' : (wrong ? '未中' : '未判定');
              const post = typeof e.postPct === 'number' ? `${e.postPct >= 0 ? '+' : ''}${e.postPct.toFixed(1)}%` : '';
              return (
                <div key={e.id} style={{
                  display: 'grid', gridTemplateColumns: '68px 1fr auto',
                  gap: 14, padding: '12px 0',
                  borderBottom: `1px solid ${C.border}`,
                  alignItems: 'baseline',
                }}>
                  <div style={{
                    fontFamily: "'Noto Serif TC', ui-serif, Georgia, serif",
                    fontSize: 14, color: C.text, fontVariantNumeric: 'tabular-nums',
                  }}>{e.date}</div>
                  <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                    {e.title || e.label}
                    {e.stocks && <span style={{ color: C.textMute, marginLeft: 8, fontSize: 11 }}>{e.stocks}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: tone, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {label}{post ? ` · ${post}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <UpcomingEventsBody
          isDemo={isDemo} navigate={navigate} startLineLogin={startLineLogin}
          C={C} alpha={alpha}
          TYPE_COLOR={TYPE_COLOR} RETRY_MAX={RETRY_MAX}
          calendarAutoStatus={calendarAutoStatus} predictAutoStatus={predictAutoStatus}
          calendarLoading={calendarLoading} predictingEvents={predictingEvents}
          calendarRetry={calendarRetry} predictRetry={predictRetry}
          calendarLastError={calendarLastError} predictLastError={predictLastError}
          calendarLastDebug={calendarLastDebug} predictLastDebug={predictLastDebug}
          setCalendarLastDebug={setCalendarLastDebug} setPredictLastDebug={setPredictLastDebug}
          debugPanelOpen={debugPanelOpen} setDebugPanelOpen={setDebugPanelOpen}
          updateLog={updateLog} setUpdateLog={setUpdateLog}
          updateLogOpen={updateLogOpen} setUpdateLogOpen={setUpdateLogOpen}
          classifyAttempt={classifyAttempt} deriveSuggestion={deriveSuggestion}
          holdings={holdings} newsEvents={newsEvents}
          H={H} CE={CE} filteredEvents={filteredEvents}
          filterType={filterType} setFilterType={setFilterType}
          calendarExpanded={calendarExpanded} setCalendarExpanded={setCalendarExpanded}
          manualRefreshCalendar={manualRefreshCalendar}
          runPredictEvents={runPredictEvents}
        />
      )}
    </>
  );
}

function UpcomingEventsBody({
  isDemo, navigate, startLineLogin,
  C, alpha,
  TYPE_COLOR, RETRY_MAX,
  calendarAutoStatus, predictAutoStatus,
  calendarLoading, predictingEvents,
  calendarRetry, predictRetry,
  calendarLastError, predictLastError,
  calendarLastDebug, predictLastDebug,
  setCalendarLastDebug, setPredictLastDebug,
  debugPanelOpen, setDebugPanelOpen,
  updateLog, setUpdateLog,
  updateLogOpen, setUpdateLogOpen,
  classifyAttempt, deriveSuggestion,
  holdings, newsEvents,
  H, CE, filteredEvents,
  filterType, setFilterType,
  calendarExpanded, setCalendarExpanded,
  manualRefreshCalendar,
  runPredictEvents,
}) {
  return (
    <>
          {/* §6.5：Demo 提示卡已移除 */}
          {/* 手動更新 + 自動更新狀態徽章（行事曆 + 預測） */}
          {(() => {
            const STATUS_LABEL = {
              fetching: { txt: '擷取中…', color: C.amber },
              throttled: { txt: '已節流（30 秒內已更新）', color: C.textMute },
              'skipped-idempotent': { txt: '已跳過（同批次進行中）', color: C.textMute },
              aborted: { txt: '已中斷舊請求', color: C.textMute },
              success: { txt: '完成', color: C.up },
              error: { txt: '失敗', color: C.amber },
            };

            const cal = STATUS_LABEL[calendarAutoStatus.status];
            const pre = STATUS_LABEL[predictAutoStatus.status];
            const calBusy = calendarAutoStatus.status === 'fetching' || calendarLoading;
            const preBusy = predictAutoStatus.status === 'fetching' || predictingEvents;
            const nowMs = Date.now();
            const calCool = Math.max(0, calendarRetry.cooldownUntil - nowMs);
            const preCool = Math.max(0, predictRetry.cooldownUntil - nowMs);
            const calRetryDisabled = calBusy || calCool > 0;
            const preRetryDisabled = preBusy || preCool > 0;
            const calCoolSec = Math.ceil(calCool / 1000);
            const preCoolSec = Math.ceil(preCool / 1000);
            const REASON_LABEL = { network: '網路', data: '資料', server: '伺服器', unknown: '未知' };
            const retryBtnStyle = (disabled) => ({
              padding:"2px 8px",fontSize:10,fontWeight:500,
              border:`1px solid ${alpha(C.amber, disabled?'33':'66')}`,borderRadius:4,
              background:alpha(C.amber, disabled?'08':'14'),
              color:disabled?C.textMute:C.amber,
              cursor:disabled?"not-allowed":"pointer",
              letterSpacing:"0.02em",
              opacity:disabled?0.6:1,
            });
            return (
              <div style={{marginBottom:10}}>
                {/* 手動按鈕列 */}
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                  <button
                    onClick={() => {
                      // demo 模式也允許測試行事曆更新
                      manualRefreshCalendar();
                    }}
                    disabled={calBusy || !holdings || holdings.length === 0 || calCool > 0}
                    style={{
                      padding:"5px 10px",fontSize:11,fontWeight:500,letterSpacing:"0.02em",
                      border:`1px solid ${alpha(C.textMute,'33')}`,borderRadius:6,
                      background:"transparent",color:(calBusy||calCool>0)?C.textMute:C.text,
                      cursor:calBusy||!holdings?.length||calCool>0?"not-allowed":"pointer",
                      opacity:calBusy||!holdings?.length||calCool>0?0.5:1,
                    }}
                  >{calBusy ? '更新中…' : (calCool>0 ? `冷卻中 ${calCoolSec}s` : '立刻更新行事曆')}</button>
                  <button
                    onClick={() => {
                      // demo 模式也允許測試事件預測
                      runPredictEvents(true);
                    }}
                    disabled={preBusy || !newsEvents || newsEvents.length === 0 || preCool > 0}
                    style={{
                      padding:"5px 10px",fontSize:11,fontWeight:500,letterSpacing:"0.02em",
                      border:`1px solid ${alpha(C.textMute,'33')}`,borderRadius:6,
                      background:"transparent",color:(preBusy||preCool>0)?C.textMute:C.text,
                      cursor:preBusy||!newsEvents?.length||preCool>0?"not-allowed":"pointer",
                      opacity:preBusy||!newsEvents?.length||preCool>0?0.5:1,
                    }}
                  >{preBusy ? '預測中…' : (preCool>0 ? `冷卻中 ${preCoolSec}s` : '立刻預測事件')}</button>

                </div>
                {/* 狀態徽章 */}
                {(cal || pre) && (
                  <div style={{
                    display:"flex",gap:8,flexWrap:"wrap",
                    padding:"6px 10px",background:alpha(C.textMute,'04'),
                    borderRadius:6,fontSize:11,fontWeight:500,letterSpacing:"0.02em",
                  }}>
                    {cal && (
                      <span style={{color:cal.color,display:"inline-flex",alignItems:"center",gap:6}}>
                        <span style={{opacity:0.6}}>行事曆</span>
                        <span>{cal.txt}{calendarAutoStatus.msg ? `・${calendarAutoStatus.msg}` : ''}</span>
                        {calendarAutoStatus.status === 'error' && (
                          <button
                            onClick={manualRefreshCalendar}
                            disabled={calRetryDisabled}
                            title={calBusy ? '正在更新中，請稍候' : (calCool>0 ? `冷卻中，${calCoolSec} 秒後可重試` : '重新嘗試擷取行事曆')}
                            style={retryBtnStyle(calRetryDisabled)}
                          >{calBusy ? '正在更新…' : (calCool>0 ? `${calCoolSec}s` : `重試 (${calendarRetry.count}/${RETRY_MAX})`)}</button>
                        )}
                      </span>
                    )}
                    {cal && pre && <span style={{color:C.textMute,opacity:0.3}}>·</span>}
                    {pre && (
                      <span style={{color:pre.color,display:"inline-flex",alignItems:"center",gap:6}}>
                        <span style={{opacity:0.6}}>事件預測</span>
                        <span>{pre.txt}{predictAutoStatus.msg ? `・${predictAutoStatus.msg}` : ''}</span>
                        {predictAutoStatus.status === 'error' && (
                          <button
                            onClick={() => runPredictEvents(true)}
                            disabled={preRetryDisabled}
                            title={preBusy ? '正在更新中，請稍候' : (preCool>0 ? `冷卻中，${preCoolSec} 秒後可重試` : '重新嘗試預測事件')}
                            style={retryBtnStyle(preRetryDisabled)}
                          >{preBusy ? '正在更新…' : (preCool>0 ? `${preCoolSec}s` : `重試 (${predictRetry.count}/${RETRY_MAX})`)}</button>
                        )}
                      </span>
                    )}
                  </div>
                )}
                {/* 失敗錯誤明細卡片 */}
                {(calendarLastError && calendarAutoStatus.status === 'error') && (
                  <div style={{
                    marginTop:6,padding:"8px 10px",
                    background:alpha(C.amber,'08'),
                    border:`1px solid ${alpha(C.amber,'33')}`,
                    borderRadius:6,fontSize:11,lineHeight:1.6,
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:3}}>
                      <span style={{color:C.amber,fontWeight:500}}>
                        行事曆 · {REASON_LABEL[calendarLastError.reason] || '未知'}類錯誤
                      </span>
                      <span style={{color:C.textMute,fontSize:10,opacity:0.7}}>
                        {new Date(calendarLastError.at).toLocaleTimeString('zh-TW',{hour12:false})}
                      </span>
                    </div>
                    <div style={{color:C.textMute,fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",fontSize:10,wordBreak:"break-word"}}>
                      {calendarLastError.message}
                    </div>
                    {calendarRetry.count >= RETRY_MAX && (
                      <div style={{marginTop:4,color:C.amber,fontSize:10,opacity:0.8}}>
                        已連續失敗 {calendarRetry.count} 次，{calCool>0 ? `將於 ${calCoolSec}s 後解除冷卻` : '可再次重試'}
                      </div>
                    )}
                  </div>
                )}
                {(predictLastError && predictAutoStatus.status === 'error') && (
                  <div style={{
                    marginTop:6,padding:"8px 10px",
                    background:alpha(C.amber,'08'),
                    border:`1px solid ${alpha(C.amber,'33')}`,
                    borderRadius:6,fontSize:11,lineHeight:1.6,
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:3}}>
                      <span style={{color:C.amber,fontWeight:500}}>
                        事件預測 · {REASON_LABEL[predictLastError.reason] || '未知'}類錯誤
                      </span>
                      <span style={{color:C.textMute,fontSize:10,opacity:0.7}}>
                        {new Date(predictLastError.at).toLocaleTimeString('zh-TW',{hour12:false})}
                      </span>
                    </div>
                    <div style={{color:C.textMute,fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",fontSize:10,wordBreak:"break-word"}}>
                      {predictLastError.message}
                    </div>
                    {predictRetry.count >= RETRY_MAX && (
                      <div style={{marginTop:4,color:C.amber,fontSize:10,opacity:0.8}}>
                        已連續失敗 {predictRetry.count} 次，{preCool>0 ? `將於 ${preCoolSec}s 後解除冷卻` : '可再次重試'}
                      </div>
                    )}
                  </div>
                )}
                {/* AI 模型嘗試明細（debug）：顯示 Gateway vs 直連 Gemini 各模型的 HTTP 狀態與錯誤節錄 */}
                {(predictLastDebug || calendarLastDebug) && (
                  <div style={{
                    marginTop:6,
                    border:`1px solid ${alpha(C.textMute,'1a')}`,
                    borderRadius:6,
                    background:alpha(C.textMute,'04'),
                    fontSize:11,
                  }}>
                    <button
                      onClick={() => setDebugPanelOpen(o => !o)}
                      style={{
                        display:"flex",alignItems:"center",justifyContent:"space-between",
                        width:"100%",padding:"6px 10px",
                        background:"transparent",border:"none",
                        cursor:"pointer",color:C.textMute,fontSize:11,
                      }}
                    >
                      <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                        <span style={{opacity:0.6}}>AI 模型嘗試明細</span>
                        <span style={{opacity:0.5}}>
                          ({(predictLastDebug?.attempts?.length || 0) + (calendarLastDebug?.attempts?.length || 0)})
                        </span>
                      </span>
                      <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setPredictLastDebug(null); setCalendarLastDebug(null); }}
                          style={{fontSize:10,color:C.textMute,opacity:0.6,cursor:"pointer"}}
                        >清除</span>
                        <span style={{opacity:0.5}}>{debugPanelOpen ? '▾' : '▸'}</span>
                      </span>
                    </button>
                    {debugPanelOpen && (
                      <div style={{padding:"4px 10px 10px",borderTop:`1px solid ${alpha(C.textMute,'14')}`}}>
                        {[
                          { label: '事件預測', dbg: predictLastDebug, source: 'predict' },
                          { label: '行事曆', dbg: calendarLastDebug, source: 'calendar' },
                        ].filter(x => x.dbg).map(({ label, dbg, source }) => {
                          const suggestion = deriveSuggestion(dbg.attempts || [], source);
                          // 統計各分類數量
                          const buckets = {};
                          (dbg.attempts || []).forEach(a => {
                            const k = classifyAttempt(a);
                            if (k.kind === 'ok') return;
                            buckets[k.label] = (buckets[k.label] || 0) + 1;
                          });
                          const bucketEntries = Object.entries(buckets);
                          return (
                          <div key={label} style={{marginTop:8}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.textMute,marginBottom:4}}>
                              <span style={{fontWeight:500,color:C.text}}>{label}</span>
                              <span style={{opacity:0.7}}>
                                HTTP {dbg.httpStatus} · {new Date(dbg.at).toLocaleTimeString('zh-TW',{hour12:false})}
                              </span>
                            </div>
                            {dbg.succeededWith && (
                              <div style={{fontSize:10,color:C.up,marginBottom:4,opacity:0.85}}>
                                成功：{dbg.succeededWith.path} / {dbg.succeededWith.model}
                              </div>
                            )}
                            {/* 分類 chips */}
                            {bucketEntries.length > 0 && (
                              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:4}}>
                                {bucketEntries.map(([lbl, cnt]) => (
                                  <span key={lbl} style={{
                                    fontSize:10,padding:"2px 6px",borderRadius:10,
                                    background:alpha(C.textMute,'10'),color:C.textMute,
                                  }}>{lbl} ×{cnt}</span>
                                ))}
                              </div>
                            )}
                            {/* 建議 + 重試規則 + cURL */}
                            {suggestion && (
                              <div style={{
                                marginBottom:6,padding:"6px 8px",borderRadius:4,
                                background:alpha(suggestion.tone === 'amber' ? C.amber : C.down, '10'),
                                color: suggestion.tone === 'amber' ? C.amber : C.down,
                              }}>
                                <div style={{fontSize:10,lineHeight:1.5}}>{suggestion.text}</div>
                                {/* 規則表 */}
                                <div style={{
                                  marginTop:6,display:"grid",
                                  gridTemplateColumns:"auto 1fr",columnGap:8,rowGap:2,
                                  fontSize:10,color:C.textMute,
                                }}>
                                  <span style={{opacity:0.7}}>最多重試</span>
                                  <span>{suggestion.policy.maxRetries} 次</span>
                                  <span style={{opacity:0.7}}>建議等待</span>
                                  <span>{suggestion.policy.waitSec > 0 ? `${suggestion.policy.waitSec}s` : '不需等待'}</span>
                                  <span style={{opacity:0.7}}>切換直連</span>
                                  <span>{suggestion.policy.switchPath === 'yes' ? '立即切換' : suggestion.policy.switchPath === 'optional' ? '可選' : '無助於修復'}</span>
                                  <span style={{opacity:0.7}}>策略</span>
                                  <span>{suggestion.policy.desc}</span>
                                </div>
                                {/* cURL 範例 */}
                                <div style={{marginTop:6}}>
                                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                                    <span style={{fontSize:10,opacity:0.7,color:C.textMute}}>可複製的請求範例</span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        const btn = e.currentTarget;
                                        try {
                                          navigator.clipboard?.writeText(suggestion.curl);
                                          const orig = btn.textContent;
                                          btn.textContent = '已複製';
                                          setTimeout(() => { btn.textContent = orig; }, 1500);
                                        } catch { /* noop */ }
                                      }}
                                      style={{
                                        fontSize:10,padding:"2px 8px",borderRadius:3,
                                        border:`1px solid ${alpha(C.textMute,'30')}`,
                                        background:"transparent",color:C.textMute,cursor:"pointer",
                                      }}
                                    >複製</button>
                                  </div>
                                  <pre style={{
                                    margin:0,padding:6,borderRadius:3,
                                    background:alpha(C.textMute,'10'),color:C.text,
                                    fontSize:10,lineHeight:1.4,
                                    fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",
                                    whiteSpace:"pre-wrap",wordBreak:"break-all",
                                    maxHeight:120,overflow:"auto",
                                  }}>{suggestion.curl}</pre>
                                </div>
                              </div>
                            )}
                            <div style={{display:"flex",flexDirection:"column",gap:3}}>
                              {(dbg.attempts || []).map((a, i) => {
                                const cls = classifyAttempt(a);
                                const statusColor = cls.tone === 'up' ? C.up : (cls.tone === 'amber' ? C.amber : C.down);
                                return (
                                  <div key={i} style={{
                                    display:"grid",
                                    gridTemplateColumns:"auto auto auto 1fr",
                                    gap:6,alignItems:"start",
                                    padding:"4px 6px",
                                    borderRadius:4,
                                    background:alpha(statusColor,'08'),
                                    fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",
                                    fontSize:10,
                                  }}>
                                    <span style={{color:statusColor,fontWeight:600}}>
                                      {a.ok ? 'OK' : 'ERR'} {a.status ?? '—'}
                                    </span>
                                    <span style={{color:statusColor,opacity:0.85,whiteSpace:"nowrap"}}>
                                      {cls.label}
                                    </span>
                                    <span style={{color:C.textMute}}>
                                      {a.path === 'gateway' ? 'Gateway' : '直連'} · {a.model}
                                    </span>
                                    <span style={{color:C.textMute,opacity:0.85,wordBreak:"break-word"}}>
                                      {a.errorBody || a.errorMessage || (a.ok ? '' : '—')}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {/* 更新日誌（除錯用）：可摺疊 */}
                {updateLog.length > 0 && (
                  <div style={{
                    marginTop:6,
                    border:`1px solid ${alpha(C.textMute,'1a')}`,
                    borderRadius:6,
                    background:alpha(C.textMute,'04'),
                    fontSize:11,
                  }}>
                    <button
                      onClick={() => setUpdateLogOpen(o => !o)}
                      style={{
                        display:"flex",alignItems:"center",justifyContent:"space-between",
                        width:"100%",padding:"6px 10px",
                        background:"transparent",border:"none",
                        cursor:"pointer",color:C.textMute,fontSize:11,
                      }}
                    >
                      <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                        <span style={{opacity:0.6}}>更新日誌</span>
                        <span style={{opacity:0.5}}>({updateLog.length})</span>
                      </span>
                      <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
                        {updateLog.length > 0 && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); setUpdateLog([]); }}
                            style={{fontSize:10,color:C.textMute,opacity:0.6,cursor:"pointer"}}
                          >清除</span>
                        )}
                        <span style={{opacity:0.5}}>{updateLogOpen ? '▾' : '▸'}</span>
                      </span>
                    </button>
                    {updateLogOpen && (
                      <div style={{
                        maxHeight:240,overflowY:"auto",
                        borderTop:`1px solid ${alpha(C.textMute,'14')}`,
                        padding:"4px 0",
                      }}>
                        {updateLog.map(entry => {
                          const STATUS_COLOR = {
                            fetching: C.amber,
                            success: C.up,
                            error: C.amber,
                            throttled: C.textMute,
                            'skipped-idempotent': C.textMute,
                            skipped: C.textMute,
                            cooldown: C.amber,
                            aborted: C.textMute,
                          };
                          const sc = STATUS_COLOR[entry.status] || C.text;
                          const ts = new Date(entry.ts).toLocaleTimeString('zh-TW',{hour12:false});
                          return (
                            <div
                              key={entry.id}
                              style={{
                                display:"grid",
                                gridTemplateColumns:"minmax(48px,60px) minmax(44px,56px) minmax(44px,56px) minmax(0,1fr)",
                                gap:6,padding:"3px 10px",
                                fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace",
                                fontSize:10,lineHeight:1.5,
                                borderBottom:`1px dotted ${alpha(C.textMute,'10')}`,
                              }}
                              title={`key: ${entry.key}`}
                            >
                              <span style={{color:C.textMute,opacity:0.7}}>{ts}</span>
                              <span style={{color:C.textMute}}>
                                {entry.source === 'calendar' ? '行事曆' : entry.source === 'predict' ? '事件預測' : entry.source === 'daily' ? '收盤分析' : entry.source}
                              </span>
                              <span style={{color:entry.trigger==='manual'?C.text:C.textMute,opacity:entry.trigger==='manual'?0.9:0.6}}>
                                {entry.trigger === 'manual' ? '手動' : entry.trigger === 'retry' ? '重試' : '自動'}
                              </span>
                              <span style={{display:"flex",gap:6,minWidth:0}}>
                                <span style={{color:sc,fontWeight:500,whiteSpace:"nowrap"}}>{entry.status}</span>
                                <span style={{color:C.textMute,opacity:0.7,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                                  {entry.msg}
                                </span>
                                <span style={{color:C.textMute,opacity:0.4,marginLeft:"auto",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:140}}>
                                  {entry.key && entry.key !== '(n/a)' ? `key:${String(entry.key).slice(0,18)}${String(entry.key).length>18?'…':''}` : ''}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {calendarLoading ? (
            <div style={{textAlign:"center",padding:"36px 16px"}}>
              <div style={{fontSize:13,color:C.textMute,fontWeight:400}}>
                正在根據持倉產生行事曆...
              </div>
            </div>
          ) : H.length === 0 && CE.length === 0 ? (
            <div style={{padding:"36px 0",borderTop:`1px solid ${alpha(C.textMute,'20')}`,borderBottom:`1px solid ${alpha(C.textMute,'20')}`}}>
              <div style={{fontSize:13,color:C.textMute,fontWeight:400,letterSpacing:"0.04em"}}>尚無行事曆事件</div>
              <div style={{fontSize:12,color:C.textMute,marginTop:6,lineHeight:1.7,opacity:0.7}}>
                上傳成交截圖後，相關股票的財報、法說、催化事件會自動列出。
              </div>
            </div>
          ) : <>
            <div style={{display:"flex",gap:0,flexWrap:"wrap",marginBottom:12,alignItems:"center",borderBottom:`1px solid ${alpha(C.textMute,'15')}`,paddingBottom:6}}>
              {["全部",...Object.keys(TYPE_COLOR)].map(t=>{
                const active = filterType===t;
                return (
                  <button key={t} onClick={()=>{setFilterType(t);setCalendarExpanded(false);}} style={{
                    background: "transparent",
                    color: active ? C.text : C.textMute,
                    border:"none",
                    borderBottom:`1px solid ${active ? C.text : "transparent"}`,
                    padding:"4px 10px",fontSize:12,fontWeight:400,cursor:"pointer",letterSpacing:"0.04em",
                  }}>{t}</button>
                );
              })}
              {/* 重新產生按鈕已移除，行事曆只抓一次 */}
            </div>

            {filteredEvents.length === 0 ? (
              <div style={{textAlign:"center",padding:"24px 16px"}}>
                <div style={{fontSize:12,color:C.textMute,fontWeight:400}}>此分類暫無事件</div>
              </div>
            ) : (() => {
              const COLLAPSE_LIMIT = 10;
              const shouldCollapse = filteredEvents.length > COLLAPSE_LIMIT && !calendarExpanded;
              const visibleEvents = shouldCollapse ? filteredEvents.slice(0, COLLAPSE_LIMIT) : filteredEvents;
              return <>
                {visibleEvents.map((e,i)=>{
                  const globalIdx = CE.indexOf(e);
                  return <div key={i} style={{marginBottom:0,padding:"10px 0",
                    borderBottom:`1px solid ${alpha(C.textMute,'06')}`}}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <div style={{minWidth:48}}>
                        <div style={{
                          color: e.urgent ? C.up : C.textMute,
                          fontSize:11,fontWeight:400,
                          textAlign:"center",marginBottom:3}}>{e.type}</div>
                        <div style={{fontSize:11,color:C.textMute,textAlign:"center",lineHeight:1.4,opacity:0.6}}>{e.date}</div>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:500,color:e.urgent?C.up:C.text}}>{e.label}</div>
                        <div style={{fontSize:12,color:C.textMute,marginTop:3,lineHeight:1.6}}>{e.sub}</div>
                      </div>
                      {(() => {
                        const today = new Date();
                        today.setHours(0,0,0,0);
                        const evDate = e.date ? new Date(e.date.replace(/\//g, "-")) : null;
                        if (evDate) evDate.setHours(0,0,0,0);
                        const isPast = evDate && evDate < today;
                        if (isPast) {
                          return <span style={{fontSize:12,fontWeight:500,color:C.olive,whiteSpace:"nowrap",alignSelf:"center"}}>已發生 · 復盤</span>;
                        } else {
                          return <span style={{fontSize:12,fontWeight:500,color:C.textMute,whiteSpace:"nowrap",alignSelf:"center"}}>待驗證</span>;
                        }
                      })()}
                    </div>
                  </div>;
                })}
                {filteredEvents.length > COLLAPSE_LIMIT && (
                  <button onClick={()=>setCalendarExpanded(!calendarExpanded)} style={{
                    width:"100%",padding:"10px 0",border:"none",borderTop:`1px solid ${alpha(C.textMute,'15')}`,
                    background:"transparent",color:C.text,fontSize:12,fontWeight:400,cursor:"pointer",
                    marginTop:4,letterSpacing:"0.04em",
                  }}>
                    {calendarExpanded ? "收合" : `展開其餘 ${filteredEvents.length - COLLAPSE_LIMIT} 則事件 →`}
                  </button>
                )}
              </>;
            })()}
          </>}
    </>
  );
}

const EventsTab = React.memo(EventsTabImpl);
EventsTab.displayName = 'EventsTab';
export default EventsTab;
