import React, { useEffect } from 'react';
import { validateProps } from '@/checkup/lib/validateProps.js';
import { trackPaywall } from '@/lib/paywallTracking';
import { markUserOwnedHolding } from '@/pages/_freeCheckup/constants';
import BatchParsePanel from './BatchParsePanel';




/**
 * Props schema 與 EVENTS_TAB_PROP_SCHEMA 同款 dev-time 守門。
 * 任何 prop 增刪必須同步本表，否則 freecheckup-tab-prop-schema.test.ts 會擋。
 */
const TRADE_TAB_PROP_SCHEMA = {
  C: 'object',
  alpha: 'function',
  card: 'object',
  lbl: 'object',
  parsing: 'boolean',
  parseStep: 'string',
  parseErr: { type: 'string', optional: true },
  parsed: { type: 'object', optional: true },
  setParsed: 'function',
  img: { type: 'string', optional: true },
  dragOver: 'boolean',
  setDragOver: 'function',
  processFile: 'function',
  processFiles: { type: 'function', optional: true },
  parseShot: 'function',
  batchState: { type: 'object', optional: true },
  cancelBatch: { type: 'function', optional: true },
  retryBatchFailures: { type: 'function', optional: true },
  restoreBatchItemPreview: { type: 'function', optional: true },
  setImg: 'function',
  setB64: 'function',
  setParseErr: 'function',
  isDemo: 'boolean',
  startLineLogin: { type: 'function', optional: true },
  hasReachedDailyLimit: 'boolean',
  tier: { type: 'string', optional: true },
  quota: { type: 'object', optional: true },
  formatResetDateTime: 'function',
  formatResetCountdown: 'function',
  holdings: 'array',
  setHoldings: 'function',
  setTradeLog: 'function',
  setUploadSummary: 'function',
  holdingsChangedByUserRef: 'object',
  stripDemoSeedHoldings: 'function',
  mergeTradeIntoHoldings: 'function',
  upsertSnapshotHolding: 'function',
  SNAPSHOT_IMPORT_ACTION: 'string',
  MAX_HOLDINGS: 'number',
  toast: 'function',
  setTab: 'function',
  memoAns: { type: 'object', optional: true },
  memoIn: 'string',
  setMemoIn: 'function',
  memoStep: 'number',
  qs: 'array',
  submitMemo: 'function',
  tpCode: 'string',
  setTpCode: 'function',
  tpFirm: 'string',
  setTpFirm: 'function',
  tpVal: 'string',
  setTpVal: 'function',
  setTargets: 'function',
  setSaved: 'function',
};

/**
 * TradeTab — Free Checkup「上傳成交」tab。
 * 抽自 FreeCheckup.jsx L3489-L3980（Phase A2-4 容器拆分，2026-05）。
 *
 * 規範對齊（mem://architecture/checkup/inline-rendering-audit）：
 * - 純展示 + 表單 state 全來自 props
 * - 不含 Hero / .wb-card / L2965/L4745 字面 `<style>` 字串硬合約
 * - 唯一 `<style>` 為 spinner `@keyframes`，與 L2965/L4745 無關
 * - 所有 setter / helper（mergeTradeIntoHoldings、upsertSnapshotHolding、
 *   stripDemoSeedHoldings、formatResetDateTime …）由 caller 注入，
 *   保證行為與原檔一致
 */
