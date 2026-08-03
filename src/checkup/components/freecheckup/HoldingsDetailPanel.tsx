// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Camera, Download, Copy, X as XIcon, Settings, ChevronDown,
  FileText, Image as ImageIcon, Check, Info,
} from 'lucide-react';
import { useHoldingShareExport } from '@/checkup/hooks/useHoldingShareExport';
// Sparkline removed: header 迷你折線與 §6 RangeBand 資訊重複，僅保留 RangeBand。
import { useHoldingDetailViewModel } from '@/checkup/hooks/useHoldingDetailViewModel';
import HoldingExportCard from './HoldingExportCard';
import ChipsSection from './ChipsSection';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import '@/checkup/styles/holdingsDetailPanel.css';
import { holdingPanelPrefs, holdingExportPrefs } from '@/checkup/lib/drawerPrefs';
import { useFreshness } from '@/checkup/lib/freshness';
import { buildVolumeAnalysis } from '@/checkup/lib/volumeAnalysis';
import { buildDailyCloseStatus } from '@/checkup/lib/marketDataStatus';
import { getSparkOhlc } from '@/checkup/lib/holdingDetailViewModel';
import { rollingLots, buildTooltipRows, resistanceBadge, buildVolumeMetrics } from '@/checkup/lib/volumeReadout';
import { barIndexFromX, barCenterPct, shouldFlipTooltip, fmtKlineDate, fmtKlineNum } from '@/checkup/lib/klineTooltip';
import {
  resolveLabelBox, assignLanes, laneTopOffset,
  LABEL_FONT_SIZE, LABEL_LINE_HEIGHT,
  resolveTrackMetrics, toCompactRow,
} from '@/checkup/lib/priceAxisLabel';


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
 *   8) 決策履歷（thesisTracking 表格；資料未通時顯示 placeholder）
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
  // 價格新鮮度：抽屜以往只顯示來源不顯示時間，開著也不會隨時鐘更新。
  // 統一走 freshness 單一資料源（內建 ticker）。
  const priceUpdatedMs = h?.priceUpdatedAt ? new Date(h.priceUpdatedAt).getTime() : null;
  const priceFreshness = useFreshness(Number.isFinite(priceUpdatedMs as number) ? priceUpdatedMs : null);

  // 日 K 收盤確認狀態（與盤中報價時間分開陳述，禁止用 polling 時間冒充收盤）
  const closeStatus = useMemo(() => buildDailyCloseStatus({
    bars: getSparkOhlc(sparkData30D as any),
    source: (sparkData30D as any)?.source ?? null,
    fetchedAt: (sparkData30D as any)?.fetchedAt ?? null,
  }), [sparkData30D]);

  const pnlColor = displayPnlPct > 0 ? WB.accent : displayPnlPct < 0 ? '#8A857F' : WB.inkMute;


  // ── 匯出 ──
  const exportCardProps = useMemo(() => ({
    holding: h, decision: dec, meta,
    scenario: null,
    baseTarget, pctVal: displayPnlPct, pnlVal: displayPnlAbs,
    rangeLow, rangeHigh,
    reversalLine: vm.volumeAnalysis?.reversal?.line ?? null,
    closeStatusText: closeStatus?.text ?? null,
    thesis: prefs.showThesis ? thesisSentence : null,
    nextEvent: prefs.showNextEvent ? nextEvent : null,
    stamp, WB,
  }), [h, dec, meta, baseTarget, displayPnlPct, displayPnlAbs, rangeLow, rangeHigh, vm.volumeAnalysis, closeStatus, prefs.showThesis, prefs.showNextEvent, thesisSentence, nextEvent, stamp, WB]);

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
            {priceFreshness.ageMs != null ? (
              <span
                data-testid="drawer-price-freshness"
                data-stale={priceFreshness.stale ? 'true' : 'false'}
                title={`報價更新於 ${priceFreshness.clock}`}
                style={{ marginLeft: 8, opacity: priceFreshness.stale ? 0.85 : 0.5 }}
              >· 報價 {priceFreshness.label}</span>
            ) : null}
            {closeStatus ? (
              <span
                data-testid="drawer-close-status"
                data-final={closeStatus.isFinal ? 'true' : 'false'}
                data-trade-date={closeStatus.tradeDate || ''}
                data-source={closeStatus.source || ''}
                title={closeStatus.fetchedAt ? `資料抓取於 ${closeStatus.fetchedAt}` : undefined}
                style={{ marginLeft: 8, opacity: closeStatus.isFinal ? 0.5 : 0.9 }}
              >· {closeStatus.text}</span>
            ) : null}
          </div>
          <div className="holdings-detail-identity-row">
            <h2 style={{
              margin: 0, fontFamily: SERIF, fontSize: 22, fontWeight: 500,
              color: WB.ink, letterSpacing: '-0.005em', lineHeight: 1.15,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{h.name}</h2>
            {todayPct != null && (
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
          </span>
        </div>

        {/* 5) 一條價格軸（目標 accent／成本 灰／現價 ink 圓點，同一尺 ±5%）+ 目標價修正方向 */}
        <PriceAxis
          WB={WB}
          price={Number(h.price)}
          cost={Number(h.cost)}
          target={displayTarget}
          baseTarget={baseTarget}
          upside={displayUpside}
          tpHistory={tpHistory}
        />

        {/* 6) 30D 走勢帶（K 線；OHLC 不足時退回折線） */}
        {((vm.ohlcArr.length >= 2 && vm.ohlcRangeLow != null && vm.ohlcRangeHigh != null) ||
          (rangeLow != null && rangeHigh != null && rangeHigh > rangeLow)) && (
          <RangeBand
            WB={WB}
            price={Number(h.price)}
            low={vm.ohlcRangeLow ?? rangeLow}
            high={vm.ohlcRangeHigh ?? rangeHigh}
            spark={sparkArr}
            ohlc={vm.ohlcArr}
            va={vm.volumeAnalysis}
            symbol={h?.code || h?.symbol || h?.instrument}
            priceSource={meta?.priceSource || h?.priceSource}
            priceUpdatedAt={h?.priceUpdatedAt}
          />
        )}

        {/* 8) 決策履歷 */}
        {thesisRows && <ThesisHistory WB={WB} rows={thesisRows} />}

        {/* 8.5) 籌碼面（僅台股） */}
        <ChipsSection WB={WB} stockCode={h.code} />


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
  // 量測軌道實寬 → 標籤字寬 / 換行 / 錨定規則的唯一輸入（見 lib/priceAxisLabel.ts）
  const trackRef = useRef(null);
  const [trackWidth, setTrackWidth] = useState(320);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const measure = () => setTrackWidth(Math.round(el.getBoundingClientRect().width) || 320);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  // 小螢幕（窄軌道）→ 簡化排版：軌道變矮、標籤改成軸下方堆疊列（見 lib/priceAxisLabel.ts）
  const { compact, height: H, axisY: y } = resolveTrackMetrics(trackWidth);
  const markers = [
    { v: cost, color: WB.inkLight, label: '成本', shape: 'tick', side: 'top' },
    { v: target, color: WB.accent, label: '目標', shape: 'tick', side: 'top' },
    { v: price, color: WB.ink, label: '現價', shape: 'dot', side: 'bottom' },
  ]
    .map((p) => ({ ...p, x: pos(p.v), lx: labelPos(p.v) }))
    .filter((p) => p.x != null)
    .map((p) => {
      const text = `${p.label} ${Number(p.v).toFixed(2)}`;
      return { ...p, text, box: resolveLabelBox({ text, lxPct: Number(p.lx), containerWidth: trackWidth, fontSize: LABEL_FONT_SIZE }) };
    });
  // 上方標籤在抽屜寬度下容易互撞（例如成本 507、目標 710），且字串長度會變
  // （「目標 1,234.56 ↓12%」比「目標 90」寬得多）。lane 分配改由估算字寬決定，
  // 不再用固定 26% 門檻，因此不同字串長度不會造成錯位或誤判不碰撞。
  const laneByLabel = assignLanes(
    markers.filter((p) => p.side === 'top').map((p) => ({ label: p.label, text: p.text, lxPct: Number(p.lx) })),
    trackWidth,
    LABEL_FONT_SIZE,
  );
  const anyWrapped = markers.some((p) => p.side === 'top' && p.box.wrap);
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
      <div ref={trackRef} style={{ position: 'relative', height: H, minWidth: 0, overflow: 'hidden' }}>
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
        {!compact && markers.map((p, i) => (
          <span
            key={`label-${i}`}
             data-testid={`holdings-price-axis-label-${p.label === '成本' ? 'cost' : p.label === '目標' ? 'target' : 'price'}`}
            data-label-anchor={p.box.anchor}
            data-label-lines={p.box.lines}
            data-label-mode="float"
            style={{
              position: 'absolute',
              /* 字寬規則單一資料源：resolveLabelBox 依估算字寬決定貼左／置中／貼右，
                 短字串能真正對準刻度，長字串改為兩行而非被截斷，皆不會越界。 */
              left: p.box.left,
              top: p.side === 'top'
                ? 3 + laneTopOffset(laneByLabel.get(p.label) ?? 0, anyWrapped)
                : y + 10,
              transform: p.box.transform,
              maxWidth: p.box.maxWidth,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: p.box.lines,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: p.box.wrap ? 'normal' : 'nowrap',
              overflowWrap: 'anywhere',
              textAlign: p.box.anchor === 'end' ? 'right' : 'left',
              fontSize: LABEL_FONT_SIZE,
              color: WB.inkSub,
              letterSpacing: '0.02em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: `${LABEL_LINE_HEIGHT}px`,
              pointerEvents: 'none',
            }}
          >{p.text}</span>
        ))}
      </div>
      {/* compact：軸下方堆疊列。名稱／數值分欄對齊，數值用 tabular-nums，
          不截斷、不重疊，窄螢幕仍能明確讀到成本與目標價。 */}
      {compact && (
        <div
          data-testid="holdings-price-axis-compact"
          style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, minWidth: 0 }}
        >
          {markers.map((p, i) => {
            const row = toCompactRow({ label: p.label, text: p.text });
            return (
              <div
                key={`row-${i}`}
                data-testid={`holdings-price-axis-label-${p.label === '成本' ? 'cost' : p.label === '目標' ? 'target' : 'price'}`}
                data-label-mode="stacked"
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0,
                  fontSize: 12, lineHeight: '16px', color: WB.inkSub, letterSpacing: '0.02em',
                }}
              >
                <span aria-hidden="true" style={{
                  width: 6, height: 6, borderRadius: '50%', background: p.color, flex: '0 0 auto',
                  alignSelf: 'center',
                }} />
                <span style={{ flex: '0 0 auto', color: WB.inkMute }}>{row.name}</span>
                <span style={{
                  flex: '1 1 auto', textAlign: 'right', color: WB.ink, fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere',
                }}>
                  {row.value}
                  {row.note ? <span style={{ marginLeft: 6, color: WB.accent }}>{row.note}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {note && (
        <div style={{ marginTop: 8, fontFamily: SERIF, fontSize: 13, color: WB.inkSub, lineHeight: 1.65 }}>
          {note}
        </div>
      )}
    </div>
  );
}

// ──────────────────── §4.6 30D 走勢帶 ────────────────────

export function RangeBand({ WB, price, low, high, spark, ohlc, va: vaProp = null, symbol, priceSource, priceUpdatedAt }) {
  // 顯示高度（px）：header 迷你 sparkline 移除後，把 30D 走勢帶拉高填補視覺空缺
  const svgH = 72;
  const lo = Number.isFinite(low) ? Number(low) : NaN;
  const hi = Number.isFinite(high) ? Number(high) : NaN;
  const hasHiLo = Number.isFinite(lo) && Number.isFinite(hi);
  const range = hasHiLo ? hi - lo : 0;

  // 淨化 OHLC 與 legacy spark
  const cleanOhlc = (Array.isArray(ohlc) ? ohlc : []).filter(
    (b) => b && Number.isFinite(b.open) && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close) && b.high > 0
  );
  const cleanSpark = Array.isArray(spark)
    ? spark.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];
  const useKline = cleanOhlc.length >= 2;
  const hasSpark = hasHiLo && (useKline ? cleanOhlc.length >= 2 : cleanSpark.length >= 2);

  // 繪圖區內縮（viewBox 100×30 單位）：避免首尾 K 棒與最高/最低影線被邊界切掉
  const PAD_X = useKline ? 2.4 : 0;
  const PAD_Y = useKline ? 2 : 0;
  const PLOT_H = 30 - PAD_Y * 2;

  const lastV = useKline
    ? cleanOhlc[cleanOhlc.length - 1]?.close
    : (hasSpark ? cleanSpark[cleanSpark.length - 1] : Number(price));
  const rawY =
    range > 0 && Number.isFinite(lastV)
      ? ((30 - PAD_Y - ((lastV - lo) / range) * PLOT_H) / 30) * svgH
      : svgH / 2;
  const dotY = Number.isFinite(rawY) ? Math.min(Math.max(rawY, 0), svgH) : svgH / 2;

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

  // K 線 helpers：在 SVG 100×30 座標系內定位（PAD_X / PAD_Y 於上方定義）
  const yFor = (v) => {
    if (!hasHiLo || range <= 0) return 15;
    return 30 - PAD_Y - Math.min(Math.max((v - lo) / range, 0), 1) * PLOT_H;
  };


  const klineElements = useKline ? (() => {
    const N = cleanOhlc.length;
    const plotW = 100 - PAD_X * 2;
    const gap = plotW / (N - 1);
    const bodyW = Math.max(0.8, Math.min(3.2, gap * 0.6));
    return cleanOhlc.map((b, i) => {
      const x = PAD_X + (i / (N - 1)) * plotW;
      const yHigh = yFor(b.high);
      const yLow = yFor(b.low);
      const yOpen = yFor(b.open);
      const yClose = yFor(b.close);
      const isUp = b.close > b.open;
      const isDown = b.close < b.open;
      const color = isUp ? WB.klineUp || '#E53E3E' : isDown ? WB.klineDown || '#38A169' : WB.inkSub;
      const yTop = Math.min(yOpen, yClose);
      const yBottom = Math.max(yOpen, yClose);
      const bodyH = Math.max(0.35, yBottom - yTop);
      return (
        <g key={i} data-testid="kline-bar">
          <line
            data-testid="kline-wick"
            x1={x.toFixed(2)}
            x2={x.toFixed(2)}
            y1={yHigh.toFixed(2)}
            y2={yLow.toFixed(2)}
            stroke={color}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <rect
            data-testid="kline-candle"
            x={(x - bodyW / 2).toFixed(2)}
            y={yTop.toFixed(2)}
            width={bodyW.toFixed(2)}
            height={bodyH.toFixed(2)}
            fill={color}
            stroke={color}
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    });
  })() : null;


  // ── hover / touch tooltip：顯示該根 K 棒的日期與 OHLC（座標與格式邏輯在 @/checkup/lib/klineTooltip） ──
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hoverBar = useKline && hoverIdx != null ? cleanOhlc[hoverIdx] : null;

  const pickIndex = (clientX) => {
    const el = wrapRef.current;
    if (!el || !useKline) return;
    const r = el.getBoundingClientRect();
    const idx = barIndexFromX(clientX, { left: r.left, width: r.width }, cleanOhlc.length);
    if (idx != null) setHoverIdx(idx);
  };

  const fmtDate = fmtKlineDate;
  const fmtN = fmtKlineNum;

  const hoverX = barCenterPct(hoverIdx, cleanOhlc.length, PAD_X);

  // ── 量能副圖 ──────────────────────────────────────────
  // 契約：量一律「股」進來，顯示一律「張」（@/lib/lotSize）；缺量為 null，
  // 不畫零量柱、不由價格推估，改顯示明確空狀態。
  // 高度比例：K 線是主角，量能副圖約佔總高 23%（22 / (72 + 22)）。
  const volH = 22;
  // 父層沒帶分析結果時自行推導，讓 harness / 其他 caller 也能拿到同一份判讀
  const va = React.useMemo(() => (
    vaProp ?? (useKline
      ? buildVolumeAnalysis({ rawBars: cleanOhlc, price: Number(price), displayCount: cleanOhlc.length })
      : null)
  ), [vaProp, useKline, cleanOhlc, price]);
  const volBars = React.useMemo(() => (
    Array.isArray(va?.displayBars) && va.displayBars.length === cleanOhlc.length
      ? va.displayBars
      : cleanOhlc.map((b) => ({
          ...b,
          volumeLots: Number.isFinite(b?.volume) && b.volume > 0 ? Number(b.volume) / 1000 : null,
        }))
  ), [va, cleanOhlc]);
  const hasVolume = volBars.some((b) => b?.volumeLots != null);
  const maxVol = hasVolume ? Math.max(...volBars.map((b) => b?.volumeLots ?? 0)) : 0;
  const ma5Line = React.useMemo(() => (
    Array.isArray(va?.displayMa5) && va.displayMa5.length === volBars.length
      ? va.displayMa5
      : rollingLots(volBars, 5)
  ), [va, volBars]);
  const ma20Line = React.useMemo(() => rollingLots(volBars, 20), [volBars]);
  const stats = va?.stats ?? null;
  const zone = va?.zone ?? null;
  const distance = va?.distance ?? null;

  // 窄版（手機／窄抽屜）：metric 走 2 欄 grid，避免擠成一條極小字
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || 0;
      if (w > 0) setCompact(w < 420);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const badge = React.useMemo(
    () => resistanceBadge({ zone, distance, domain: hasHiLo ? { low: lo, high: hi } : null }),
    [zone, distance, hasHiLo, lo, hi],
  );
  const metrics = React.useMemo(
    () => buildVolumeMetrics({ stats, badge, hasVolume }),
    [stats, badge, hasVolume],
  );

  const volElements = hasVolume && maxVol > 0 ? (() => {
    const N = volBars.length;
    const plotW = 100 - PAD_X * 2;
    const gap = N > 1 ? plotW / (N - 1) : plotW;
    // 手機仍要看得出量柱：下限拉到 1.2 單位寬
    const bodyW = Math.max(1.2, Math.min(3.2, gap * 0.62));
    return volBars.map((b, i) => {
      if (b?.volumeLots == null) return null;
      const x = PAD_X + (N > 1 ? (i / (N - 1)) * plotW : plotW / 2);
      const hh = Math.max(0.6, (b.volumeLots / maxVol) * 24);
      const isUp = b.close > b.open;
      const isDown = b.close < b.open;
      const color = isUp ? (WB.klineUp || '#E53E3E') : isDown ? (WB.klineDown || '#38A169') : WB.inkLight;
      return (
        <rect
          key={i}
          data-testid="volume-bar"
          x={(x - bodyW / 2).toFixed(2)}
          y={(26 - hh).toFixed(2)}
          width={bodyW.toFixed(2)}
          height={hh.toFixed(2)}
          fill={color}
          opacity="0.5"
        />
      );
    });
  })() : null;

  const ma5Points = ma5Line && maxVol > 0
    ? ma5Line.map((v, i) => {
        if (v == null) return null;
        const N = ma5Line.length;
        const plotW = 100 - PAD_X * 2;
        const x = PAD_X + (N > 1 ? (i / (N - 1)) * plotW : plotW / 2);
        const y = 26 - Math.min(v / maxVol, 1) * 24;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      }).filter(Boolean).join(' ')
    : '';

  // 壓力帶：只有落在目前價格軸範圍內才畫，避免壓縮 K 棒刻度
  const zoneRect = zone && hasHiLo && range > 0 && zone.lower <= hi && zone.upper >= lo
    ? (() => {
        const yTop = yFor(Math.min(zone.upper, hi));
        const yBot = yFor(Math.max(zone.lower, lo));
        return { y: yTop, h: Math.max(0.4, yBot - yTop) };
      })()
    : null;
  // 壓力標籤 top（px）：夾在圖內，不出界、不壓到最後一根 K 棒（靠左擺放）
  const zoneLabelTop = zoneRect
    ? Math.min(Math.max((zoneRect.y / 30) * svgH - 1, 0), svgH - 14)
    : null;

  const fmtLots = (v) => (v == null ? '—' : `${Math.round(v).toLocaleString('zh-TW')} 張`);

  // ── 歷史轉折標記：只有 displayBars 與畫面 K 棒對齊時才畫，避免索引錯位 ──
  const reversalMarkers = React.useMemo(() => {
    const ms = va?.reversal?.markers;
    if (!Array.isArray(ms) || !ms.length) return [];
    if (!Array.isArray(va?.displayBars) || va.displayBars.length !== cleanOhlc.length) return [];
    return ms.filter((m) => m.index >= 0 && m.index < cleanOhlc.length);
  }, [va, cleanOhlc.length]);

  // ── tooltip 內容（hover / keyboard 共用同一份） ──
  const tip = React.useMemo(
    () => (useKline && hoverIdx != null
      ? buildTooltipRows(volBars, hoverIdx, {
        ma5: ma5Line, ma20: ma20Line, signals: va?.reversal?.byDateDetailed ?? va?.reversal?.byDate,
      })
      : null),
    [useKline, hoverIdx, volBars, ma5Line, ma20Line, va],
  );

  // 切換標的：清掉上一檔的 hover 殘留（量柱／均量／壓力狀態皆由 props 重新推導）
  useEffect(() => { setHoverIdx(null); }, [symbol]);

  const onChartKeyDown = (e) => {
    if (!useKline) return;
    const N = cleanOhlc.length;
    const cur = hoverIdx == null ? N - 1 : hoverIdx;
    let next = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') next = Math.min(N - 1, cur + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = N - 1;
    else if (e.key === 'Escape') { setHoverIdx(null); return; }
    if (next == null) return;
    e.preventDefault();
    setHoverIdx(next);
  };

  return (
    <div
      ref={rootRef}
      data-testid="holdings-range-band"
      data-inconsistent={hasIssue ? '1' : undefined}
      data-inconsistent-codes={hasIssue ? diagnostics.map((d) => d.code).join(',') : undefined}
      data-chart-mode={useKline ? 'kline' : 'line'}
      data-compact={compact ? '1' : '0'}
      data-has-volume={hasVolume ? '1' : '0'}
      data-zone-state={badge.state}
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
        <div
          ref={wrapRef}
          tabIndex={useKline ? 0 : undefined}
          role={useKline ? 'group' : undefined}
          aria-label={useKline ? '30 日 K 線與量能，可用左右方向鍵逐日檢視' : undefined}
          data-testid="kline-chart-surface"
          onKeyDown={useKline ? onChartKeyDown : undefined}
          onFocus={useKline ? () => setHoverIdx((v) => (v == null ? cleanOhlc.length - 1 : v)) : undefined}
          onBlur={useKline ? () => setHoverIdx(null) : undefined}
          style={{
            position: 'relative', width: '100%', height: svgH,
            touchAction: useKline ? 'pan-y' : undefined,
            outlineOffset: 2,
          }}
          onPointerMove={useKline ? (e) => pickIndex(e.clientX) : undefined}
          onPointerDown={useKline ? (e) => pickIndex(e.clientX) : undefined}
          onPointerLeave={useKline ? () => setHoverIdx(null) : undefined}
          onPointerCancel={useKline ? () => setHoverIdx(null) : undefined}
        >
          <svg viewBox="0 0 100 30" preserveAspectRatio="none"
            style={{ width: '100%', height: svgH, display: 'block', position: 'absolute', inset: 0 }}>
            {zoneRect && (
              <rect
                data-testid="resistance-zone"
                x="0" y={zoneRect.y.toFixed(2)} width="100" height={zoneRect.h.toFixed(2)}
                fill={WB.inkMute} opacity="0.08"
              />
            )}
            {useKline ? (
              klineElements
            ) : (
              <polyline fill="none" stroke={WB.inkSub} strokeWidth="1" vectorEffect="non-scaling-stroke"
                points={cleanSpark.map((v, i) => {
                  const x = (i / (cleanSpark.length - 1)) * 100;
                  const yy = range > 0 ? 30 - ((v - lo) / range) * 30 : 15;
                  return `${x.toFixed(2)},${yy.toFixed(2)}`;
                }).join(' ')} />
            )}
            {hoverX != null && (
              <line
                data-testid="kline-crosshair"
                x1={hoverX.toFixed(2)} x2={hoverX.toFixed(2)} y1="0" y2="30"
                stroke={WB.inkMute} strokeWidth="1" strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {zoneLabelTop != null && (
            <span
              data-testid="resistance-zone-label"
              data-zone-state={badge.state}
              aria-hidden="true"
              style={{
                position: 'absolute', left: 0, top: zoneLabelTop,
                fontSize: 10, lineHeight: '12px', letterSpacing: '0.04em',
                color: WB.inkMute, background: 'rgba(255,255,255,0.78)',
                padding: '0 3px', pointerEvents: 'none', whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums', maxWidth: '56%', overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {badge.label} {badge.rangeText}
            </span>
          )}
          {/* HTML overlay：歷史轉折標記（多方在棒下、空方在棒上；形狀＋文字區分狀態） */}
          {useKline && reversalMarkers.map((m) => {
            const xPct = barCenterPct(m.index, cleanOhlc.length, PAD_X);
            if (xPct == null) return null;
            const yPx = Math.min(Math.max((yFor(m.anchorPrice) / 30) * svgH, 0), svgH);
            const below = m.placement === 'below';
            const failed = m.state === 'failed';
            return (
              <span
                key={`${m.date}-${m.kind}`}
                data-testid="reversal-marker"
                data-reversal-kind={m.kind}
                data-reversal-state={m.state}
                data-reversal-date={m.date}
                data-reversal-active={m.active ? '1' : '0'}
                data-reversal-trigger={String(m.triggerPrice)}
                role="button"
                tabIndex={0}
                aria-label={m.ariaLabel}
                title={m.ariaLabel}
                onFocus={(e) => { e.stopPropagation(); setHoverIdx(m.index); }}
                onPointerDown={(e) => { e.stopPropagation(); setHoverIdx(m.index); }}
                onPointerMove={(e) => { e.stopPropagation(); setHoverIdx(m.index); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHoverIdx(m.index); }
                }}
                style={{
                  position: 'absolute',
                  left: `${xPct}%`,
                  top: yPx + (below ? 3 : -3),
                  transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
                  fontSize: 9,
                  lineHeight: '9px',
                  color: failed ? WB.inkLight : WB.ink,
                  opacity: failed ? 0.35 : m.active ? 1 : 0.7,
                  cursor: 'default',
                  userSelect: 'none',
                  zIndex: 1,
                }}
              >{m.glyph}</span>
            );
          })}
          {/* HTML overlay：現價圓點（真實 px 正圓）— 固定貼齊時間軸末端 */}
          <span
            data-testid="holdings-range-band-dot"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${100 - PAD_X}%`,
              top: dotY,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: WB.accent,
              transform: useKline ? 'translate(-50%, -50%)' : 'translate(-100%, -50%)',
              pointerEvents: 'none',
            }}
          />
          {tip && (
            <div
              data-testid="kline-tooltip"
              role="tooltip"
              style={{
                position: 'absolute',
                left: `${hoverX}%`,
                top: 0,
                transform: `translate(${shouldFlipTooltip(hoverX) ? '-100%' : '0'}, -4px)`,
                pointerEvents: 'none',
                background: WB.surface,
                border: `1px solid ${WB.hair}`,
                padding: '6px 8px',
                fontSize: 11,
                lineHeight: 1.5,
                color: WB.ink,
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
                zIndex: 2,
              }}
            >
              <div data-testid="kline-tooltip-date" style={{ color: WB.inkSub, marginBottom: 2 }}>
                {fmtDate(tip.date)}
              </div>
              {tip.rows.map((r) => (
                <div key={r.key} data-testid={`kline-tooltip-${r.key}`}>
                  <span style={{ color: WB.inkMute }}>{r.label}</span>　{r.value}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 量能副圖：與 K 棒同一時間軸，缺量顯示單一空狀態 */}
      {hasSpark && (
        <div data-testid="holdings-volume-chart" data-has-volume={hasVolume ? '1' : '0'} style={{ marginTop: 6 }}>
          {hasVolume ? (
            <svg viewBox="0 0 100 26" preserveAspectRatio="none"
              style={{ width: '100%', height: volH, display: 'block' }}>
              {volElements}
              {ma5Points && (
                <polyline data-testid="volume-ma5" fill="none" stroke={WB.ink} strokeWidth="1.2"
                  strokeLinejoin="round" opacity="0.95"
                  vectorEffect="non-scaling-stroke" points={ma5Points} />
              )}
              {hoverX != null && (
                <line x1={hoverX.toFixed(2)} x2={hoverX.toFixed(2)} y1="0" y2="26"
                  stroke={WB.inkMute} strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
          ) : (
            <div data-testid="holdings-volume-empty"
              style={{ height: volH, display: 'flex', alignItems: 'center', fontSize: 11, color: WB.inkLight }}>
              無成交量資料 · 僅提供價格與壓力判讀
            </div>
          )}
        </div>
      )}

      {/* 量價判讀：最少資訊完成判斷；窄版 2 欄 grid，桌機一行 */}
      {hasSpark && (stats || zone) && (
        <div data-testid="holdings-volume-analysis" style={{ marginTop: 8 }}>
          <div
            data-testid="holdings-volume-metrics"
            data-metric-count={String(metrics.length)}
            data-layout={compact ? 'grid-2' : 'row'}
            style={compact
              ? {
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px',
                  fontSize: 11, color: WB.inkSub, fontVariantNumeric: 'tabular-nums',
                }
              : {
                  display: 'flex', flexWrap: 'wrap', gap: '4px 16px',
                  fontSize: 12, color: WB.inkSub, fontVariantNumeric: 'tabular-nums',
                }}
          >
            {metrics.map((m) => (
              <span
                key={m.key}
                data-testid={`vol-${m.key}`}
                style={compact
                  ? { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }
                  : { display: 'inline-flex', gap: 6, minWidth: 0 }}
              >
                <span style={{ color: WB.inkMute, whiteSpace: 'nowrap' }}>{m.label}</span>
                <span style={{ color: WB.inkSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.value}
                </span>
              </span>
            ))}
          </div>
          <div data-testid="holdings-volume-summary" style={{
            marginTop: 6, fontFamily: SERIF, fontSize: 12, lineHeight: 1.7, color: WB.ink,
          }}>
            <span data-testid="vol-pv-state" style={{ color: WB.ink, fontWeight: 700 }}>{va?.pv?.label}</span>
            <span style={{ margin: '0 6px', color: WB.inkLight }}>·</span>
            <span data-testid="vol-breakout-state">{va?.breakout?.label}</span>
            <div
              data-testid="holdings-volume-summary-text"
              style={{
                color: WB.inkSub, marginTop: 2,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {va?.summary}
            </div>
            {va?.reversal?.line && (
              <div
                data-testid="holdings-volume-reversal"
                data-reversal-kind={va.reversal.active?.kind}
                data-reversal-state={va.reversal.active?.state}
                style={{
                  color: WB.inkSub, marginTop: 2,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                <span aria-hidden="true" style={{
                  display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
                  background: WB.inkMute, verticalAlign: 'middle', marginRight: 6,
                }} />
                {va.reversal.line}
              </div>
            )}
          </div>
        </div>
      )}
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


const HoldingsDetailPanel = React.memo(HoldingsDetailPanelImpl);
export default HoldingsDetailPanel;
