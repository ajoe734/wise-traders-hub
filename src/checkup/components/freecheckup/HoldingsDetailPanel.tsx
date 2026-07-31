// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Camera, Download, Copy, X as XIcon, Settings, ChevronDown,
  RotateCcw, FileText, Image as ImageIcon, Undo2, Redo2, Check, Info,
} from 'lucide-react';
import { useHoldingShareExport } from '@/checkup/hooks/useHoldingShareExport';
// Sparkline removed: header 迷你折線與 §6 RangeBand 資訊重複，僅保留 RangeBand。
import { useHoldingDetailViewModel } from '@/checkup/hooks/useHoldingDetailViewModel';
import HoldingExportCard from './HoldingExportCard';
import ChipsSection from './ChipsSection';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import '@/checkup/styles/holdingsDetailPanel.css';
import { holdingPanelPrefs, holdingExportPrefs, DEFAULT_PREFS, DEFAULT_EXPORT_PREFS } from '@/checkup/lib/drawerPrefs';

/**
 * HoldingsDetailPanel — 決策書抽屜（Handoff 2026-07-15 §4，3a 定案）
 *
 * 十區塊順序：
 *   1) 操作列（sticky、全文字化）
 *   2) 識別（`代號 · 產業 · 策略` + serif 名稱 26px + 30D sparkline）
 *   3) 報酬塔 + 持有脈絡（tradeLog 推導；資料未通時顯示 placeholder）
 *   4) 建議印章行（上下 1px ink 線、serif「建議 —— …」+ 中文急迫度、手機 sticky）
 *   5) 一條價格軸（目標 accent / 成本 灰 / 現價 ink 圓點，同一尺 ±5%）+ 目標價修正方向
 *   6) 30D 走勢帶（sparkline + 現價 accent 點 + `低 — 高`）
 *   7) 佔比排名表（灰條 + 本檔 accent、`排名 #x / N`；甜甜圈已刪）
 *   8) 決策履歷（thesisTracking 表格；資料未通時顯示 placeholder）
 *   9) 情境模擬（沿用 computeScenario）
 *   10) 論點引文（serif 全形引號）＋ 頁腳 `‹ 上一檔名 ｜ 研究筆記 ｜ 下一檔名 ›`
 *
 * 刪除清單（§4）：甜甜圈、RETURN/TARGET/THESIS/NEXT EVENT 英文小標、黑底 DECISION 盒、
 *   急迫度五點、反向 TARGET 紅條、MiniChartsRow、ComparisonCharts。
 * 保留：a11y aria-label、sr 播報、sync shimmer/error strip、SortMenu/PrefsMenu/ExportMenu
 *   功能、鍵盤快捷鍵、離屏匯出。
 */

const RES_TO_PR = { std: 2, high: 3, print: 4 };
const RES_LABEL = { std: '標準 2x', high: '高 3x', print: '印刷 4x' };

const loadPrefs = () => holdingPanelPrefs.load();
const savePrefs = (p) => holdingPanelPrefs.save(p);
const loadExportPrefs = () => holdingExportPrefs.load();
const saveExportPrefs = (p) => holdingExportPrefs.save(p);