function TradeTabImpl({
  // 共用 design tokens
  C, alpha, card, lbl,
  // 解析狀態
  parsing, parseStep, parseErr, parsed, setParsed,
  img, dragOver, setDragOver,
  processFile, processFiles, parseShot,
  batchState, cancelBatch, retryBatchFailures, restoreBatchItemPreview,
  setImg, setB64, setParseErr,
  // demo / 配額
  isDemo, startLineLogin,
  hasReachedDailyLimit, tier, quota,
  formatResetDateTime, formatResetCountdown,
  // 持倉 / 交易紀錄
  holdings, setHoldings, setTradeLog,
  setUploadSummary, holdingsChangedByUserRef,
  stripDemoSeedHoldings, mergeTradeIntoHoldings, upsertSnapshotHolding,
  SNAPSHOT_IMPORT_ACTION, MAX_HOLDINGS,
  toast, setTab,
  // 備忘錄
  memoAns, memoIn, setMemoIn, memoStep, qs, submitMemo,
  // 手動目標價
  tpCode, setTpCode, tpFirm, setTpFirm, tpVal, setTpVal,
  setTargets, setSaved,
}) {
  validateProps('TradeTab', arguments[0], TRADE_TAB_PROP_SCHEMA);
  // W4-4: 配額用盡 banner 出現時送 view + hit_limit
  useEffect(() => {
    if (hasReachedDailyLimit && !isDemo) {
      trackPaywall('view', 'trade_tab_limit', { tier });
      trackPaywall('hit_limit', 'trade_tab_limit', { tier });
    }
  }, [hasReachedDailyLimit, isDemo, tier]);
  return (
    <>
      {/* 批次解析狀態（必須在 overlay/!parsed 之外，否則批次中按鈕被遮罩擋住無法點） */}
      <BatchParsePanel
        C={C}
        batchState={batchState}
        cancelBatch={cancelBatch}
        retryBatchFailures={retryBatchFailures}
        restoreBatchItemPreview={restoreBatchItemPreview}
        variant="trade"
      />
      {/* 全頁覆蓋 loading：解析中時鎖住操作但保留下方持倉資料可見於背景 */}
      {parsing && (
        <div
          role="status"
          aria-live="polite"
          aria-label="解析中"
          style={{
            position:"fixed", inset:0, zIndex:9999,
            background:"rgba(245,243,239,0.88)",
            backdropFilter:"blur(2px)", WebkitBackdropFilter:"blur(2px)",
            display:"flex", alignItems:"center", justifyContent:"center",
            padding:"24px",
          }}
        >
          <div style={{
            background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
            padding:"22px 24px", maxWidth:340, width:"100%", textAlign:"center",
          }}>
            <div style={{
              width:36, height:36, margin:"0 auto 14px",
              border:`2px solid ${alpha(C.textMute,'30')}`,
              borderTopColor:C.text, borderRadius:"50%",
              animation:"checkup-spin 0.9s linear infinite",
            }}/>
            <div style={{fontSize:14,fontWeight:500,color:C.text,marginBottom:6,letterSpacing:"0.02em"}}>
              {parseStep?.label || "AI 解析中"}
            </div>
            {parseStep?.detail && (
              <div style={{fontSize:12,color:C.textMute,lineHeight:1.6,marginBottom:10}}>{parseStep.detail}</div>
            )}
            {typeof parseStep?.progress === "number" && (
              <div style={{height:3,background:alpha(C.textMute,'22'),borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${parseStep.progress}%`,background:C.amber,transition:"width 360ms ease"}}/>
              </div>
            )}
            <div style={{fontSize:10,color:C.textMute,marginTop:12,letterSpacing:"0.06em"}}>
              原持倉資料保留中，新資料完成後才會更新
            </div>
          </div>
          <style>{`@keyframes checkup-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* Demo 模式提示 */}
      {isDemo && (
        <div style={{marginBottom:16, padding:"20px 16px", background:alpha(C.amber,'06'), borderRadius:10, textAlign:"center"}}>
          <div style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:6,letterSpacing:"0.02em"}}>
            上傳成交需要先登入
          </div>
          <div style={{fontSize:12,color:C.textMute,marginBottom:14,lineHeight:1.6}}>
            透過 LINE 快速登入，即可免費使用 AI 健檢功能（每日一次）
          </div>
          <button onClick={startLineLogin} style={{
            background:C.text, color:C.bg, border:"none",
            borderRadius:4, padding:"10px 24px", fontSize:13, fontWeight:500,
            cursor:"pointer", letterSpacing:"0.02em",
          }}>
            使用 LINE 快速登入
          </button>
        </div>
      )}
      {/* 收盤分析配額用盡 — 僅作為「分析」資訊提示，**不阻擋成交上傳** */}
      {hasReachedDailyLimit && !isDemo && (
        <div style={{
          marginBottom:16, padding:"14px 16px",
          background:alpha(C.blue,'04'), border:`1px solid ${alpha(C.blue,'20')}`,
          borderRadius:10,
        }}>
          <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:6,letterSpacing:"0.02em"}}>
            {tier === 'none'      && '收盤分析為訂閱功能（不影響成交上傳）'}
            {tier === 'line_free' && 'LINE 註冊禮 1 次收盤分析已用完（不影響成交上傳）'}
            {tier === 'free'      && '本月 1 次收盤分析已用完（不影響成交上傳）'}
            {tier === 'basic'     && '本週 1 次收盤分析已用完（不影響成交上傳）'}
            {tier === 'pro'       && '本月 22 次收盤分析已用完（不影響成交上傳）'}
          </div>
          <div style={{fontSize:11,color:C.textMute,lineHeight:1.7}}>
            {tier !== 'none' && tier !== 'line_free' && (
              <>
                重置時間：<span style={{color:C.textSec}}>{formatResetDateTime(quota?.resets_at) || '—'}</span>
                ・<span style={{opacity:0.85}}>{formatResetCountdown(quota?.resets_at)}</span>
              </>
            )}
            {tier === 'none'      && <>仍可繼續上傳成交、建立持倉。訂閱後即可使用 AI 收盤分析。</>}
            {tier === 'line_free' && <>仍可繼續上傳成交、建立持倉。升級訂閱方案後可繼續使用 AI 收盤分析。</>}
          </div>
          {(tier === 'free' || tier === 'basic' || tier === 'line_free' || tier === 'none') && (
            <a href={tier === 'basic' ? '/app/account' : '/pricing#checkup'} onClick={() => trackPaywall('click_upgrade', 'trade_tab_limit', { tier })} style={{
              display:"inline-block", marginTop:8,
              background:"transparent", color:C.blue,
              border:`1px solid ${alpha(C.blue,'40')}`,
              borderRadius:8, padding:"6px 14px", fontSize:11, fontWeight:500,
              textDecoration:"none", letterSpacing:"0.02em",
            }}>
              {tier === 'basic' ? '立即續訂 / 升級' : '查看訂閱方案'} →
            </a>
          )}
        </div>
      )}
      {!parsed && !isDemo && (

        <>
          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{
              e.preventDefault();setDragOver(false);
              const files = Array.from(e.dataTransfer.files || []);
              if (files.length > 1 && processFiles) processFiles(files);
              else if (files[0]) processFile(files[0]);
            }}
            onClick={()=>document.getElementById("fi").click()}
            style={{border:`1px dashed ${dragOver?C.blue:C.border}`,
              borderRadius:12,padding:"28px 16px",textAlign:"center",cursor:"pointer",
              background:dragOver?C.subtle:C.card,marginBottom:12,transition:"all 0.2s"}}>
            <input id="fi" type="file" accept="image/*" multiple
              onChange={e=>{
                const files = Array.from(e.target.files || []);
                if (files.length > 1 && processFiles) processFiles(files);
                else if (files[0]) processFile(files[0]);
                // reset 讓使用者可重複選同一批檔案
                e.target.value = '';
              }} style={{display:"none"}}/>
            {img ? (
              <><img src={img} alt="" style={{maxHeight:200,maxWidth:"100%",
                borderRadius:8,objectFit:"contain",marginBottom:8}}/>
              <div style={{fontSize:13,color:C.textMute}}>點擊更換截圖（可一次選多張批次解析）</div></>
            ) : (
              <><div style={{fontSize:32,marginBottom:10,opacity:0.5}}>↑</div> {/* rwd-allow:純裝飾箭頭非數字 */}
              <div style={{fontSize:15,fontWeight:500,color:C.textSec}}>上傳已成交截圖（支援多張批次解析）</div>
              <div style={{fontSize:13,color:C.textMute,marginTop:4}}>截圖需要包含代碼、名稱、股數、市價、成本、成本價、手續費</div>
              <div style={{fontSize:11,color:C.textMute,marginTop:6,letterSpacing:'0.04em'}}>持倉上限 {MAX_HOLDINGS} 檔（目前 {(holdings || []).length} 檔）・一次最多選 10 張</div></>
            )}
          </div>
          {img && (
            <button onClick={parseShot} disabled={parsing} style={{
              width:"100%",padding:"13px",borderRadius:10,
              background: parsing ? C.subtle : C.cardHover,
              color: parsing ? C.textMute : C.text,
              border: `1px solid ${parsing ? C.border : alpha(C.amber,'66')}`,
              fontSize:15, fontWeight:500, cursor:parsing?"not-allowed":"pointer",
              letterSpacing:"0.02em"}}>
              {parsing ? "解析中..." : "解析這筆交易"}
            </button>
          )}
          {parseStep && (
            <div style={{
              marginTop:10, background:C.subtle,
              border:`1px solid ${parseStep.stage==='error'?alpha(C.down,'55'):parseStep.stage==='done'?alpha(C.olive,'55'):C.border}`,
              borderRadius:10, padding:'10px 12px',
            }}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:500,letterSpacing:'0.04em',color:parseStep.stage==='error'?C.down:parseStep.stage==='done'?C.olive:C.text}}>
                  {parseStep.stage==='upload' && '1 · '}
                  {parseStep.stage==='ai' && '2 · '}
                  {parseStep.stage==='retry' && '2 · '}
                  {parseStep.stage==='persist' && '3 · '}
                  {parseStep.stage==='refresh' && '4 · '}
                  {parseStep.stage==='done' && '完成 · '}
                  {parseStep.stage==='error' && '失敗 · '}

                  {parseStep.label}
                </span>
                <span style={{fontSize:11,color:C.textMute,fontVariantNumeric:'tabular-nums'}}>{parseStep.progress}%</span>
              </div>
              <div style={{height:3,background:alpha(C.textMute,'22'),borderRadius:2,overflow:'hidden'}}>
                <div style={{
                  height:'100%',width:`${parseStep.progress}%`,
                  background: parseStep.stage==='error'?C.down:parseStep.stage==='done'?C.olive:C.amber,
                  transition:'width 360ms ease',
                }}/>
              </div>
              {parseStep.detail && (
                <div style={{marginTop:6,fontSize:11,color:C.textMute,letterSpacing:'0.02em'}}>{parseStep.detail}</div>
              )}
            </div>
          )}
          {parseErr && <div style={{marginTop:10, background:C.upBg,
            border:`1px solid ${alpha(C.up,'44')}`, borderRadius:10,
            padding:12, fontSize:14, color:C.up}}>
            {parseErr}
          </div>}
        </>
      )}

      {parsed?.trades?.length>0 && (() => {
        // 欄位驗證：必填 + 格式檢查
        const validateRow = (t) => {
          const errs = {};
          const code = String(t?.code || "").trim();
          const name = String(t?.name || "").trim();
          const qty = Number(t?.qty);
          const price = Number(t?.price);
          const action = String(t?.action || "").trim();
          if (!name) errs.name = "請填寫股票名稱";
          if (!code) errs.code = "請填寫代碼";
          else if (!/^[0-9A-Za-z]{2,8}$/.test(code)) errs.code = "代碼格式不正確（2–8 位數字/字母）";
          if (!Number.isFinite(qty) || qty <= 0) errs.qty = "股數需為正整數";
          else if (!Number.isInteger(qty)) errs.qty = "股數需為整數";
          if (!Number.isFinite(price) || price <= 0) errs.price = "成交價需大於 0";
          if (action !== "買進" && action !== "賣出" && action !== SNAPSHOT_IMPORT_ACTION) errs.action = "請選擇買進或賣出";
          return errs;
        };
        const rowErrors = parsed.trades.map(validateRow);
        const totalErrCount = rowErrors.reduce((acc, e) => acc + Object.keys(e).length, 0);
        const hasError = totalErrCount > 0;

        const applyCorrections = () => {
          if (hasError) {
            toast.error("仍有欄位未通過驗證", { description: `共 ${totalErrCount} 個欄位需要修正` });
            return;
          }
          const trades = parsed.trades.map(t => ({
            ...t,
            code: String(t.code).trim(),
            name: String(t.name).trim(),
            qty: Number(t.qty),
            price: Number(t.price),
            action: String(t.action || "買進").trim(),
          }));
          const isSnap = trades.every(t => t.action === SNAPSHOT_IMPORT_ACTION);
          const prevCodeSet = new Set((holdings || []).map(h => h.code));
          const summaryAdded = [];
          const summaryUpdated = [];
          trades.forEach(t => {
            const item = { code: t.code, name: t.name, qty: t.qty, price: t.price, action: t.action };
            if (prevCodeSet.has(t.code)) summaryUpdated.push(item); else summaryAdded.push(item);
          });
          holdingsChangedByUserRef.current = true;
          setHoldings(prev => trades.reduce(
            (acc, trade) => isSnap ? upsertSnapshotHolding(acc, trade) : mergeTradeIntoHoldings(acc, trade),
            stripDemoSeedHoldings(prev || []),
          ).map(markUserOwnedHolding));
          setTradeLog(prev => {
            const existing = prev || [];
            const newEntries = trades.map(t => ({
              id: Date.now() + Math.random(),
              date: t.date || new Date().toLocaleDateString("zh-TW"),
              time: t.time || new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"}),
              action: t.action === SNAPSHOT_IMPORT_ACTION ? "匯入" : t.action,
              code: t.code, name: t.name, qty: t.qty, price: t.price,
              qa: [],
            }));
            return [...newEntries, ...existing];
          });
          setUploadSummary({ added: summaryAdded, updated: summaryUpdated, at: Date.now(), corrected: true });
          toast.success(`已套用修正：${trades.length} 筆`, { description: `新增 ${summaryAdded.length}・更新 ${summaryUpdated.length}` });
          setImg(null); setB64(null); setParsed(null); setParseErr(null);
          setTab("holdings");
          setTimeout(() => setUploadSummary(s => (s && Date.now() - s.at >= 11000) ? null : s), 12000);
        };

        return (
        <div>
            <div style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
              <div style={{fontSize:11,color:C.textMute,fontWeight:400,letterSpacing:"0.1em"}}>解析結果</div>
              <div style={{fontSize:10,color: hasError ? C.down : C.textMute}}>
                {hasError ? `尚有 ${totalErrCount} 個欄位需修正` : "點擊欄位可修正"}
              </div>
            </div>
            {parsed.trades.map((t,i)=>{
              const updateTrade = (patch) => setParsed(prev => {
                const trades = [...(prev?.trades || [])];
                trades[i] = { ...trades[i], ...patch };
                return { ...prev, trades };
              });
              const removeTrade = () => setParsed(prev => {
                const trades = (prev?.trades || []).filter((_, idx) => idx !== i);
                return { ...prev, trades };
              });
              const isBuy = t.action === "買進";
              const errs = rowErrors[i] || {};
              const hasRowErr = Object.keys(errs).length > 0;
              const baseCell = {
                background: "transparent",
                border: "none",
                color: C.text,
                fontSize: 13,
                fontFamily: "inherit",
                padding: "2px 4px",
                outline: "none",
                minWidth: 0,
              };
              const cellWith = (field, extra = {}) => ({
                ...baseCell,
                borderBottom: `1px ${errs[field] ? 'solid' : 'dashed'} ${errs[field] ? C.down : alpha(C.textMute, '55')}`,
                background: errs[field] ? alpha(C.down, '08') : 'transparent',
                ...extra,
              });
              return (
                <div key={i} style={{padding:"12px 0",
                  borderBottom:i<parsed.trades.length-1?`1px solid ${alpha(C.textMute,'08')}`:"none",
                  background: hasRowErr ? alpha(C.down, '04') : 'transparent',
                  borderLeft: hasRowErr ? `2px solid ${alpha(C.down, '88')}` : '2px solid transparent',
                  paddingLeft: 8,
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                    <button
                      onClick={() => updateTrade({ action: isBuy ? "賣出" : "買進" })}
                      aria-label={`切換為${isBuy ? "賣出" : "買進"}`}
                      style={{
                        background: isBuy ? alpha(C.up, '12') : alpha(C.down, '12'),
                        color: isBuy ? C.up : C.down,
                        fontSize: 11, fontWeight: 500,
                        padding: "3px 10px", borderRadius: 4,
                        border: `1px ${errs.action ? 'solid' : 'dashed'} ${errs.action ? C.down : (isBuy ? alpha(C.up, '55') : alpha(C.down, '55'))}`,
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >{t.action || "買進"} ↔</button>
                    <input
                      value={t.name || ""}
                      onChange={e => updateTrade({ name: e.target.value })}
                      aria-label="股票名稱"
                      aria-invalid={!!errs.name}
                      style={{...cellWith('name'), fontWeight: 500, flex: "1 1 90px"}}
                    />
                    <input
                      value={t.code || ""}
                      onChange={e => updateTrade({ code: e.target.value })}
                      aria-label="股票代碼"
                      aria-invalid={!!errs.code}
                      inputMode="numeric"
                      style={{...cellWith('code'), color: errs.code ? C.down : C.textMute, fontSize: 11, width: 64}}
                    />
                    <button
                      onClick={removeTrade}
                      aria-label={`刪除第 ${i+1} 筆`}
                      style={{
                        background: "transparent", border: "none",
                        color: C.textMute, fontSize: 16, cursor: "pointer",
                        padding: "0 4px", lineHeight: 1,
                      }}
                    >×</button>
                  </div>
                  <div style={{display:"flex",alignItems:"baseline",gap:6,fontSize:13,color:C.textMute}}>
                    <input
                      type="number"
                      value={t.qty ?? ""}
                      onChange={e => updateTrade({ qty: e.target.value === "" ? "" : Number(e.target.value) })}
                      aria-label="股數"
                      aria-invalid={!!errs.qty}
                      inputMode="numeric"
                      style={{...cellWith('qty'), width: 70, textAlign: "right"}}
                    />
                    <span>股 @</span>
                    <input
                      type="number"
                      step="0.01"
                      value={t.price ?? ""}
                      onChange={e => updateTrade({ price: e.target.value === "" ? "" : Number(e.target.value) })}
                      aria-label="成交價"
                      aria-invalid={!!errs.price}
                      inputMode="decimal"
                      style={{...cellWith('price'), width: 80, textAlign: "right"}}
                    />
                    <span>元</span>
                  </div>
                  {hasRowErr && (
                    <ul style={{margin:"6px 0 0",padding:"0 0 0 14px",fontSize:11,color:C.down,lineHeight:1.7,listStyle:"disc"}}>
                      {Object.entries(errs).map(([field, msg]) => (
                        <li key={field}>{msg}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {parsed.targetPriceUpdates?.length>0 && (
              <div style={{marginTop:10,background:C.tealBg,border:`1px solid ${alpha(C.teal,'44')}`,
                borderRadius:7,padding:"8px 10px"}}>
                <div style={{fontSize:11,color:C.teal,fontWeight:400,marginBottom:4,letterSpacing:"0.04em"}}>
                  偵測到目標價更新
                </div>
                {parsed.targetPriceUpdates.map((u,i)=>(
                  <div key={i} style={{fontSize:13,color:C.textSec}}>
                    {u.code} · {u.firm} → {u.target?.toLocaleString()}元
                  </div>
                ))}
              </div>
            )}

            {/* 套用修正：把編輯後的結果重新寫入持倉並導向持倉頁 */}
            <button
              onClick={applyCorrections}
              disabled={hasError || parsed.trades.length === 0}
              aria-label="套用修正並更新持倉"
              style={{
                marginTop: 14,
                width: "100%",
                padding: "12px",
                border: `1px solid ${hasError ? C.border : alpha(C.amber, '88')}`,
                borderRadius: 8,
                background: hasError ? C.subtle : alpha(C.amber, '14'),
                color: hasError ? C.textMute : C.text,
                fontSize: 14,
                fontWeight: 500,
                cursor: hasError ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                letterSpacing: "0.04em",
              }}
            >
              {hasError ? `請先修正 ${totalErrCount} 個欄位` : `套用修正並更新持倉（${parsed.trades.length} 筆）`}
            </button>
          </div>

          <div style={{...card,borderLeft:`2px solid ${alpha(C.blue,'88')}`}}>
            <div style={lbl}>交易備忘錄</div>
            {memoAns.map((a,i)=>(
              <div key={i} style={{marginBottom:12}}>
                <div style={{fontSize:12,color:C.textMute,marginBottom:4}}>Q{i+1}. {qs[i]}</div>
                <div style={{fontSize:14,color:C.textSec,background:C.subtle,
                  borderRadius:6,padding:"8px 10px",lineHeight:1.6}}>{a}</div>
              </div>
            ))}
            <div style={{fontSize:14,fontWeight:500,color:C.blue,marginBottom:8}}>
              Q{memoStep+1}/{qs.length}. {qs[memoStep]}
            </div>
            <textarea value={memoIn} onChange={e=>setMemoIn(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&memoIn.trim()){e.preventDefault();submitMemo();}}}
              placeholder="輸入你的想法... (Enter送出)"
              style={{width:"100%", background:C.subtle, border:`1px solid ${C.border}`,
                borderRadius:8, padding:"10px", color:C.text, fontSize:14,
                resize:"none", minHeight:70, outline:"none",
                fontFamily:"inherit", marginBottom:10, lineHeight:1.7}}/>
            <button onClick={submitMemo} disabled={!memoIn.trim()} style={{
              width:"100%", padding:"12px", border:"none", borderRadius:8,
              background: memoIn.trim()
                ? (memoStep===qs.length-1 ? alpha(C.olive,'cc') : alpha(C.blue,'cc'))
                : C.subtle,
              color: memoIn.trim() ? "#fff" : C.textMute,
              fontSize:15, fontWeight:500, cursor:memoIn.trim()?"pointer":"not-allowed",
              letterSpacing:"0.02em"}}>
              {memoStep===qs.length-1 ? "完成備忘 · 更新持倉" : `下一題 (${memoStep+1}/${qs.length})`}
            </button>
          </div>
        </div>
        );
      })()}

      {/* 手動更新目標價 */}
      {!parsed && !img && (()=>{
        const handleAddTarget = () => {
          if (!tpCode.trim()||!tpVal) return;
          const code = tpCode.trim();
          const target = parseFloat(tpVal);
          if (isNaN(target)) return;
          setTargets(prev=>{
            const existing = (prev||{})[code] || {reports:[]};
            const firm = tpFirm.trim()||"手動輸入";
            const already = existing.reports.find(r=>r.firm===firm);
            const newR = {firm, target, date:new Date().toLocaleDateString("zh-TW")};
            return {
              ...(prev||{}),
              [code]: {
                reports: already
                  ? existing.reports.map(r=>r.firm===firm?newR:r)
                  : [...existing.reports, newR],
                updatedAt: new Date().toLocaleDateString("zh-TW"),
                isNew: true,
              }
            };
          });
          setSaved("目標價已更新");
          setTimeout(()=>setSaved(""),2000);
          setTpCode(""); setTpFirm(""); setTpVal("");
        };
        return (
          <div style={{...card,marginTop:14,borderLeft:`2px solid ${alpha(C.teal,'66')}`}}>
            <div style={lbl}>手動更新目標價</div>
            <div style={{fontSize:13,color:C.textMute,marginBottom:10,lineHeight:1.6}}>
              收到新研究報告時，直接在這裡更新。系統會自動計算多家均值。
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:7}}>
              <div>
                <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>股票代碼</div>
                <input value={tpCode} onChange={e=>setTpCode(e.target.value)}
                  placeholder="如 3006"
                  style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                    borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
              </div>
              <div>
                <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>目標價（元）</div>
                <input value={tpVal} onChange={e=>setTpVal(e.target.value)}
                  placeholder="如 205"
                  type="number"
                  style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                    borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:12,color:C.textMute,marginBottom:3}}>券商 / 來源</div>
              <input value={tpFirm} onChange={e=>setTpFirm(e.target.value)}
                placeholder="如 元大投顧、FactSet共識"
                style={{width:"100%",background:C.subtle,border:`1px solid ${C.border}`,
                  borderRadius:7,padding:"8px 10px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"}}/>
            </div>
            <button onClick={handleAddTarget}
              disabled={!tpCode.trim()||!tpVal}
              style={{
                width:"100%",padding:"10px",border:"none",borderRadius:8,
                background: tpCode.trim()&&tpVal ? alpha(C.teal,'cc') : C.subtle,
                color: tpCode.trim()&&tpVal ? "#fff" : C.textMute,
                fontSize:14,fontWeight:500,cursor:tpCode.trim()&&tpVal?"pointer":"not-allowed",
              }}>
              新增 / 更新目標價
            </button>
          </div>
        );
      })()}
    </>
  );
}

const TradeTab = React.memo(TradeTabImpl);
TradeTab.displayName = 'TradeTab';

export default TradeTab;
