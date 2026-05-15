import { memo, lazy, Suspense } from "react";
import HoldingsActionPriority from "@/checkup/components/freecheckup/HoldingsActionPriority";
import HoldingCard from "@/checkup/components/freecheckup/HoldingCard";
import HoldingsHero from "@/checkup/components/freecheckup/HoldingsHero";
import HoldingsQuotaMeter from "@/checkup/components/freecheckup/HoldingsQuotaMeter";
import HoldingsFilterBar from "@/checkup/components/freecheckup/HoldingsFilterBar";
import HoldingsReversalSection from "@/checkup/components/freecheckup/HoldingsReversalSection";

const HoldingsDetailPanel = lazy(() => import("@/checkup/components/freecheckup/HoldingsDetailPanel"));

/**
 * HoldingsTab — 從 FreeCheckup.jsx 抽出的「持倉」分頁完整內容（lazy-loaded）
 *
 * P3-perf：
 *   1. 整個 tab 以 React.lazy 載入，首屏不再為持倉牆付出解析/編譯成本
 *   2. memo 化避免 quote tick 引起無謂 re-render
 *   3. 行為與原 inline JSX 完全一致；外部相依以 props 注入（保持 inline 渲染契約）
 */
function HoldingsTab(props) {
  const {
    // demo / auth
    isDemo,
    DEMO_TAB_NOTICE_COPY,
    startLineLogin,
    navigate,
    // theme tokens
    C, alpha, WB, wbTone,
    // quota / hero
    quota, tier, tierLabel, formatResetCountdown,
    totalVal, totalCost, H, winners, exitList, reviewList,
    MAX_HOLDINGS, rtConnected, lastUpdate,
    // upload summary
    uploadSummary, setUploadSummary,
    // reversal
    losers, reversalConditions, reviewingEvent, setReviewingEvent, updateReversal,
    // action priority
    globalPriorityList, decisionsMap, STOCK_META, setExpandedDecision,
    // filter bar
    filteredSortedList,
    searchQ, setSearchQ,
    filterDecision, setFilterDecision,
    filterThesis, setFilterThesis,
    filterUrgency, setFilterUrgency,
    filterConflict, setFilterConflict,
    filterPnl, setFilterPnl,
    filterStrategy, setFilterStrategy,
    strategyOptions,
    toggleSetItem, clearAllFilters,
    // sorting
    sortBy, setSortBy, sortDir, setSortDir,
    sortMenuOpen, setSortMenuOpen,
    // workbench
    expandedDecision, displayed, sorted, orderedDisplayed,
    variantsMap, firstFeatureCode,
    targets, avgTarget, sparklines, sparklineErrors, EMPTY_SPARK,
    Sparkline, normalizedEvents, openHoldingDrawer,
    handleHoldingCardSelect, handleHoldingCardOpenDrawer,
    cardGridCols, viewMode, setViewMode,
    showAll, setShowAll,
    // navigation
    setTab,
  } = props;

  return (
    <>
      {/* DEMO 持倉提示卡（與 events/news/daily/log 同款，僅訪客顯示） */}
      {isDemo && (
        <div style={{marginBottom:12,padding:"12px 14px",background:alpha(C.amber,'06'),border:`1px solid ${alpha(C.amber,'25')}`,borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:4,letterSpacing:"0.02em"}}>{DEMO_TAB_NOTICE_COPY.holdings.title}</div>
          <div style={{fontSize:11,color:C.textMute,lineHeight:1.7,marginBottom:8}}>{DEMO_TAB_NOTICE_COPY.holdings.body}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={() => { try { startLineLogin?.(); } catch { navigate('/auth/login?redirect=/checkup'); } }} style={{background:"#06C755",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:500,cursor:"pointer",letterSpacing:"0.02em"}}>LINE 登入解鎖</button>
            <button onClick={() => navigate('/auth/login?redirect=/checkup')} style={{background:"transparent",color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:400,cursor:"pointer",letterSpacing:"0.02em"}}>Email 登入</button>
          </div>
        </div>
      )}
      {/* 配額卡：常駐顯示 used/limit 進度條 + 重置倒數 + 升級 CTA（訪客/載入中也顯示） */}
      <HoldingsQuotaMeter
        isDemo={isDemo}
        quota={quota}
        tier={tier}
        tierLabel={tierLabel}
        C={C}
        alpha={alpha}
        formatResetCountdown={formatResetCountdown}
      />
      {/* 上傳摘要：剛從上傳成交頁回來時顯示新增/更新項目 */}
      {uploadSummary && (uploadSummary.added.length + uploadSummary.updated.length > 0) && (
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
                <span key={`a-${i}`} style={{marginRight:10}}>
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
      )}
      {/* ── Hero：橫向 2 欄構圖（左大數字 + 右市場狀態），底部 4 欄 KPI ── */}
      <HoldingsHero
        totalVal={totalVal}
        totalCost={totalCost}
        holdingsCount={H.length}
        winnersCount={winners.length}
        exitListLength={exitList?.length || 0}
        reviewListLength={reviewList?.length || 0}
        maxHoldings={MAX_HOLDINGS}
        rtConnected={rtConnected}
        lastUpdate={lastUpdate}
        isDemo={isDemo}
        WB={WB}
        wbTone={wbTone}
      />


      {/* 反轉追蹤（虧損持股）— 預設折疊，避免擠壓卡片牆 */}
      <HoldingsReversalSection
        losers={losers}
        reversalConditions={reversalConditions}
        reviewingEvent={reviewingEvent}
        setReviewingEvent={setReviewingEvent}
        updateReversal={updateReversal}
        C={C}
        alpha={alpha}
      />

      {/* ══════════ Action Priority（單行 inline 文字流） ══════════ */}
      <HoldingsActionPriority
        items={globalPriorityList}
        decisionsMap={decisionsMap}
        stockMeta={STOCK_META}
        WB={WB}
        onPick={setExpandedDecision}
      />


      {/* ── 持倉資料庫 Filter Bar ── */}
      <HoldingsFilterBar
        totalCount={H.length}
        filteredCount={filteredSortedList.length}
        searchQ={searchQ}
        setSearchQ={setSearchQ}
        filterDecision={filterDecision}
        setFilterDecision={setFilterDecision}
        filterThesis={filterThesis}
        setFilterThesis={setFilterThesis}
        filterUrgency={filterUrgency}
        setFilterUrgency={setFilterUrgency}
        filterConflict={filterConflict}
        setFilterConflict={setFilterConflict}
        filterPnl={filterPnl}
        setFilterPnl={setFilterPnl}
        filterStrategy={filterStrategy}
        setFilterStrategy={setFilterStrategy}
        strategyOptions={strategyOptions}
        toggleSetItem={toggleSetItem}
        clearAllFilters={clearAllFilters}
        C={C}
        alpha={alpha}
      />

      {/* 排序 */}
      <div style={{display:"flex",gap:4,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.08em",fontWeight:400}}>排序</span>
        {[["value","市值"],["pnl","損益"],["pct","報酬%"],["urgency","緊急"],["confidence","信心"],["updated","更新"],["decision","決策"]].map(([k,l])=>{
          const active = sortBy === k;
          return (
            <button key={k} onClick={()=>{
              if (active) setSortDir(d => d === "desc" ? "asc" : "desc");
              else { setSortBy(k); setSortDir("desc"); }
            }} style={{
              background:"transparent",
              color: active ? C.textSec : C.textMute,
              border:"none",
              borderBottom: active ? `1px solid ${C.textMute}` : "1px solid transparent",
              borderRadius:0, padding:"3px 8px", fontSize:11, fontWeight:400, cursor:"pointer",
              transition:"all 0.15s",
              display:"inline-flex", alignItems:"center", gap:2,
            }}>
              {l}
              {active && <span style={{fontSize:9,opacity:0.7}}>{sortDir === "desc" ? "↓" : "↑"}</span>}
            </button>
          );
        })}
      </div>

      {/* ══════════ 持倉決策工作台：左卡片牆 + 右 Detail Panel ══════════ */}
      {(() => {
        const selectedCode = expandedDecision;
        const selected = selectedCode ? displayed.find(x => x.code === selectedCode) || sorted.find(x => x.code === selectedCode) : null;

        const renderCard = (h) => (
          <HoldingCard
            key={h.code}
            holding={h}
            decision={decisionsMap[h.code]}
            target={targets?.[h.code]}
            avgTargetPrice={targets?.[h.code] ? avgTarget(h.code) : null}
            meta={STOCK_META[h.code] || null}
            sparkData={sparklines[h.code] || EMPTY_SPARK}
            sparkFailed={!!sparklineErrors[h.code]}
            variant={variantsMap.get(h.code) || 'plain'}
            isFeatureSlot={h.code === firstFeatureCode}
            isActive={selectedCode === h.code}
            WB={WB}
            Sparkline={Sparkline}
            alpha={alpha}
            onSelect={handleHoldingCardSelect}
            onOpenDrawer={handleHoldingCardOpenDrawer}
          />
        );


        const renderDetailPanel = () => (
          <Suspense fallback={null}>
            <HoldingsDetailPanel
              selected={selected}
              decisionsMap={decisionsMap}
              stockMeta={STOCK_META}
              targets={targets}
              avgTarget={avgTarget}
              normalizedEvents={normalizedEvents}
              orderedDisplayed={orderedDisplayed}
              WB={WB}
              setExpandedDecision={setExpandedDecision}
              openHoldingDrawer={openHoldingDrawer}
            />
          </Suspense>
        );

        // ── grid layout：selected 時才顯示 detail panel；否則卡片牆滿版 ──
        const showPanel = !!selected;
        return (
          <div style={{
            display:'grid',
            gridTemplateColumns: showPanel ? 'minmax(0, 1fr) minmax(0, 420px)' : 'minmax(0, 1fr)',
            gap: showPanel ? 20 : 0,
            alignItems:'flex-start',
          }} className="holdings-workbench">
            {/* 左：卡片牆 */}
            <div style={{
              display:'grid',
              gridTemplateColumns: cardGridCols,
              columnGap: 16,
              rowGap: 20,
            }} className={`holdings-card-grid${viewMode === 'list' ? ' holdings-card-grid--list' : ''}`}>
              {orderedDisplayed.map((h, idx) => renderCard(h, idx))}
              {/* 持倉為 0 時顯示強化空狀態（橫跨整列）；有持倉時顯示「+ 上傳成交」虛線卡 */}
              {orderedDisplayed.length === 0 && H.length === 0 ? (
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
                  {/* 標題區 */}
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
                    <span style={{fontSize:18,fontWeight:500,letterSpacing:'0.08em',color:WB.ink}}>還沒有持倉資料</span>
                    <span style={{fontSize:13,fontWeight:400,lineHeight:1.7,color:WB.inkMute,textAlign:'center',maxWidth:420}}>
                      上傳一張下單 App 的持倉截圖，系統會自動辨識成交資料，您只需逐條確認即可。
                    </span>
                  </div>

                  {/* 3 步教學（含小圖示） */}
                  <div className="holdings-empty-steps" style={{
                    display:'grid',
                    gridTemplateColumns:'repeat(3, minmax(0, 1fr))',
                    gap:16,
                    width:'100%',
                    maxWidth:560,
                  }}>
                    {[
                      {
                        n:'1',
                        title:'上傳截圖',
                        desc:'從券商 App 截下持倉畫面',
                        icon:(
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="5" width="18" height="14" rx="1.5"/>
                            <circle cx="12" cy="12" r="3.2"/>
                            <path d="M8 5l1.5-2h5L16 5"/>
                          </svg>
                        ),
                      },
                      {
                        n:'2',
                        title:'AI 辨識',
                        desc:'自動讀取股號與股數',
                        icon:(
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 7h16M4 12h10M4 17h16"/>
                            <circle cx="19" cy="12" r="2"/>
                          </svg>
                        ),
                      },
                      {
                        n:'3',
                        title:'確認上傳',
                        desc:'逐條檢視後一鍵建立',
                        icon:(
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M5 12.5l4 4 10-10"/>
                          </svg>
                        ),
                      },
                    ].map((s) => (
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

                  {/* 主 CTA */}
                  <button
                    onClick={() => setTab && setTab('trade')}
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
                      transition:'opacity 160ms ease',
                    }}
                    onMouseEnter={(e)=>{e.currentTarget.style.opacity='0.85';}}
                    onMouseLeave={(e)=>{e.currentTarget.style.opacity='1';}}
                  >
                    現在上傳成交
                  </button>

                  {/* 副提示 */}
                  <span style={{fontSize:11,fontWeight:400,letterSpacing:'0.12em',color:WB.inkMute}}>
                    支援 JPG / PNG 截圖，無需手動輸入
                  </span>
                </div>
              ) : orderedDisplayed.length === 0 ? (
                /* P9: 有持倉但被篩選/搜尋過濾掉 — 「沒有符合條件的持倉」+ 清除全部篩選 CTA */
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
                    目前 {H.length} 檔持倉中沒有符合搜尋與篩選條件的標的，試著放寬條件。
                  </span>
                  <button
                    onClick={() => {
                      setSearchQ('');
                      setFilterDecision(new Set());
                      setFilterThesis(new Set());
                      setFilterUrgency(new Set());
                      setFilterConflict(new Set());
                      setFilterPnl(new Set());
                      setFilterStrategy(new Set());
                    }}
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
              ) : (
                <button
                  onClick={() => setTab && setTab('trade')}
                  className="wb-span-1"
                  style={{
                    minHeight: 320,
                    background:'transparent',
                    border:`1px dashed ${WB.hairStrong}`,
                    borderRadius:4,
                    color:WB.inkLight,
                    cursor:'pointer',
                    fontFamily:'inherit',
                    display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                    gap:10,
                    letterSpacing:'0.18em',
                    transition:'border-color 160ms ease, color 160ms ease',
                  }}
                  onMouseEnter={(e)=>{e.currentTarget.style.borderColor=WB.ink;e.currentTarget.style.color=WB.ink;}}
                  onMouseLeave={(e)=>{e.currentTarget.style.borderColor=WB.hairStrong;e.currentTarget.style.color=WB.inkLight;}}
                >
                  <span style={{fontSize:24,fontWeight:300,lineHeight:1}}>+</span>
                  <span style={{fontSize:10,fontWeight:500}}>上傳成交</span>
                </button>
              )}
              {!showAll && sorted.length > 12 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="wb-span-full"
                  style={{
                    padding:'12px',
                    background:'transparent',
                    border:`1px dashed ${WB.hair}`,
                    borderRadius:4,
                    color:WB.inkMute, fontSize:11, cursor:'pointer', fontWeight:500,
                    letterSpacing:'0.16em',
                    fontFamily:'inherit',
                  }}
                >
                  VIEW ALL {sorted.length}
                </button>
              )}
            </div>

            {/* 右：Detail Panel — 只在 selected 時顯示 */}
            {showPanel && (
              <aside
                className="holdings-detail-panel"
                style={{
                  position:'sticky', top:12,
                  background: WB.surface,
                  border:`1px solid ${WB.hairStrong}`,
                  borderRadius:4,
                  maxHeight:'calc(100vh - 24px)',
                  overflowY:'auto',
                }}
              >
                {renderDetailPanel()}
              </aside>
            )}
          </div>
        );
      })()}

      {/* Step 7：底部狀態列 */}
      <div style={{
        marginTop:24,paddingTop:14,
        borderTop:`1px solid ${WB.hair}`,
        display:'flex',justifyContent:'space-between',alignItems:'center',
        fontSize:10,color:WB.inkMute,letterSpacing:'0.16em',fontWeight:500,
      }}>
        <span>{sorted.length} HOLDINGS</span>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          {/* SORT BY 下拉選單 */}
          <div style={{position:'relative'}}>
            <button
              type="button"
              onClick={() => setSortMenuOpen(v => !v)}
              style={{
                background:'transparent', border:'none', padding:0, margin:0,
                fontSize:10, color:WB.inkMute, letterSpacing:'0.16em', fontWeight:500,
                cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6,
                fontFamily:'inherit',
              }}
            >
              SORT BY <span style={{color:WB.ink}}>
                {(() => {
                  const map = {decision:'PRIORITY', value:'VALUE', pnl:'P&L', pct:'RETURN', urgency:'URGENCY', confidence:'CONFIDENCE', updated:'UPDATED'};
                  return map[sortBy] || 'PRIORITY';
                })()} {sortMenuOpen ? '▴' : '▾'}
              </span>
            </button>
            {sortMenuOpen && (
              <>
                <div
                  onClick={() => setSortMenuOpen(false)}
                  style={{position:'fixed', inset:0, zIndex:40}}
                />
                <div style={{
                  position:'absolute', bottom:'calc(100% + 6px)', right:0, zIndex:50,
                  background:WB.surface, border:`1px solid ${WB.hairStrong}`, borderRadius:4,
                  minWidth:140, padding:'6px 0',
                  boxShadow:'0 2px 12px rgba(0,0,0,0.04)',
                }}>
                  {[['decision','PRIORITY'],['value','VALUE'],['pnl','P&L'],['pct','RETURN'],['urgency','URGENCY'],['confidence','CONFIDENCE'],['updated','UPDATED']].map(([k,l]) => {
                    const active = sortBy === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          if (active) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                          else { setSortBy(k); setSortDir('desc'); }
                          setSortMenuOpen(false);
                        }}
                        style={{
                          display:'flex', alignItems:'center', justifyContent:'space-between',
                          width:'100%', padding:'7px 14px', background:'transparent',
                          border:'none', cursor:'pointer', fontFamily:'inherit',
                          fontSize:10, letterSpacing:'0.14em', fontWeight:active?500:400,
                          color: active ? WB.ink : WB.inkMute, textAlign:'left',
                        }}
                      >
                        <span>{l}</span>
                        {active && <span style={{fontSize:9,opacity:0.7}}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <span style={{width:1,height:12,background:WB.hair}}/>
          {/* 檢視模式切換 */}
          <span style={{display:'flex',gap:4}}>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="格狀檢視"
              aria-pressed={viewMode === 'grid'}
              style={{
                display:'inline-flex',alignItems:'center',justifyContent:'center',
                width:22,height:22,
                border:`1px solid ${viewMode === 'grid' ? WB.ink : WB.hair}`,
                color: viewMode === 'grid' ? WB.ink : WB.inkLight,
                background:'transparent', padding:0, cursor:'pointer',
                fontSize:10, borderRadius:2, fontFamily:'inherit',
                transition:'all 0.15s',
              }}
            >▦</button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="清單檢視"
              aria-pressed={viewMode === 'list'}
              style={{
                display:'inline-flex',alignItems:'center',justifyContent:'center',
                width:22,height:22,
                border:`1px solid ${viewMode === 'list' ? WB.ink : WB.hair}`,
                color: viewMode === 'list' ? WB.ink : WB.inkLight,
                background:'transparent', padding:0, cursor:'pointer',
                fontSize:10, borderRadius:2, fontFamily:'inherit',
                transition:'all 0.15s',
              }}
            >≡</button>
          </span>
        </div>
      </div>

      {/* RWD：mid 折成 2 欄、行動端 1 欄並隱藏 detail panel */}
      <style>{`
        /* Desktop 預設：3 欄。改用 class 而非 inline style，讓下方 media query 能在行動端生效 */
        .holdings-card-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        /* 清單檢視：強制單欄並讓 feature 卡片佔滿一列 */
        .holdings-card-grid--list { grid-template-columns: 1fr !important; }
        .holdings-card-grid--list .wb-span-feature,
        .holdings-card-grid--list .wb-card-feature { grid-column: 1 / -1 !important; }
        .holdings-card-grid--list .wb-card { min-height: 0 !important; }
        /* 卡片 span 工具類：以 CSS 控制，避免 inline style 在 RWD 切換時 race */
        .wb-span-1 { grid-column: span 1; }
        .wb-span-feature { grid-column: span 2; }
        .wb-span-full { grid-column: 1 / -1; }
        @media (max-width: 1279px) {
          .holdings-workbench { grid-template-columns: minmax(0, 1fr) minmax(0, 320px) !important; }
          .holdings-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 1023px) {
          .holdings-workbench { grid-template-columns: 1fr !important; }
          .holdings-detail-panel { display: none !important; }
          .holdings-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        /* 卡片內元素 baseline 對齊強化（所有尺寸通用） */
        .wb-card .wb-roi {
          font-feature-settings: "tnum" 1;
          vertical-align: baseline;
          white-space: nowrap;
          max-width: 100%;
          overflow: hidden;
          text-overflow: clip;
        }
        .wb-card .wb-roi > * { white-space: nowrap; }
        .wb-card .wb-bottom { align-items: baseline !important; min-width: 0; }
        .wb-card .wb-bottom > span { min-width: 0; overflow: hidden; }
        .wb-card .wb-bottom-val {
          display: inline-block;
          vertical-align: baseline;
          white-space: nowrap;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        @media (max-width: 768px) {
          .wb-card-feature { padding: 20px 18px 16px !important; }
          .wb-card { padding: 18px 16px 14px !important; }
          .wb-card .wb-bottom { gap: 10px !important; }
          .wb-card .wb-tags { row-gap: 6px !important; }
        }
        @media (max-width: 640px) {
          .holdings-card-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
          .wb-card-feature, .wb-span-feature { grid-column: span 1 !important; }
          .wb-card { min-height: 0 !important; }
          .wb-card .wb-spark { width: 52px !important; }
          .wb-card .wb-bottom { gap: 8px !important; }
          .wb-card .wb-bottom-val { font-size: clamp(10px, 2.6vw, 12px) !important; }
        }
        /* 持倉空狀態引導 — 手機優化 */
        @media (max-width: 560px) {
          .holdings-empty-guide { padding: 32px 16px !important; gap: 20px !important; }
          .holdings-empty-steps { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 380px) {
          .holdings-empty-guide { padding: 24px 12px !important; }
        }
        @media (max-width: 380px) {
          .wb-card .wb-spark { display: none !important; }
          .wb-card .wb-bottom .wb-bottom-val { letter-spacing: 0 !important; }
          .wb-card .wb-bottom-val { font-size: clamp(9.5px, 2.4vw, 11px) !important; }
        }
        /* 極窄寬度安全溢出策略：縮放 ROI 數字避免擠壓換行 */
        @media (max-width: 340px) {
          .wb-card .wb-roi { font-size: clamp(28px, 11vw, 36px) !important; }
          .wb-card-feature .wb-roi { font-size: clamp(32px, 13vw, 44px) !important; }
          /* TODAY/VALUE 雙區塊在極窄螢幕的安全溢出策略 */
          .wb-card .wb-bottom {
            grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr) !important;
            column-gap: 6px !important;
            row-gap: 1px !important;
            max-width: 100% !important;
            overflow: hidden !important;
          }
          .wb-card .wb-bottom > span {
            min-width: 0 !important;
            max-width: 100% !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
          }
          .wb-card .wb-bottom-lbl,
          .wb-card .wb-bottom > span:not(.wb-bottom-val) {
            font-size: clamp(8.5px, 2.6vw, 10px) !important;
            letter-spacing: 0 !important;
          }
          .wb-card .wb-bottom-val {
            font-size: clamp(9px, 3vw, 11px) !important;
            letter-spacing: -0.2px !important;
            font-variant-numeric: tabular-nums !important;
          }
        }
        /* 超極窄保險（≤320px iPhone SE 1st） */
        @media (max-width: 320px) {
          .wb-card .wb-bottom { column-gap: 4px !important; }
          .wb-card .wb-bottom-val { font-size: clamp(8.5px, 2.8vw, 10.5px) !important; }
        }
      `}</style>
    </>
  );
}

export default memo(HoldingsTab);