const SERIF = '"Source Serif 4", "Noto Serif TC", Georgia, serif';
const URGENCY_LABEL = { now: '立即', soon: '儘快', monitor: '觀察', low: '低' };
const ACTION_LABEL = { exit: '出場', review: '檢視', hold: '續抱' };

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
  totalPortfolioValue = 0,
  sparkData30D = [],
  sortBy,
  sortDir,
  setSortBy,
  setSortDir,
  // §4.3 / §4.5 / §4.8：資料源可外部注入；若未注入，內部以 hooks 自行拉取（A2 通線）。
  tradeLog,
  targetPriceHistory: targetPriceHistoryProp,
  thesisTracking: thesisTrackingProp,
  onReportMeta,
}) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [exportPrefs, setExportPrefsRaw] = useState(loadExportPrefs);
  const setExportPrefs = useCallback((updater) => {
    setExportPrefsRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveExportPrefs(next);
      return next;
    });
  }, []);
  const exportHostRef = useRef(null);
  const [exportNode, setExportNode] = useState(null);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  const { busy, downloadPng, downloadPdf, copy } = useHoldingShareExport({ backgroundColor: WB.surface });

  useEffect(() => { savePrefs(prefs); }, [prefs]);

  const h = selected || {};
  const dec = decisionsMap[h.code];
  const meta = stockMeta[h.code] || null;
  const baseTarget = targets && avgTarget && h.code ? avgTarget(h.code) : null;

  // C2：所有推導收斂到 useHoldingDetailViewModel（純函式在 lib/holdingDetailViewModel.ts）。
  const vm = useHoldingDetailViewModel({
    holding: h,
    decision: dec,
    meta,
    baseTarget,
    totalPortfolioValue,
    sparkData30D,
    normalizedEvents,
    orderedDisplayed,
    tradeLog,
    targetPriceHistory: targetPriceHistoryProp,
    thesisTracking: thesisTrackingProp,
  });

  const { pctVal, pnlVal, todayPct, todayPnl, valueNum, weightPct } = vm.valuation;
  const { sparkArr, rangeLow, rangeHigh, thesisSentence, relatedEvents, nextEvent,
    holdContext, tpHistory, thesisRows, stamp, todayLabel } = vm;
  const { actionKind, actionLabel, urgencyLabel, urgencyAccent } = vm.decisionStamp;
  const { prev, next } = vm.neighbors;
  const { displayTarget, displayUpside, displayPnlPct, displayPnlAbs,
    displayQty, displayValue, displayWeight } = vm.display;
  const { sim, setSim, simHistory, scenario, dirty } = vm;
  const pnlColor = displayPnlPct > 0 ? WB.accent : displayPnlPct < 0 ? '#8A857F' : WB.inkMute;


  // ── 匯出 ──
  const exportCardProps = useMemo(() => ({
    holding: h, decision: dec, meta,
    scenario: dirty ? { simTarget: displayTarget, upsidePct: displayUpside } : null,
    baseTarget, pctVal: displayPnlPct, pnlVal: displayPnlAbs,
    weightPct: displayWeight, rangeLow, rangeHigh,
    thesis: prefs.showThesis ? thesisSentence : null,
    nextEvent: prefs.showNextEvent ? nextEvent : null,
    stamp, WB, showSimulated: dirty,
  }), [h, dec, meta, dirty, displayTarget, displayUpside, baseTarget, displayPnlPct, displayPnlAbs, displayWeight, rangeLow, rangeHigh, prefs.showThesis, prefs.showNextEvent, thesisSentence, nextEvent, stamp, WB]);

  const runExport = async (variant, kind, opts: { pixelRatio?: number } = {}) => {
    setExportNode({ variant });
    await new Promise((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => setTimeout(r, 30));
    const node = exportHostRef.current?.firstElementChild;
    const safeName = (h.name || h.code || 'holding').replace(/[\\/:*?"<>|]/g, '');
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const ratioTag = variant === 'square' ? '1x1' : '16x9';
    const prTag = opts.pixelRatio ? `-${opts.pixelRatio}x` : '';
    const base = `${h.code}-${safeName}-${ratioTag}${prTag}-${ymd}`;
    try {
      if (kind === 'png') await downloadPng(node, `${base}.png`, { pixelRatio: opts.pixelRatio });
      else if (kind === 'pdf') await downloadPdf(node, `${base}.pdf`, variant, { pixelRatio: opts.pixelRatio });
      else if (kind === 'copy') await copy(node, { pixelRatio: opts.pixelRatio });
    } finally {
      if (isMountedRef.current) setExportNode(null);
    }
  };
  const triggerCurrentExport = () => runExport(
    exportPrefs.ratio, exportPrefs.format,
    { pixelRatio: RES_TO_PR[exportPrefs.resolution] ?? 3 }
  );

  const undoRef = useRef(simHistory.undo);
  const redoRef = useRef(simHistory.redo);
  useEffect(() => {
    undoRef.current = simHistory.undo;
    redoRef.current = simHistory.redo;
  });
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redoRef.current();
      else undoRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  if (!selected) return null;

  const microStyle = { fontSize: 10, color: WB.inkMute, letterSpacing: '0.14em' };
  const sectionLabel = { fontFamily: SERIF, fontSize: 15, color: WB.ink, letterSpacing: '0.02em' };

  return (
    <div>
      {/* 1) 操作列 — sticky、全文字化 */}
      <div className="holdings-detail-toolbar" style={{
        position: 'sticky', top: 0, zIndex: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${WB.hair}`, background: WB.surface,
      }}>
        <div className="holdings-detail-toolbar-left" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TextBtn WB={WB} disabled={!prev} onClick={() => prev && setExpandedDecision(prev.code)} label="上一檔">‹</TextBtn>
          <TextBtn WB={WB} disabled={!next} onClick={() => next && setExpandedDecision(next.code)} label="下一檔">›</TextBtn>
          <span style={{ ...microStyle, fontFamily: SERIF, fontSize: 12, letterSpacing: '0.06em' }}>{todayLabel}</span>
        </div>
        <div className="holdings-detail-toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onReportMeta && (
            <button
              type="button"
              title="回報分類錯誤"
              aria-label={h.code ? `回報 ${h.code} 分類錯誤` : '回報分類錯誤'}
              onClick={(e) => {
                e.stopPropagation();
                // 先關抽屜再開 modal，避免 Radix Sheet 的 inert/focus-trap 攔截 modal 內點擊。
                const holdingRef = h;
                setExpandedDecision(null);
                setTimeout(() => onReportMeta(holdingRef), 0);
              }}
              style={{
                background: 'transparent', border: 'none', padding: '4px 6px',
                fontSize: 12, color: WB.inkSub, cursor: 'pointer', letterSpacing: '0.04em',
              }}
            >回報</button>
          )}
          <SortMenu WB={WB} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} />
          <PrefsMenu WB={WB} prefs={prefs} setPrefs={setPrefs} />
          <ExportMenu
            WB={WB}
            prefs={exportPrefs}
            setPrefs={setExportPrefs}
            onExport={triggerCurrentExport}
            onCopy={() => runExport('square', 'copy', { pixelRatio: RES_TO_PR[exportPrefs.resolution] ?? 3 })}
            busy={busy}
          />
          <TextBtn WB={WB} onClick={() => setExpandedDecision(null)} label="關閉">×</TextBtn>
        </div>
      </div>

      {/* 窄螢幕提示帶（≥1024px 隱藏，由 holdingsDetailPanel.css 控制） */}
      <div
        data-testid="holdings-panel-narrow-hint"
        className="holdings-panel-narrow-hint"
        style={{
          padding: '6px 14px', fontSize: 11, letterSpacing: '0.08em',
          color: WB.inkMute, background: WB.surface, borderBottom: `1px solid ${WB.hair}`,
        }}
      >已展開完整圖表面板</div>

      <div className="holdings-detail-body" style={{ padding: '18px 22px 22px', background: WB.surface }}>
        {/* 2) 識別 */}
        <div data-testid="drawer-identity" style={{ marginBottom: 20 }}>
          <div style={{ ...microStyle, marginBottom: 6 }}>
            {h.code}
            {meta?.industry ? <> · {meta.industry}</> : null}
            {meta?.strategy ? <> · {meta.strategy}</> : null}
            {meta?.priceSource ? <span title={`價格來源：${meta.priceSource}`} style={{ marginLeft: 8, opacity: 0.5 }}>· {meta.priceSource}</span> : null}
          </div>
          <div className="holdings-detail-identity-row">
            <h2 style={{
              margin: 0, fontFamily: SERIF, fontSize: 22, fontWeight: 500,
              color: WB.ink, letterSpacing: '-0.005em', lineHeight: 1.15,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{h.name}</h2>
            {!dirty && todayPct != null && (
              <div
                data-testid="drawer-today-delta"
                className="holdings-detail-today-delta"
                style={{
                  marginTop: 4,
                  textAlign: 'right',
                  fontSize: 12,
                  lineHeight: 1.3,
                  color: todayPct >= 0 ? WB.inkSub : WB.inkMute,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                  <span>今日 {todayPct >= 0 ? '+' : '−'}{Math.abs(todayPct).toFixed(2)}%</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="今日漲跌幅說明"
                        data-testid="drawer-today-delta-info"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          color: WB.inkMute,
                          cursor: 'pointer',
                          lineHeight: 1,
                        }}
                      >
                        <Info size={12} strokeWidth={2} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="end"
                      sideOffset={6}
                      className="shadow-none"
                      style={{
                        background: WB.surface,
                        color: WB.ink,
                        border: `1px solid ${WB.hair}`,
                        fontSize: 12,
                        lineHeight: 1.55,
                        maxWidth: 260,
                        padding: '8px 10px',
                        borderRadius: 6,
                      }}
                    >
                      今日漲跌幅（% 與金額）與下方 30 日走勢帶使用相同收盤價來源，即折線圖最右端點的當日變化。
                    </TooltipContent>
                  </Tooltip>
                </div>
                {todayPnl != null && (
                  <span style={{ marginLeft: 8, color: WB.inkMute }}>
                    {todayPnl >= 0 ? '+' : '−'}{Math.abs(Math.round(todayPnl)).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3) 報酬塔 + 持有脈絡 */}
        <div data-testid="drawer-return-tower" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span data-testid="drawer-roi-main" style={{
              fontFamily: SERIF, fontSize: 22, fontWeight: 500,
              color: pnlColor, letterSpacing: '-0.01em', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums',
            }}>
              {displayPnlPct >= 0 ? '+' : '−'}{Math.abs(Number(displayPnlPct)).toFixed(2)}
              <span style={{ fontSize: 12, opacity: 0.55, marginLeft: 2 }}>%</span>
            </span>
            <span style={{ fontSize: 14, color: WB.inkSub, fontVariantNumeric: 'tabular-nums' }}>
              {displayPnlAbs >= 0 ? '+' : '−'}{Math.abs(Math.round(displayPnlAbs)).toLocaleString()}
              {dirty && (
                <span style={{ marginLeft: 10, color: WB.inkLight, textDecoration: 'line-through' }}>
                  原 {pctVal >= 0 ? '+' : '−'}{Math.abs(Number(pctVal)).toFixed(2)}%
                </span>
              )}
            </span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: WB.inkSub, fontVariantNumeric: 'tabular-nums' }}>
            持股 {Math.round(displayQty).toLocaleString()}
            <span style={{ margin: '0 6px', color: WB.inkLight }}>·</span>
            市值 {displayValue ? Math.round(displayValue).toLocaleString() : '—'}
          </div>
          {holdContext && (
            <div data-testid="hold-context" style={{ marginTop: 6, fontSize: 12, color: WB.inkMute, letterSpacing: '0.02em' }}>
              持有 {holdContext.heldDays} 天
              {holdContext.addCount > 0 && <> · 加碼 {holdContext.addCount} 次</>}
              {holdContext.lastLabel && <> · 上次 {holdContext.lastLabel}</>}
            </div>
          )}
        </div>

        {/* 4) 建議印章行 — 上下 1px ink 線、手機 sticky */}
        <div
          className="holdings-detail-decision"
          data-testid="decision-stamp"
          style={{
            margin: '0 0 20px',
            padding: '10px 0',
            borderTop: `1px solid ${WB.ink}`, borderBottom: `1px solid ${WB.ink}`,
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
            background: WB.surface,
          }}>
          <span style={{ fontFamily: SERIF, fontSize: 17, color: WB.ink, letterSpacing: '0.02em' }}>
            建議 <span style={{ margin: '0 8px', color: WB.inkLight }}>——</span>
            <span style={{ color: actionKind === 'exit' || actionKind === 'review' ? WB.accent : WB.ink, fontWeight: 500 }}>
              {actionLabel}
            </span>
          </span>
          <span style={{
            fontSize: 12, letterSpacing: '0.14em',
            color: urgencyAccent ? WB.accent : WB.inkMute,
            fontFamily: SERIF,
          }}>
            急迫度 · {urgencyLabel}
            {dirty && <span style={{ marginLeft: 8, fontSize: 10, color: WB.accent, letterSpacing: '0.2em' }}>SIM</span>}
          </span>
        </div>

        {/* 5) 一條價格軸（目標 accent／成本 灰／現價 ink 圓點，同一尺 ±5%）+ 目標價修正方向 */}
        <PriceAxis
          WB={WB}
          price={_priceN}
          cost={Number(h.cost)}
          target={displayTarget}
          baseTarget={baseTarget}
          upside={displayUpside}
          tpHistory={tpHistory}
        />

        {/* 6) 30D 走勢帶 */}
        {rangeLow != null && rangeHigh != null && rangeHigh > rangeLow && (
          <RangeBand
            WB={WB}
            price={_priceN}
            low={rangeLow}
            high={rangeHigh}
            spark={sparkArr}
            symbol={h?.code || h?.symbol || h?.instrument}
            priceSource={meta?.priceSource || h?.priceSource}
            priceUpdatedAt={h?.priceUpdatedAt}
          />
        )}

        {/* 7) 佔比排名表（甜甜圈已刪） */}
        <WeightRank
          WB={WB}
          h={h}
          orderedDisplayed={orderedDisplayed}
          totalPortfolioValue={totalPortfolioValue}
        />

        {/* 8) 決策履歷 */}
        {thesisRows && <ThesisHistory WB={WB} rows={thesisRows} />}

        {/* 8.5) 籌碼面（僅台股） */}
        <ChipsSection WB={WB} stockCode={h.code} />

        {/* 9) 情境模擬 */}
        <ScenarioSandbox
          WB={WB} prefs={prefs} setPrefs={setPrefs}
          sim={sim} setSim={setSim} baseTarget={baseTarget} h={h} scenario={scenario} dirty={dirty}
          canUndo={simHistory.canUndo} canRedo={simHistory.canRedo}
          onUndo={simHistory.undo} onRedo={simHistory.redo}
          onReset={() => simHistory.reset({ target: baseTarget ?? '', deltaQty: 0, buyMorePrice: '', stopPrice: '' })}
        />

        {/* 10) 論點引文 */}
        {thesisSentence && (
          <div style={{ margin: '18px 0 8px', padding: '14px 0', borderTop: `1px solid ${WB.hair}` }}>
            <div style={{
              fontFamily: SERIF, fontSize: 15, color: WB.ink, lineHeight: 1.75, letterSpacing: '0.01em',
            }}>「{thesisSentence}」</div>
            {dec && (
              <div style={{ marginTop: 8, fontSize: 12, color: WB.inkMute, letterSpacing: '0.02em' }}>
                論點{dec.thesisState === 'broken' ? '破裂' : dec.thesisState === 'weakening' ? '弱化' : '完整'}
                {' · 信心'}{dec.confidence === 'high' ? '高' : dec.confidence === 'medium' ? '中' : '低'}
                {nextEvent?.date && <> · 下個事件 {nextEvent.date} {nextEvent.summary || nextEvent.title || ''}</>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 頁腳 nav */}
      <div className="holdings-detail-footer" style={{
        padding: '14px 22px 22px', borderTop: `1px solid ${WB.hair}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: SERIF, fontSize: 13, color: WB.inkSub,
      }}>
        <button
          onClick={() => prev && setExpandedDecision(prev.code)}
          disabled={!prev}
          style={footerBtn(WB, !!prev)}
        >‹ {prev ? prev.name : '—'}</button>
        <button
          onClick={() => openHoldingDrawer && openHoldingDrawer(h.code)}
          style={{ ...footerBtn(WB, true), color: WB.ink }}
        >研究筆記</button>
        <button
          onClick={() => next && setExpandedDecision(next.code)}
          disabled={!next}
          style={{ ...footerBtn(WB, !!next), textAlign: 'right' as const }}
        >{next ? next.name : '—'} ›</button>
      </div>

      {/* 離屏匯出 */}
      {exportNode && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={exportHostRef}
          aria-hidden="true"
          data-export-host
          data-export-variant={exportNode.variant}
          style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', zIndex: -1 }}
        >
          <HoldingExportCard variant={exportNode.variant} {...exportCardProps} />
        </div>,
        document.body
      )}
    </div>
  );
}

// ──────────────────── UI atoms ────────────────────

function TextBtn({ children, onClick, disabled, label, WB }) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label={label}
      style={{
        background: 'transparent', border: 'none', padding: '4px 6px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? WB.inkLight : WB.ink,
        fontFamily: 'inherit', fontSize: 14, letterSpacing: '0.06em',
      }}
    >{children}</button>
  );
}

function footerBtn(WB, enabled) {
  return {
    flex: 1, minWidth: 0, padding: '6px 8px',
    background: 'transparent', border: 'none',
    cursor: enabled ? 'pointer' : 'not-allowed',
    color: enabled ? WB.inkSub : WB.inkLight,
    fontFamily: SERIF, fontSize: 13,
    whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const,
    textAlign: 'left' as const,
  };
}

// ──────────────────── Menus ────────────────────

function menuContentStyle(WB) {
  return {
    minWidth: 160, background: WB.surface, border: `1px solid ${WB.hair}`,
    borderRadius: 0, padding: 4, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 60,
  } as React.CSSProperties;
}
function menuItemStyle(WB, active) {
  return {
    background: active ? WB.surfaceSoft : 'transparent',
    border: 'none', color: WB.ink, fontSize: 12,
    padding: '7px 10px', textAlign: 'left' as const, cursor: 'pointer',
    fontFamily: 'inherit', borderRadius: 0, letterSpacing: '0.02em',
    outline: 'none', display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  } as React.CSSProperties;
}
function triggerStyle(WB) {
  return {
    background: 'transparent', border: 'none', padding: '4px 6px', cursor: 'pointer',
    color: WB.ink, fontFamily: 'inherit', fontSize: 12, letterSpacing: '0.02em',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  } as React.CSSProperties;
}

function SortMenu({ WB, sortBy, sortDir, setSortBy, setSortDir }) {
  const OPTIONS = [
    { key: 'decision', label: '決策優先' },
    { key: 'value', label: '佔比 / 市值' },
    { key: 'pct', label: '報酬率' },
    { key: 'pnl', label: '損益金額' },
    { key: 'urgency', label: '急迫度' },
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label="排序" style={triggerStyle(WB)}>排序 <ChevronDown size={11} /></button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} style={menuContentStyle(WB)}>
          {OPTIONS.map((o) => (
            <DropdownMenu.Item
              key={o.key}
              onSelect={() => setSortBy?.(o.key)}
              style={menuItemStyle(WB, sortBy === o.key)}
            >{o.label}</DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator style={{ height: 1, background: WB.hair, margin: '4px 0' }} />
          <DropdownMenu.Item
            onSelect={(e) => { e.preventDefault(); setSortDir?.(sortDir === 'asc' ? 'desc' : 'asc'); }}
            style={menuItemStyle(WB, false)}
          >方向：{sortDir === 'asc' ? '由小到大 ↑' : '由大到小 ↓'}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PrefsMenu({ WB, prefs, setPrefs }) {
  // §4 已刪除獨立區塊（區間/成本/TARGET 進度條/圖表）→ 開關收斂到論點與情境模擬。
  const TOGGLES: [string, string][] = [
    ['showThesis', '論點引文'],
    ['showSandbox', '情境模擬'],
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label="顯示偏好" style={triggerStyle(WB)}>顯示</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} style={menuContentStyle(WB)}>
          {TOGGLES.map(([k, label]) => {
            const checked = !!prefs[k];
            return (
              <DropdownMenu.CheckboxItem
                key={k} checked={checked}
                onCheckedChange={(v) => setPrefs((p) => ({ ...p, [k]: !!v }))}
                onSelect={(e) => e.preventDefault()}
                style={menuItemStyle(WB, checked)}
              >
                <span style={{
                  width: 12, height: 12, border: `1px solid ${WB.hair}`, borderRadius: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: checked ? WB.ink : 'transparent',
                }}>{checked && <Check size={9} color={WB.surface} />}</span>
                {label}
              </DropdownMenu.CheckboxItem>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ExportMenu({ WB, prefs, setPrefs, onExport, onCopy, busy }) {
  const Seg = ({ label, value, options, onChange }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px 0' }}>
      <span style={{ fontSize: 10, color: WB.inkLight, letterSpacing: '0.14em' }}>{label}</span>
      <div style={{ display: 'inline-flex', border: `1px solid ${WB.hair}`, borderRadius: 0, overflow: 'hidden' }}>
        {options.map((o, i) => {
          const active = value === o.value;
          return (
            <button key={o.value} type="button"
              onClick={(e) => { e.preventDefault(); onChange(o.value); }}
              style={{
                flex: 1, padding: '6px 10px', fontSize: 11, fontFamily: 'inherit',
                background: active ? WB.ink : 'transparent', color: active ? WB.surface : WB.inkSub,
                border: 'none', borderLeft: i === 0 ? 'none' : `1px solid ${WB.hair}`,
                cursor: 'pointer', letterSpacing: '0.02em', whiteSpace: 'nowrap',
              }}>{o.label}</button>
          );
        })}
      </div>
    </div>
  );
  const pxBase = prefs.ratio === 'wide' ? 1920 : 1080;
  const px = pxBase * ((RES_TO_PR[prefs.resolution] ?? 3) / 3);
  const ratioWord = prefs.ratio === 'wide' ? '16:9' : '1:1';
  const summary = `${ratioWord} · ${prefs.format.toUpperCase()} · ${RES_LABEL[prefs.resolution] || prefs.resolution}`;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label="匯出" data-testid="holdings-export-menu" style={triggerStyle(WB)}>匯出</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} style={{ ...menuContentStyle(WB), minWidth: 250, padding: 0, gap: 0 }}>
          <div data-testid="export-seg-ratio">
            <Seg label="比例" value={prefs.ratio} onChange={(v) => setPrefs((p) => ({ ...p, ratio: v }))}
              options={[{ value: 'square', label: '1:1 IG' }, { value: 'wide', label: '16:9 簡報' }]} />
          </div>
          <div data-testid="export-seg-format">
            <Seg label="格式" value={prefs.format} onChange={(v) => setPrefs((p) => ({ ...p, format: v }))}
              options={[{ value: 'png', label: 'PNG' }, { value: 'pdf', label: 'PDF' }]} />
          </div>
          <div data-testid="export-seg-resolution">
            <Seg label="解析度" value={prefs.resolution} onChange={(v) => setPrefs((p) => ({ ...p, resolution: v }))}
              options={[
                { value: 'std', label: '標準 2x' },
                { value: 'high', label: '高 3x' },
                { value: 'print', label: '印刷 4x' },
              ]} />
          </div>
          <div style={{ padding: '10px 10px 8px', marginTop: 4, borderTop: `1px solid ${WB.hair}` }}>
            <DropdownMenu.Item asChild onSelect={(e) => { if (busy) e.preventDefault(); else onExport(); }}>
              <button type="button" data-testid="holding-export-trigger" disabled={busy}
                style={{
                  width: '100%', padding: '9px 12px', background: WB.ink, color: WB.surface,
                  border: 'none', borderRadius: 0, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
                  fontSize: 12, letterSpacing: '0.1em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, outline: 'none',
                }}>
                {prefs.format === 'pdf' ? <FileText size={12} /> : <ImageIcon size={12} />}
                立即匯出（{Math.round(px)}px · {summary}）
              </button>
            </DropdownMenu.Item>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 4px 4px' }}>
            <DropdownMenu.Item
              onSelect={(e) => { if (busy) e.preventDefault(); else onCopy(); }}
              style={menuItemStyle(WB, false)}
            ><Copy size={12} /> 複製 1:1 PNG 到剪貼簿</DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ──────────────────── §4.5 價格軸 ────────────────────

function PriceAxis({ WB, price, cost, target, baseTarget, upside, tpHistory }) {
  const pts = [cost, price, target].filter((v) => Number.isFinite(Number(v)) && Number(v) > 0).map(Number);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts) * 0.95;
  const hi = Math.max(...pts) * 1.05;
  const pos = (v) => Number.isFinite(Number(v)) ? ((Number(v) - lo) / (hi - lo)) * 100 : null;
  const labelPos = (v) => {
    const x = pos(v);
    return x == null ? null : Math.min(92, Math.max(8, x));
  };
  const tpLabel = tpHistory
    ? `目標 ${Number(target).toLocaleString()} ${tpHistory.arrow}${Math.abs(tpHistory.deltaPct).toFixed(0)}%`
    : (target != null ? `目標 ${Number(target).toLocaleString()}` : null);
  const note = tpHistory && upside != null
    ? `共識 ${tpHistory.spanDays} 日內由 ${tpHistory.from.toLocaleString()} ${tpHistory.arrow === '↓' ? '下修' : '上修'}至 ${tpHistory.last.toLocaleString()}，${upside >= 0 ? '仍高於' : '低於'}現價 ${Math.abs(upside).toFixed(1)}%${upside < 0 ? '——已超漲' : ''}`
    : null;
  const H = 70;
  const y = H * 0.55;
  const markers = [
    { v: cost, color: WB.inkLight, label: '成本', shape: 'tick', side: 'top' },
    { v: target, color: WB.accent, label: '目標', shape: 'tick', side: 'top' },
    { v: price, color: WB.ink, label: '現價', shape: 'dot', side: 'bottom' },
  ].map((p) => ({ ...p, x: pos(p.v), lx: labelPos(p.v) })).filter((p) => p.x != null);
  return (
    <div data-testid="holdings-price-axis" style={{ margin: '0 0 20px', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: WB.inkMute, letterSpacing: '0.14em' }}>價格</span>
        {tpLabel && (
          <span style={{
            fontSize: 12, color: tpHistory?.arrow === '↓' ? WB.accent : WB.inkSub,
            fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em',
          }}>{tpLabel}</span>
        )}
      </div>
      <div style={{ position: 'relative', height: H, minWidth: 0, overflow: 'hidden' }}>
        {/* ⚠️ 禁止在 preserveAspectRatio="none" 的 SVG 內使用 <circle>/<rect> 等填色幾何形狀：
            X/Y 非等比縮放會把「圓」拉成扁橢圓（越寬螢幕越扁）。
            解法：只有 stroke 幾何（line、polyline）能留在 SVG 內（配 vector-effect="non-scaling-stroke"），
            其他圓點／方塊一律用 HTML overlay <div> 以真實 px 尺寸繪製。 */}
        <svg width="100%" height={H} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: H, overflow: 'hidden' }}>
          <line x1="0" y1={y} x2="100" y2={y} stroke={WB.hair} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {markers.filter((p) => p.shape === 'tick').map((p, i) => (
            <line key={`tick-${i}`}
              x1={`${p.x}%`} y1={y - 5} x2={`${p.x}%`} y2={y + 5}
              stroke={p.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {/* HTML overlay：現價圓點（真實 px、永遠正圓） */}
        {markers.filter((p) => p.shape === 'dot').map((p, i) => (
          <span
            key={`dot-${i}`}
            data-testid="holdings-price-axis-dot"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${p.x}%`,
              top: y,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: p.color,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
        ))}
        {markers.map((p, i) => (
          <span
            key={`label-${i}`}
            style={{
              position: 'absolute',
              left: `${p.lx}%`,
              top: p.side === 'top' ? y - 28 : y + 9,
              transform: 'translateX(-50%)',
              maxWidth: 82,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 10,
              color: WB.inkSub,
              letterSpacing: '0.02em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: '14px',
              pointerEvents: 'none',
            }}
          >{p.label} {Number(p.v).toFixed(2)}</span>
        ))}
      </div>
      {note && (
        <div style={{ marginTop: 8, fontFamily: SERIF, fontSize: 13, color: WB.inkSub, lineHeight: 1.65 }}>
          {note}
        </div>
      )}
    </div>
  );
}

// ──────────────────── §4.6 30D 走勢帶 ────────────────────

export function RangeBand({ WB, price, low, high, spark, symbol, priceSource, priceUpdatedAt }) {
  // 顯示高度（px）：header 迷你 sparkline 移除後，把 30D 走勢帶拉高填補視覺空缺，
  // 讓唯一保留的折線圖能承接原本的縱向重量、與 PriceAxis / WeightRank 對齊。
  const svgH = 72;
  // 淨化輸入：過濾 NaN / 非數值 spark；lo/hi 必須是有限數
  const lo = Number.isFinite(low) ? Number(low) : NaN;
  const hi = Number.isFinite(high) ? Number(high) : NaN;
  const cleanSpark = Array.isArray(spark)
    ? spark.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];
  const hasHiLo = Number.isFinite(lo) && Number.isFinite(hi);
  const range = hasHiLo ? hi - lo : 0;
  // 允許 range === 0（平盤）：仍畫水平線 + 紅點置中；只需 spark 至少 2 點且 hi/lo 可用
  const hasSpark = hasHiLo && cleanSpark.length >= 2;
  // 紅點 y：range>0 用 spark 末值換算；range=0 或 spark 缺失 → 置中，永不 NaN
  const lastV = hasSpark ? cleanSpark[cleanSpark.length - 1] : Number(price);
  const rawY =
    range > 0 && Number.isFinite(lastV)
      ? svgH - ((lastV - lo) / range) * svgH
      : svgH / 2;
  const dotY = Number.isFinite(rawY) ? Math.min(Math.max(rawY, 0), svgH) : svgH / 2;
  // hi/lo label 需要 fallback，避免 toFixed 對 NaN 拋出 "NaN"
  const loLabel = Number.isFinite(lo) ? lo.toFixed(2) : '—';
  const hiLabel = Number.isFinite(hi) ? hi.toFixed(2) : '—';

  // ── 資料源一致性偵測：spark 末值 vs live price，價格是否落於 [lo, hi] 之外 ──
  const priceN = Number(price);
  const diagnostics = React.useMemo(() => {
    const issues = [];
    if (hasSpark && Number.isFinite(priceN) && Number.isFinite(lastV) && lastV > 0) {
      const drift = Math.abs(priceN - lastV) / lastV;
      if (drift > 0.03) {
        issues.push({
          code: 'SPARK_VS_PRICE_DRIFT',
          drift: Number(drift.toFixed(4)),
          sparkLast: lastV,
          price: priceN,
        });
      }
    }
    if (hasHiLo && Number.isFinite(priceN)) {
      if (priceN < lo * 0.999 || priceN > hi * 1.001) {
        issues.push({
          code: 'PRICE_OUT_OF_RANGE',
          price: priceN,
          low: lo,
          high: hi,
        });
      }
    }
    if (hasSpark && Number.isFinite(lastV) && hasHiLo) {
      if (lastV < lo - 1e-6 || lastV > hi + 1e-6) {
        issues.push({
          code: 'SPARK_OUT_OF_RANGE',
          sparkLast: lastV,
          low: lo,
          high: hi,
        });
      }
    }
    return issues;
  }, [hasSpark, hasHiLo, priceN, lastV, lo, hi]);

  useEffect(() => {
    if (!diagnostics.length) return;
    const sym = symbol || 'unknown';
    // Session-scope 去重：同 symbol + code 只 fire 一次，避免刷屏
    const g = (typeof window !== 'undefined' ? window : globalThis);
    g.__hRangeBandDiagFired ||= new Set();
    diagnostics.forEach((d) => {
      const key = `${sym}:${d.code}`;
      if (g.__hRangeBandDiagFired.has(key)) return;
      g.__hRangeBandDiagFired.add(key);
      const payload = {
        symbol: sym,
        code: d.code,
        priceSource: priceSource || null,
        priceUpdatedAt: priceUpdatedAt || null,
        ...d,
      };
      // 測試觀測面：無條件推進 window array（E2E harness 讀取用；prod 亦保留，體積可忽略）
      try {
        g.__rangeBandDiagnostics ||= [];
        g.__rangeBandDiagnostics.push(payload);
      } catch { /* noop */ }
      if (import.meta?.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[RangeBand] data source inconsistency', payload);
      }
      try {
        import('@/lib/analytics/events').then(({ trackRaw }) => {
          trackRaw('holdings_range_band_inconsistency', payload);
        }).catch(() => {});
      } catch { /* noop */ }
    });
  }, [diagnostics, symbol, priceSource, priceUpdatedAt]);

  const hasIssue = diagnostics.length > 0;
  const issueTitle = hasIssue
    ? `資料源不一致：${diagnostics.map((d) => d.code).join(', ')}`
    : undefined;

  return (
    <div
      data-testid="holdings-range-band"
      data-inconsistent={hasIssue ? '1' : undefined}
      data-inconsistent-codes={hasIssue ? diagnostics.map((d) => d.code).join(',') : undefined}
      style={{ margin: '0 0 20px', minWidth: 0 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: WB.inkMute, letterSpacing: '0.14em' }}>
          30 日走勢
          {hasIssue && (
            <span
              data-testid="holdings-range-band-warn"
              title={issueTitle}
              aria-label={issueTitle}
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#D97706',
                marginLeft: 8,
                verticalAlign: 'middle',
              }}
            />
          )}
        </span>
        <span style={{ fontSize: 12, color: WB.inkSub, fontVariantNumeric: 'tabular-nums' }}>
          低 {loLabel}<span style={{ margin: '0 6px', color: WB.inkLight }}>—</span>高 {hiLabel}
        </span>
      </div>
      {hasSpark && (
        <div style={{ position: 'relative', width: '100%', height: svgH }}>
          {/* preserveAspectRatio="none" SVG 只放 stroke polyline；圓點禁止進 SVG（會被壓成橢圓） */}
          <svg viewBox="0 0 100 30" preserveAspectRatio="none"
            style={{ width: '100%', height: svgH, display: 'block', position: 'absolute', inset: 0 }}>
            <polyline fill="none" stroke={WB.inkSub} strokeWidth="1" vectorEffect="non-scaling-stroke"
              points={cleanSpark.map((v, i) => {
                const x = (i / (cleanSpark.length - 1)) * 100;
                // range===0（平盤）→ 全部 y 置中，避免除零 NaN
                const yy = range > 0 ? 30 - ((v - lo) / range) * 30 : 15;
                return `${x.toFixed(2)},${yy.toFixed(2)}`;
              }).join(' ')} />
          </svg>
          {/* HTML overlay：現價圓點（真實 px 正圓）— 固定貼齊時間軸末端 */}
          <span
            data-testid="holdings-range-band-dot"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '100%',
              top: dotY,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: WB.accent,
              transform: 'translate(-100%, -50%)',
              pointerEvents: 'none',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ──────────────────── §4.7 佔比排名 ────────────────────

function WeightRank({ WB, h, orderedDisplayed, totalPortfolioValue }) {
  const list = Array.isArray(orderedDisplayed) ? orderedDisplayed : [];
  if (!list.length || !(totalPortfolioValue > 0)) return null;
  const items = list.map((x) => {
    const v = Number(x.value ?? (Number(x.price) * Number(x.qty)) ?? 0);
    return { code: x.code, name: x.name, value: v, pct: (v / totalPortfolioValue) * 100 };
  }).sort((a, b) => b.pct - a.pct);
  const topIdx = 0;
  const meIdx = items.findIndex((x) => x.code === h.code);
  const shown = Array.from(new Set([topIdx, meIdx, ...items.slice(0, 5).map((_, i) => i)]))
    .filter((i) => i >= 0 && i < items.length)
    .slice(0, 6);
  const maxPct = Math.max(...items.map((r) => r.pct), 1);
  return (
    <div data-testid="holdings-weight-rank" style={{ margin: '0 0 20px', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: WB.inkMute, letterSpacing: '0.14em' }}>佔比</span>
        <span style={{ fontSize: 12, color: WB.inkSub, fontVariantNumeric: 'tabular-nums' }}>
          排名 #{meIdx + 1} ／ {items.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {shown.map((idx) => {
          const r = items[idx];
          const isMe = r.code === h.code;
          const w = (r.pct / maxPct) * 100;
          return (
            <div key={r.code} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr) 56px', gap: 6, alignItems: 'center', minWidth: 0 }}>
              <span style={{ fontSize: 10, color: WB.inkMute, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>#{idx + 1}</span>
              <div style={{ height: 10, background: WB.hair, position: 'relative', overflow: 'hidden' }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(2, w)}%`,
                  background: isMe ? WB.accent : WB.inkLight, opacity: isMe ? 1 : 0.9,
                }} />
                <span style={{
                  position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
                  maxWidth: 'calc(100% - 12px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontSize: 10, color: WB.surface, letterSpacing: '0.02em', pointerEvents: 'none',
                }}>{r.code} · {r.name}</span>
              </div>
              <span style={{ fontSize: 11, color: isMe ? WB.ink : WB.inkSub, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                {r.pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────── §4.8 決策履歷 ────────────────────

function ThesisHistory({ WB, rows }) {
  const success = rows.filter((r) => r.afterPct != null && r.myAction === r.suggestion && r.afterPct > 0).length;
  const total = rows.length;
  return (
    <div data-testid="holdings-thesis-history" style={{ margin: '0 0 20px', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: WB.inkMute, letterSpacing: '0.14em' }}>決策履歷</span>
        <span style={{ fontSize: 12, color: WB.inkSub, fontVariantNumeric: 'tabular-nums' }}>
          近 {total} 次照做勝率 {success}／{total}
        </span>
      </div>
      <div>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '80px 80px 1fr 60px', gap: 8, alignItems: 'baseline',
            padding: '6px 0', borderBottom: i < rows.length - 1 ? `1px solid ${WB.hair}` : 'none',
            fontSize: 12, color: WB.inkSub, fontVariantNumeric: 'tabular-nums',
          }}>
            <span style={{ fontFamily: SERIF }}>{r.date}</span>
            <span>{ACTION_LABEL[r.suggestion] || r.suggestion}</span>
            <span style={{ color: WB.inkMute }}>{r.myAction}</span>
            <span style={{
              textAlign: 'right' as const,
              color: r.afterPct == null ? WB.inkLight : r.afterPct >= 0 ? WB.accent : '#8A857F',
            }}>
              {r.afterPct == null ? '—' : `${r.afterPct >= 0 ? '+' : '−'}${Math.abs(r.afterPct).toFixed(1)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────── Scenario Sandbox ────────────────────

function ScenarioSandbox({ WB, prefs, setPrefs, sim, setSim, baseTarget, h, scenario, dirty, onReset, canUndo, canRedo, onUndo, onRedo }) {
  const open = !!prefs.showSandbox;
  return (
    <div style={{
      marginTop: 4, marginBottom: 16, border: `1px solid ${WB.hair}`, borderRadius: 0,
      background: open ? WB.surfaceSoft : 'transparent',
    }}>
      <button
        onClick={() => setPrefs((p) => ({ ...p, showSandbox: !p.showSandbox }))}
        style={{
          width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: SERIF,
          color: WB.ink, fontSize: 14, letterSpacing: '0.04em',
        }}>
        <span>情境模擬{dirty && <span style={{ marginLeft: 8, fontSize: 10, color: WB.accent, letterSpacing: '0.2em' }}>SIM</span>}</span>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <div className="hp-sandbox-fields" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field WB={WB} label="目標價" type="number" step="0.01"
              value={sim.target} onChange={(v) => setSim((s) => ({ ...s, target: v }), 'target')}
              placeholder={baseTarget != null ? String(baseTarget) : '—'} />
            <Field WB={WB} label={`Δ 股數（${sim.deltaQty >= 0 ? '加碼' : '減碼'} ${Math.abs(Number(sim.deltaQty) || 0)}）`}>
              <input
                type="range" min={-Math.max(1, h.qty || 1)} max={Math.max(1, h.qty || 1)} step={Math.max(1, Math.floor((h.qty || 20) / 20))}
                value={Number(sim.deltaQty) || 0}
                onChange={(e) => setSim((s) => ({ ...s, deltaQty: Number(e.target.value) }), 'deltaQty')}
                style={{ width: '100%' }} />
            </Field>
            <Field WB={WB} label="加碼價" type="number" step="0.01"
              value={sim.buyMorePrice} onChange={(v) => setSim((s) => ({ ...s, buyMorePrice: v }), 'buyMorePrice')} placeholder="—" />
            <Field WB={WB} label="停損價" type="number" step="0.01"
              value={sim.stopPrice} onChange={(v) => setSim((s) => ({ ...s, stopPrice: v }), 'stopPrice')} placeholder="—" />
          </div>
          <div className="hp-sandbox-stats" style={{
            marginTop: 12, padding: '10px 12px', background: WB.surface, borderRadius: 0,
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 8,
            border: `1px solid ${WB.hair}`,
          }}>
            <Stat WB={WB} label="均價" value={fmt(scenario.simAvgCost)} />
            <Stat WB={WB} label="損益" value={scenario.simPnlPct != null ? `${scenario.simPnlPct >= 0 ? '+' : '−'}${Math.abs(scenario.simPnlPct).toFixed(2)}%` : '—'}
              color={scenario.simPnlPct > 0 ? WB.accent : scenario.simPnlPct < 0 ? '#8A857F' : null} />
            <Stat WB={WB} label="上檔" value={scenario.upsidePct != null ? `${scenario.upsidePct >= 0 ? '+' : '−'}${Math.abs(scenario.upsidePct).toFixed(1)}%` : '—'}
              color={scenario.upsidePct > 0 ? WB.accent : null} />
            <Stat WB={WB} label="風報比" value={scenario.riskReward != null ? `1 : ${scenario.riskReward.toFixed(2)}` : '—'} />
          </div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 11, color: WB.inkMute }}>模擬僅供決策參考，不寫回資料庫。</span>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Cmd/Ctrl+Z" style={historyBtn(WB, canUndo)}>
                <Undo2 size={11} /> 上一步
              </button>
              <button onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Cmd/Ctrl+Shift+Z" style={historyBtn(WB, canRedo)}>
                <Redo2 size={11} /> 下一步
              </button>
              <button onClick={onReset} disabled={!dirty} style={historyBtn(WB, dirty)}>
                <RotateCcw size={11} /> 重設
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function historyBtn(WB, enabled) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
    background: 'transparent', border: `1px solid ${WB.hair}`, borderRadius: 0,
    color: enabled ? WB.ink : WB.inkLight, fontSize: 11, cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit', letterSpacing: '0.04em',
  };
}

function Field({ WB, label, value, onChange, type, step, placeholder, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: WB.inkLight, letterSpacing: '0.14em' }}>{label}</span>
      {children ? children : (
        <input
          type={type || 'text'} step={step} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{
            padding: '7px 10px', border: `1px solid ${WB.hair}`, borderRadius: 0,
            background: WB.surface, color: WB.ink, fontSize: 13, fontFamily: 'inherit',
            fontVariantNumeric: 'tabular-nums', outline: 'none',
          }} />
      )}
    </label>
  );
}
function Stat({ WB, label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: WB.inkLight, letterSpacing: '0.14em' }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 15, fontWeight: 500, color: color || WB.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function fmt(v) { return Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'; }

const HoldingsDetailPanel = React.memo(HoldingsDetailPanelImpl);
export default HoldingsDetailPanel;
