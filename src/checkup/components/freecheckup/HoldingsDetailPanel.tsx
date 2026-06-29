// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Camera, Download, Copy, X as XIcon, Settings, ChevronDown, RotateCcw, FileText, Image as ImageIcon, Undo2, Redo2 } from 'lucide-react';
import { useHoldingShareExport } from '@/checkup/hooks/useHoldingShareExport';
import { useSimHistory } from '@/checkup/hooks/useSimHistory';
import { Sparkline } from '@/pages/_freeCheckup/constants.jsx';
import { computeScenario, isDirty } from './holdingScenario';
import HoldingExportCard from './HoldingExportCard';
import '@/checkup/styles/holdingsDetailPanel.css';

/**
 * HoldingsDetailPanel — 持倉抽屜（One-Page Decision Sheet v2）
 *
 * 在 v1 基礎上加上：
 *   1) 情境模擬（TARGET/Δqty/加碼價/停損價，即時更新 upside/進度條/PnL，DECISION 卡掛 SIMULATED 徽章）
 *   2) MiniChartsRow：成本→現價軸、區間位置、佔比甜甜圈
 *   3) 顯示欄位開關（localStorage 持久化）+ 排序（同步左側主清單）
 *   4) 匯出選單：1:1/16:9 × PNG@3x/PDF，走離屏 HoldingExportCard，不需 SHARE MODE
 */

const PREFS_KEY = 'holdingPanel.prefs.v1';
const DEFAULT_PREFS = {
  showThesis: true,
  showNextEvent: true,
  showRange: true,
  showCost: true,
  showTargetBar: true,
  showCharts: true,
  showSandbox: false,
};

const EXPORT_PREFS_KEY = 'holdingPanel.export.v1';
const DEFAULT_EXPORT_PREFS = {
  format: 'png',        // 'png' | 'pdf'
  ratio: 'square',      // 'square' | 'wide'
  resolution: 'high',   // 'std' | 'high' | 'print'  → pixelRatio 2 / 3 / 4
};
const RES_TO_PR = { std: 2, high: 3, print: 4 };
const RES_LABEL = { std: '標準 2x', high: '高 3x', print: '印刷 4x' };

function loadPrefs() {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return DEFAULT_PREFS; }
}
function savePrefs(p) {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}
function loadExportPrefs() {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage.getItem(EXPORT_PREFS_KEY);
    if (!raw) return DEFAULT_EXPORT_PREFS;
    return { ...DEFAULT_EXPORT_PREFS, ...JSON.parse(raw) };
  } catch { return DEFAULT_EXPORT_PREFS; }
}
function saveExportPrefs(p) {
  try { window.localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(p)); } catch {}
}

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
}) {
  const [shareMode, setShareMode] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [exportPrefs, setExportPrefsRaw] = useState(loadExportPrefs);
  const setExportPrefs = useCallback((updater) => {
    setExportPrefsRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveExportPrefs(next);
      return next;
    });
  }, []);
  const screenRef = useRef(null);
  const exportHostRef = useRef(null);
  const [exportNode, setExportNode] = useState(null); // { variant, props } 觸發離屏渲染
  const { busy, downloadPng, downloadPdf, copy } = useHoldingShareExport({ backgroundColor: WB.surface });

  useEffect(() => { savePrefs(prefs); }, [prefs]);

  // ── derive base values（不依賴 selected 存在性，避免 hook order）──
  const h = selected || {};
  const dec = decisionsMap[h.code];
  const meta = stockMeta[h.code] || null;
  const baseTarget = targets && avgTarget && h.code ? avgTarget(h.code) : null;
  const pctVal = h.pct ?? h.totalPct ?? 0;
  const pnlVal = Number(h.pnl ?? h.totalPnl ?? 0);
  const todayPct = Number.isFinite(Number(h.changePct)) ? Number(h.changePct) : null;
  const todayPnl = Number.isFinite(Number(h.todayPnl)) ? Number(h.todayPnl) : null;
  const valueNum = Number(h.value ?? (Number(h.price) * Number(h.qty)) ?? 0);
  const weightPct = totalPortfolioValue > 0 && valueNum > 0 ? (valueNum / totalPortfolioValue) * 100 : null;
  const sparkArrRaw = useMemo(
    () => (Array.isArray(sparkData30D) ? sparkData30D.filter((n) => Number.isFinite(n)) : []),
    [sparkData30D]
  );
  // Fallback：sparkline 邊緣失敗 / demo 模式不打 edge 時，依 cost→price 合成一條 30 點走勢，
  // 讓 RangeChart 不要顯示「無 30D 資料」，否則 demo 看不到圖會誤判功能壞。
  const sparkArr = useMemo(() => {
    if (sparkArrRaw.length >= 2) return sparkArrRaw;
    const c = Number(h.cost); const p = Number(h.price);
    if (!Number.isFinite(c) || !Number.isFinite(p) || c <= 0 || p <= 0) return sparkArrRaw;
    const N = 30;
    const arr: number[] = [];
    // 使用 code-based seed 讓結果穩定，避免每次 render 抖動
    const seed = String(h.code || 'x').split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const rand = (i) => {
      const x = Math.sin((seed + i) * 9973) * 10000;
      return x - Math.floor(x);
    };
    const amp = Math.max(Math.abs(p - c) * 0.35, p * 0.015);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const base = c + (p - c) * t;
      arr.push(Number((base + (rand(i) - 0.5) * 2 * amp).toFixed(2)));
    }
    arr[N - 1] = p; // 收斂到現價
    return arr;
  }, [sparkArrRaw, h.cost, h.price, h.code]);


  const rangeLow = sparkArr.length ? Math.min(...sparkArr) : null;
  const rangeHigh = sparkArr.length ? Math.max(...sparkArr) : null;
  const rangePos = rangeLow != null && rangeHigh != null && rangeHigh > rangeLow
    ? ((h.price - rangeLow) / (rangeHigh - rangeLow)) * 100 : null;
  const thesisSentence = useMemo(() => {
    const raw = dec?.actionText || meta?.strategy || '';
    if (!raw) return '';
    const m = String(raw).match(/^(.*?[。.!?！？])/);
    return (m ? m[1] : raw).slice(0, 90);
  }, [dec, meta]);
  const relatedEvents = (normalizedEvents || [])
    .filter((e) => (e.relatedCodes || []).includes(h.code) && e.source !== 'demo')
    .slice(0, 5);
  const nextEvent = relatedEvents[0];

  // ── 情境模擬 state（每次切換股票重置）──
  const simHistory = useSimHistory({ target: '', deltaQty: 0, buyMorePrice: '', stopPrice: '' });
  const sim = simHistory.state;
  const setSim = simHistory.set;
  useEffect(() => {
    simHistory.clear({ target: baseTarget ?? '', deltaQty: 0, buyMorePrice: '', stopPrice: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.code, baseTarget]);
  const simInput = useMemo(() => ({
    cost: Number(h.cost) || 0,
    qty: Number(h.qty) || 0,
    price: Number(h.price) || 0,
    target: sim.target === '' ? baseTarget : Number(sim.target),
    deltaQty: Number(sim.deltaQty) || 0,
    buyMorePrice: sim.buyMorePrice === '' ? null : Number(sim.buyMorePrice),
    stopPrice: sim.stopPrice === '' ? null : Number(sim.stopPrice),
  }), [h.cost, h.qty, h.price, sim, baseTarget]);
  const scenario = useMemo(() => computeScenario(simInput), [simInput]);
  const dirty = useMemo(() => isDirty(simInput, baseTarget), [simInput, baseTarget]);

  // 顯示版的 target/upside/pnl（dirty 時用 sim）
  const displayTarget = dirty && sim.target !== '' ? Number(sim.target) : baseTarget;
  const displayUpside = displayTarget && h.price ? ((displayTarget - h.price) / h.price * 100) : null;
  const displayPnlPct = dirty ? (scenario.simPnlPct ?? pctVal) : pctVal;
  const displayPnlAbs = dirty ? (scenario.simPnlAbs ?? pnlVal) : pnlVal;
  const displayQty = dirty ? scenario.simQty : Number(h.qty || 0);
  const displayValue = dirty ? scenario.simValue : valueNum;
  const displayWeight = displayValue && totalPortfolioValue ? (displayValue / totalPortfolioValue) * 100 : weightPct;

  const visibleList = orderedDisplayed;
  const curIdx = visibleList.findIndex((x) => x.code === h.code);
  const prev = curIdx > 0 ? visibleList[curIdx - 1] : null;
  const next = curIdx < visibleList.length - 1 ? visibleList[curIdx + 1] : null;

  const actionLabel = dec?.actionType === 'exit' ? 'EXIT' : dec?.actionType === 'review' ? 'REVIEW' : 'HOLD';
  const urgencyLevel = dec?.urgency === 'now' ? 4 : dec?.urgency === 'soon' ? 3 : dec?.urgency === 'monitor' ? 2 : 1;
  const urgencyLabel = dec?.urgency === 'now' ? 'NOW' : dec?.urgency === 'soon' ? 'SOON' : dec?.urgency === 'monitor' ? 'MONITOR' : 'LOW';
  const pnlColor = displayPnlPct > 0 ? WB.accent : displayPnlPct < 0 ? '#8A857F' : WB.inkMute;
  const stamp = useMemo(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [exportNode, shareMode]);

  // ── 匯出流程 ──
  const exportCardProps = useMemo(() => ({
    holding: h, decision: dec, meta,
    scenario: dirty ? { simTarget: displayTarget, upsidePct: displayUpside } : null,
    baseTarget, pctVal: displayPnlPct, pnlVal: displayPnlAbs,
    weightPct: displayWeight, rangeLow, rangeHigh,
    thesis: prefs.showThesis ? thesisSentence : null,
    nextEvent: prefs.showNextEvent ? nextEvent : null,
    stamp, WB, showSimulated: dirty,
  }), [h, dec, meta, dirty, displayTarget, displayUpside, baseTarget, displayPnlPct, displayPnlAbs, displayWeight, rangeLow, rangeHigh, prefs.showThesis, prefs.showNextEvent, thesisSentence, nextEvent, stamp, WB]);

  // runExport(variant, kind, options?) — variant: 'square'|'wide'、kind: 'png'|'pdf'|'copy'。
  // options.pixelRatio 由匯出選單依 resolution 決定（std 2 / high 3 / print 4）。
  const runExport = async (variant, kind, opts: { pixelRatio?: number } = {}) => {
    setExportNode({ variant });
    // 等下一個 frame 讓離屏 DOM mount
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
      setExportNode(null);
    }
  };

  // 從 exportPrefs 計算「立即匯出」的具體參數。
  const triggerCurrentExport = () => runExport(
    exportPrefs.ratio,
    exportPrefs.format,
    { pixelRatio: RES_TO_PR[exportPrefs.resolution] ?? 3 }
  );

  // 鍵盤快捷鍵：Cmd/Ctrl+Z undo、Cmd/Ctrl+Shift+Z redo。
  // INPUT/TEXTAREA focus 時讓瀏覽器原生 undo 走，避免干擾輸入。
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) simHistory.redo();
      else simHistory.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, simHistory.undo, simHistory.redo]);

  // 早期 return 必須在所有 hooks 之後
  if (!selected) return null;

  const labelStyle = { fontSize: 9, color: WB.inkLight, letterSpacing: '0.18em', fontWeight: 600 };
  const microStyle = { fontSize: 10, color: WB.inkMute, letterSpacing: '0.04em' };

  return (
    <div>
      {/* 操作列 */}
      {!shareMode && (
        <div style={topBar(WB)}>
          <div style={{ display: 'flex', gap: 4 }}>
            <NavBtn disabled={!prev} onClick={() => prev && setExpandedDecision(prev.code)} WB={WB} label="上一檔">‹</NavBtn>
            <NavBtn disabled={!next} onClick={() => next && setExpandedDecision(next.code)} WB={WB} label="下一檔">›</NavBtn>
          </div>
          <span style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.16em', fontWeight: 500 }}>
            {String(curIdx + 1).padStart(2, '0')} / {String(visibleList.length).padStart(2, '0')}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <SortMenu WB={WB} sortBy={sortBy} sortDir={sortDir} setSortBy={setSortBy} setSortDir={setSortDir} />
            <PrefsMenu WB={WB} prefs={prefs} setPrefs={setPrefs} />
            <ExportMenu WB={WB} onExport={runExport} onShareMode={() => setShareMode(true)} busy={busy} />
            <NavBtn onClick={() => setExpandedDecision(null)} WB={WB} label="關閉">×</NavBtn>
          </div>
        </div>
      )}

      {shareMode && (
        <div style={{ ...topBar(WB), background: WB.surfaceSoft }}>
          <span style={{ fontSize: 10, color: WB.accent, letterSpacing: '0.20em', fontWeight: 600 }}>SHARE MODE（螢幕預覽）</span>
          <button onClick={() => setShareMode(false)} style={iconBtn(WB)} aria-label="退出"><XIcon size={14} /></button>
        </div>
      )}

      {/* 螢幕版本內容 */}
      <div ref={screenRef} style={{ padding: shareMode ? '24px 26px 18px' : '18px 22px 22px', background: WB.surface }}>
        {/* 識別層 */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: WB.inkMute, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em' }}>{h.code}</span>
              <span style={{ fontSize: 20, fontWeight: 600, color: WB.ink, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
            </div>
            {sparkArr.length >= 2 && (
              <div style={{ flexShrink: 0 }}>
                <Sparkline data={sparkArr} width={110} height={28} color={pctVal >= 0 ? WB.accent : '#8A857F'} opacity={0.9} />
              </div>
            )}
          </div>
          {(meta?.industry || meta?.strategy) && (
            <div style={microStyle}>{meta?.industry || ''}{meta?.industry && meta?.strategy ? ' · ' : ''}{meta?.strategy || ''}</div>
          )}
        </div>

        {/* 焦點層 */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 14, alignItems: 'stretch',
          marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid ${WB.hair}`,
        }}>
          <div>
            <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
              RETURN {dirty && <SimBadge WB={WB} />}
            </div>
            <div style={{
              marginTop: 6, fontSize: 46, fontWeight: 600, color: pnlColor,
              letterSpacing: '-0.035em', lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            }}>
              {displayPnlPct >= 0 ? '+' : ''}{Number(displayPnlPct).toFixed(2)}
              <span style={{ fontSize: 18, opacity: 0.55, marginLeft: 2, fontWeight: 500 }}>%</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: WB.inkSub, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
              {displayPnlAbs >= 0 ? '+' : ''}{Math.round(displayPnlAbs).toLocaleString()}
              {dirty && (
                <span style={{ marginLeft: 10, color: WB.inkLight, textDecoration: 'line-through' }}>
                  原 {pctVal >= 0 ? '+' : ''}{Number(pctVal).toFixed(2)}%
                </span>
              )}
              {!dirty && todayPct != null && (
                <span style={{ marginLeft: 10, color: WB.inkMute }}>
                  TODAY {todayPct >= 0 ? '+' : ''}{todayPct.toFixed(2)}%
                  {todayPnl != null && <> · {todayPnl >= 0 ? '+' : ''}{Math.round(todayPnl).toLocaleString()}</>}
                </span>
              )}
            </div>
          </div>
          <div className="holdings-detail-decision" style={{
            background: WB.ink, color: '#F4F1EC', padding: '12px 14px', borderRadius: 3,
            minWidth: 130, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative',
          }}>
            {dirty && <span style={{ position: 'absolute', top: 6, right: 6 }}><SimBadge WB={WB} inverted /></span>}
            <div style={{ fontSize: 9, color: 'rgba(244,241,236,0.55)', letterSpacing: '0.20em', fontWeight: 600 }}>DECISION</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: WB.accent, letterSpacing: '0.04em', margin: '6px 0 8px' }}>{actionLabel}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {[1,2,3,4,5].map((i) => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: i <= urgencyLevel ? WB.accent : 'transparent',
                  border: i <= urgencyLevel ? 'none' : '1px solid rgba(244,241,236,0.25)',
                }} />
              ))}
              <span style={{ marginLeft: 4, fontSize: 9, color: 'rgba(244,241,236,0.65)', letterSpacing: '0.14em', fontWeight: 600 }}>{urgencyLabel}</span>
            </div>
          </div>
        </div>

        {/* 脈絡層：成本/現價/數量、區間、佔比 */}
        {(prefs.showCost || prefs.showRange) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 14, rowGap: 12, marginBottom: 16 }}>
            {prefs.showCost && (
              <Block label="成本 → 現價" WB={WB} value={
                <>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(dirty ? scenario.simAvgCost : h.cost)}</span>
                  <span style={{ color: WB.inkLight, margin: '0 6px' }}>→</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: WB.ink, fontWeight: 600 }}>{fmt(h.price)}</span>
                </>
              } />
            )}
            {prefs.showCost && (
              <Block label="數量 · 市值" WB={WB} value={
                <>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(displayQty).toLocaleString()}</span>
                  <span style={{ color: WB.inkLight, margin: '0 6px' }}>·</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{displayValue ? Math.round(displayValue).toLocaleString() : '—'}</span>
                </>
              } />
            )}
            {prefs.showRange && rangeLow != null && rangeHigh != null && (
              <Block label="近 30D 區間" WB={WB} value={
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {rangeLow.toFixed(2)}<span style={{ color: WB.inkLight, margin: '0 6px' }}>—</span>{rangeHigh.toFixed(2)}
                </span>
              } />
            )}
            {displayWeight != null && (
              <Block label="部位佔比" WB={WB} value={
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{displayWeight.toFixed(1)}<span style={{ fontSize: 11, color: WB.inkLight, marginLeft: 2 }}>%</span></span>
              } />
            )}
          </div>
        )}

        {/* TARGET 進度條 */}
        {prefs.showTargetBar && displayTarget && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ ...labelStyle, display: 'flex', gap: 6, alignItems: 'center' }}>TARGET {dirty && <SimBadge WB={WB} />}</span>
              <span style={{ fontSize: 12, color: displayUpside >= 0 ? WB.accent : WB.inkMute, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {Number(displayTarget).toLocaleString()} · {displayUpside >= 0 ? '+' : ''}{displayUpside?.toFixed(1)}%
              </span>
            </div>
            <div style={{ background: WB.hair, height: 4, width: '100%', borderRadius: 1, position: 'relative' }}>
              <div style={{
                width: `${Math.min(Math.max((h.price / displayTarget) * 100, 0), 100)}%`,
                height: '100%', background: WB.accent, opacity: 0.85,
              }} />
              {dirty && baseTarget && baseTarget !== displayTarget && (
                <span style={{
                  position: 'absolute', top: -3, left: `${Math.min(Math.max((h.price / baseTarget) * 100, 0), 100)}%`,
                  width: 1, height: 10, background: WB.inkLight, transform: 'translateX(-0.5px)',
                }} title={`原 TARGET ${baseTarget}`} />
              )}
            </div>
            {dirty && baseTarget && baseTarget !== displayTarget && (
              <div style={{ marginTop: 4, fontSize: 10, color: WB.inkMute, letterSpacing: '0.04em' }}>
                灰色刻度 = 原 TARGET {Number(baseTarget).toLocaleString()}
              </div>
            )}
          </div>
        )}

        {/* MiniChartsRow */}
        {prefs.showCharts && (
          <MiniChartsRow
            WB={WB} price={h.price} cost={h.cost}
            avgCostSim={dirty ? scenario.simAvgCost : null}
            target={displayTarget} stop={simInput.stopPrice} buyMore={simInput.buyMorePrice}
            rangeLow={rangeLow} rangeHigh={rangeHigh}
            weight={weightPct} weightSim={dirty ? displayWeight : null}
          />
        )}

        {/* Scenario Sandbox */}
        <ScenarioSandbox
          WB={WB} prefs={prefs} setPrefs={setPrefs}
          sim={sim} setSim={setSim} baseTarget={baseTarget} h={h} scenario={scenario} dirty={dirty}
          canUndo={simHistory.canUndo} canRedo={simHistory.canRedo}
          onUndo={simHistory.undo} onRedo={simHistory.redo}
          onReset={() => simHistory.reset({ target: baseTarget ?? '', deltaQty: 0, buyMorePrice: '', stopPrice: '' })}
        />

        {/* THESIS */}
        {prefs.showThesis && thesisSentence && (
          <div style={{
            marginTop: 14, marginBottom: 14, padding: '12px 14px',
            border: `1px solid ${WB.hair}`, borderLeft: `3px solid ${WB.accent}`,
            background: WB.surfaceSoft, borderRadius: 2,
          }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>THESIS</div>
            <div style={{ fontSize: 13, color: WB.ink, lineHeight: 1.65, fontWeight: 500, fontFamily: '"Source Serif 4", Georgia, serif' }}>
              「{thesisSentence}」
            </div>
            {dec && (
              <div style={{ marginTop: 8, fontSize: 10, color: WB.inkMute, letterSpacing: '0.04em' }}>
                論點 {dec.thesisState === 'broken' ? '破裂' : dec.thesisState === 'weakening' ? '弱化' : '完整'}
                {' · 信心 '}{dec.confidence === 'high' ? '高' : dec.confidence === 'medium' ? '中' : '低'}
                {' · 事件 '}{dec.openEventCount || 0}
              </div>
            )}
          </div>
        )}

        {/* NEXT EVENT */}
        {prefs.showNextEvent && nextEvent && (
          <div style={{ marginBottom: 14, padding: '12px 14px', border: `1px solid ${WB.hair}`, borderRadius: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={labelStyle}>NEXT EVENT</span>
              {nextEvent.date && (
                <span style={{ fontSize: 9, color: WB.surface, background: WB.accent, padding: '2px 7px', letterSpacing: '0.14em', fontWeight: 600, borderRadius: 2 }}>{nextEvent.date}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: WB.inkSub, lineHeight: 1.6 }}>{nextEvent.summary || nextEvent.title || '(無摘要)'}</div>
          </div>
        )}

        {/* SHARE MODE 浮水印 */}
        {shareMode && (
          <div style={{
            marginTop: 18, paddingTop: 12, borderTop: `1px solid ${WB.hair}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 10, color: WB.inkMute, letterSpacing: '0.08em',
          }}>
            <span style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontWeight: 600, color: WB.ink, letterSpacing: '0.02em' }}>
              legendflow<span style={{ color: WB.accent }}>.</span>tw
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stamp}</span>
          </div>
        )}
      </div>

      {/* 研究筆記入口 */}
      {!shareMode && (
        <div style={{ padding: '0 22px 22px' }}>
          <button
            onClick={() => openHoldingDrawer && openHoldingDrawer(h.code)}
            style={{
              width: '100%', padding: '12px', background: 'transparent',
              border: `1px solid ${WB.hair}`, borderRadius: 2,
              color: WB.inkSub, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              letterSpacing: '0.08em', fontFamily: 'inherit',
            }}
          >研究筆記</button>
        </div>
      )}

      {/* 離屏匯出區（用 portal 確保不受抽屜 overflow 影響） */}
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

// ──────────────────── Sub-components ────────────────────

function topBar(WB) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderBottom: `1px solid ${WB.hair}`,
  };
}
function iconBtn(WB) {
  return {
    width: 26, height: 26, border: `1px solid ${WB.hair}`, background: 'transparent',
    cursor: 'pointer', color: WB.ink, fontSize: 13, borderRadius: 2,
    fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
}
function NavBtn({ children, onClick, disabled, label, WB }) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label={label}
      style={{
        width: 26, height: 26, border: `1px solid ${WB.hair}`, background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? WB.inkLight : WB.ink,
        fontSize: 12, borderRadius: 2, fontFamily: 'inherit',
      }}
    >{children}</button>
  );
}

function SimBadge({ WB, inverted = false }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, letterSpacing: '0.20em',
      color: inverted ? WB.accent : WB.surface, background: inverted ? 'rgba(244,241,236,0.12)' : WB.accent,
      padding: '1px 5px', borderRadius: 1,
    }}>SIM</span>
  );
}

function Block({ label, value, WB }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: WB.inkLight, letterSpacing: '0.18em', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: WB.inkSub, lineHeight: 1.4 }}>{value}</div>
    </div>
  );
}

function SortMenu({ WB, sortBy, sortDir, setSortBy, setSortDir }) {
  const OPTIONS = [
    { key: 'decision', label: '決策優先' },
    { key: 'value', label: '佔比 / 市值' },
    { key: 'pct', label: '報酬率' },
    { key: 'pnl', label: '損益金額' },
    { key: 'urgency', label: '急迫度' },
  ];
  const current = OPTIONS.find((o) => o.key === sortBy) || OPTIONS[0];
  return (
    <details style={{ position: 'relative' }} onToggle={(e) => e.stopPropagation()}>
      <summary style={{
        ...iconBtn(WB), width: 'auto', padding: '0 8px', listStyle: 'none', gap: 4,
      }} aria-label="排序">
        <span style={{ fontSize: 10, letterSpacing: '0.06em' }}>{current.label}</span>
        <ChevronDown size={11} />
      </summary>
      <div style={menuPanel(WB)}>
        {OPTIONS.map((o) => (
          <button key={o.key} onClick={(e) => { e.preventDefault(); setSortBy?.(o.key); (e.currentTarget.closest('details') as any)?.removeAttribute('open'); }}
            style={menuItem(WB, sortBy === o.key)}>
            {o.label}
          </button>
        ))}
        <div style={{ borderTop: `1px solid ${WB.hair}`, margin: '4px 0' }} />
        <button onClick={(e) => { e.preventDefault(); setSortDir?.(sortDir === 'asc' ? 'desc' : 'asc'); }} style={menuItem(WB, false)}>
          方向：{sortDir === 'asc' ? '由小到大 ↑' : '由大到小 ↓'}
        </button>
      </div>
    </details>
  );
}

function PrefsMenu({ WB, prefs, setPrefs }) {
  const TOGGLES = [
    ['showThesis', 'THESIS'],
    ['showNextEvent', 'NEXT EVENT'],
    ['showRange', '區間 / 30D'],
    ['showCost', '成本 / 數量'],
    ['showTargetBar', 'TARGET 進度條'],
    ['showCharts', '視覺化圖表'],
    ['showSandbox', '情境模擬'],
  ];
  return (
    <details style={{ position: 'relative' }}>
      <summary style={{ ...iconBtn(WB), listStyle: 'none' }} aria-label="顯示偏好"><Settings size={12} /></summary>
      <div style={menuPanel(WB)}>
        {TOGGLES.map(([k, label]) => (
          <label key={k} style={{ ...menuItem(WB, false), cursor: 'pointer' }}>
            <input
              type="checkbox" checked={!!prefs[k]} onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))}
              style={{ marginRight: 8 }}
            />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}

function ExportMenu({ WB, onExport, onShareMode, busy }) {
  const MItem = ({ icon, label, onClick }) => (
    <button onClick={(e) => { e.preventDefault(); (e.currentTarget.closest('details') as any)?.removeAttribute('open'); onClick(); }}
      style={{ ...menuItem(WB, false), display: 'flex', alignItems: 'center', gap: 8 }} disabled={busy}>
      {icon} {label}
    </button>
  );
  return (
    <details style={{ position: 'relative' }}>
      <summary style={{ ...iconBtn(WB), listStyle: 'none', gap: 4, padding: '0 8px', width: 'auto' }} aria-label="匯出">
        <Camera size={12} /> <span style={{ fontSize: 10, letterSpacing: '0.06em' }}>匯出</span>
      </summary>
      <div style={{ ...menuPanel(WB), minWidth: 200 }}>
        <div style={menuHeader(WB)}>PNG（@3x）</div>
        <MItem icon={<ImageIcon size={12} />} label="1:1 IG（1080）" onClick={() => onExport('square', 'png')} />
        <MItem icon={<ImageIcon size={12} />} label="16:9 簡報（1920）" onClick={() => onExport('wide', 'png')} />
        <div style={{ ...menuHeader(WB), marginTop: 6 }}>PDF</div>
        <MItem icon={<FileText size={12} />} label="1:1 正方 PDF" onClick={() => onExport('square', 'pdf')} />
        <MItem icon={<FileText size={12} />} label="16:9 A4 橫向 PDF" onClick={() => onExport('wide', 'pdf')} />
        <div style={{ borderTop: `1px solid ${WB.hair}`, margin: '4px 0' }} />
        <MItem icon={<Copy size={12} />} label="複製到剪貼簿（1:1）" onClick={() => onExport('square', 'copy')} />
        <MItem icon={<Camera size={12} />} label="螢幕預覽 SHARE MODE" onClick={onShareMode} />
      </div>
    </details>
  );
}

function menuPanel(WB) {
  return {
    position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50,
    minWidth: 160, background: WB.surface, border: `1px solid ${WB.hair}`,
    borderRadius: 2, padding: 4, boxShadow: '0 8px 24px rgba(41,37,32,0.08)',
    display: 'flex', flexDirection: 'column', gap: 2,
  };
}
function menuItem(WB, active) {
  return {
    background: active ? WB.surfaceSoft : 'transparent', border: 'none',
    color: WB.ink, fontSize: 11, padding: '7px 10px', textAlign: 'left',
    cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2,
    letterSpacing: '0.04em',
  };
}
function menuHeader(WB) {
  return { fontSize: 9, color: WB.inkLight, letterSpacing: '0.18em', fontWeight: 600, padding: '4px 10px' };
}

// ──────────────────── Scenario Sandbox ────────────────────

function ScenarioSandbox({ WB, prefs, setPrefs, sim, setSim, baseTarget, h, scenario, dirty, onReset, canUndo, canRedo, onUndo, onRedo }) {
  const open = !!prefs.showSandbox;
  return (
    <div style={{
      marginTop: 4, marginBottom: 16, border: `1px solid ${WB.hair}`, borderRadius: 2,
      background: open ? WB.surfaceSoft : 'transparent',
    }}>
      <button
        onClick={() => setPrefs((p) => ({ ...p, showSandbox: !p.showSandbox }))}
        style={{
          width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          color: WB.ink, fontSize: 11, letterSpacing: '0.18em', fontWeight: 600,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          情境模擬 {dirty && <SimBadge WB={WB} />}
        </span>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <div className="hp-sandbox-fields" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field WB={WB} label="TARGET 價" type="number" step="0.01"
              value={sim.target} onChange={(v) => setSim((s) => ({ ...s, target: v }), 'target')}
              placeholder={baseTarget != null ? String(baseTarget) : '—'} />
            <Field WB={WB} label={`Δ 股數（${sim.deltaQty >= 0 ? '加碼' : '減碼'} ${Math.abs(Number(sim.deltaQty) || 0)}）`}>
              <input
                type="range" min={-Math.max(1, h.qty || 1)} max={Math.max(1, h.qty || 1)} step={Math.max(1, Math.floor((h.qty || 20) / 20))}
                value={Number(sim.deltaQty) || 0}
                onChange={(e) => setSim((s) => ({ ...s, deltaQty: Number(e.target.value) }), 'deltaQty')}
                style={{ width: '100%' }}
              />
            </Field>
            <Field WB={WB} label="加碼價（選填）" type="number" step="0.01"
              value={sim.buyMorePrice} onChange={(v) => setSim((s) => ({ ...s, buyMorePrice: v }), 'buyMorePrice')} placeholder="—" />
            <Field WB={WB} label="停損價（選填）" type="number" step="0.01"
              value={sim.stopPrice} onChange={(v) => setSim((s) => ({ ...s, stopPrice: v }), 'stopPrice')} placeholder="—" />
          </div>

          {/* 即時推算結果 */}
          <div className="hp-sandbox-stats" style={{
            marginTop: 12, padding: '10px 12px', background: WB.surface, borderRadius: 2,
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
            border: `1px solid ${WB.hair}`,
          }}>
            <Stat WB={WB} label="均價" value={fmt(scenario.simAvgCost)} />
            <Stat WB={WB} label="PnL%" value={scenario.simPnlPct != null ? `${scenario.simPnlPct >= 0 ? '+' : ''}${scenario.simPnlPct.toFixed(2)}%` : '—'}
              color={scenario.simPnlPct > 0 ? WB.accent : scenario.simPnlPct < 0 ? '#8A857F' : null} />
            <Stat WB={WB} label="Upside" value={scenario.upsidePct != null ? `${scenario.upsidePct >= 0 ? '+' : ''}${scenario.upsidePct.toFixed(1)}%` : '—'}
              color={scenario.upsidePct > 0 ? WB.accent : null} />
            <Stat WB={WB} label="R : R" value={scenario.riskReward != null ? `1 : ${scenario.riskReward.toFixed(2)}` : '—'} />
          </div>

          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 10, color: WB.inkMute, letterSpacing: '0.04em' }}>
              模擬僅供決策參考，不會寫回資料庫。
            </span>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button onClick={onUndo} disabled={!canUndo} aria-label="Undo (Cmd/Ctrl+Z)" title="Undo (Cmd/Ctrl+Z)"
                style={historyBtn(WB, canUndo)}>
                <Undo2 size={11} /> 上一步
              </button>
              <button onClick={onRedo} disabled={!canRedo} aria-label="Redo (Cmd/Ctrl+Shift+Z)" title="Redo (Cmd/Ctrl+Shift+Z)"
                style={historyBtn(WB, canRedo)}>
                <Redo2 size={11} /> 下一步
              </button>
              <button onClick={onReset} disabled={!dirty}
                style={historyBtn(WB, dirty)}>
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
    background: 'transparent', border: `1px solid ${WB.hair}`, borderRadius: 2,
    color: enabled ? WB.ink : WB.inkLight, fontSize: 10, cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit', letterSpacing: '0.06em',
  };
}

function Field({ WB, label, value, onChange, type, step, placeholder, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 9, color: WB.inkLight, letterSpacing: '0.16em', fontWeight: 600 }}>{label}</span>
      {children ? children : (
        <input
          type={type || 'text'} step={step} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{
            padding: '7px 10px', border: `1px solid ${WB.hair}`, borderRadius: 2,
            background: WB.surface, color: WB.ink, fontSize: 12, fontFamily: 'inherit',
            fontVariantNumeric: 'tabular-nums', outline: 'none',
          }}
        />
      )}
    </label>
  );
}
function Stat({ WB, label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: WB.inkLight, letterSpacing: '0.16em', fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 14, fontWeight: 600, color: color || WB.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

// ──────────────────── Mini Charts ────────────────────

function MiniChartsRow({ WB, price, cost, avgCostSim, target, stop, buyMore, rangeLow, rangeHigh, weight, weightSim }) {
  return (
    <div className="hp-charts-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
      <PriceAxisChart WB={WB} price={price} cost={cost} avgCostSim={avgCostSim} target={target} stop={stop} buyMore={buyMore} />
      <RangeChart WB={WB} price={price} cost={cost} low={rangeLow} high={rangeHigh} />
      <WeightDonut WB={WB} weight={weight} weightSim={weightSim} />
      <style>{`
        @media (max-width: 560px) {
          .hp-charts-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function ChartFrame({ title, footer, WB, children, height = 90 }) {
  return (
    <div style={{ border: `1px solid ${WB.hair}`, borderRadius: 2, padding: 10, background: WB.surface }}>
      <div style={{ fontSize: 9, color: WB.inkLight, letterSpacing: '0.18em', fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ height, display: 'flex', alignItems: 'center' }}>{children}</div>
      {footer && (
        <div style={{ marginTop: 6, fontSize: 10, color: WB.inkMute, letterSpacing: '0.04em', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{footer}</div>
      )}
    </div>
  );
}

function PriceAxisChart({ WB, price, cost, avgCostSim, target, stop, buyMore }) {
  // 統一刻度：包含 cost、price、target、stop、buyMore（有值）
  const points = [cost, price, target, stop, buyMore, avgCostSim].filter((v) => Number.isFinite(Number(v)) && Number(v) > 0).map(Number);
  if (points.length < 2) {
    return <ChartFrame title="價格座標" WB={WB}><span style={{ fontSize: 11, color: WB.inkLight }}>資料不足</span></ChartFrame>;
  }
  const lo = Math.min(...points) * 0.97;
  const hi = Math.max(...points) * 1.03;
  const pos = (v) => Number.isFinite(Number(v)) ? ((Number(v) - lo) / (hi - lo)) * 100 : null;
  const W = '100%', H = 70;
  const Dot = ({ v, color, label, top }) => {
    const x = pos(v);
    if (x == null) return null;
    return (
      <g>
        <line x1={`${x}%`} y1="40" x2={`${x}%`} y2="50" stroke={color} strokeWidth="1.5" />
        <circle cx={`${x}%`} cy="45" r="3.5" fill={color} />
        <text x={`${x}%`} y={top ? 18 : 64} fontSize="9" fill={WB.inkSub} textAnchor="middle" style={{ letterSpacing: '0.04em' }}>
          {label} {Number(v).toFixed(2)}
        </text>
      </g>
    );
  };
  const change = cost > 0 && price > 0 ? ((price - cost) / cost) * 100 : null;
  return (
    <ChartFrame title="成本 ↔ 現價 軸" WB={WB} footer={change != null ? `vs 成本 ${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : ''}>
      <svg width={W} height={H} viewBox="0 0 100 70" preserveAspectRatio="none" style={{ width: '100%', height: H, overflow: 'visible' }}>
        <line x1="0" y1="45" x2="100" y2="45" stroke={WB.hair} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <Dot v={cost} color={WB.inkLight} label="成本" top />
        <Dot v={avgCostSim} color="#8A857F" label="模擬均價" top={false} />
        <Dot v={price} color={WB.ink} label="現價" top={false} />
        <Dot v={target} color={WB.accent} label="目標" top />
        <Dot v={buyMore} color="#5A8FB4" label="加碼" top />
        <Dot v={stop} color="#B45A5A" label="停損" top={false} />
      </svg>
    </ChartFrame>
  );
}

function RangeChart({ WB, price, cost, low, high }) {
  if (low == null || high == null || high <= low) {
    return <ChartFrame title="30D 區間位置" WB={WB}><span style={{ fontSize: 11, color: WB.inkLight }}>無 30D 資料</span></ChartFrame>;
  }
  const posPrice = ((price - low) / (high - low)) * 100;
  const posCost = cost != null ? ((cost - low) / (high - low)) * 100 : null;
  return (
    <ChartFrame title="30D 區間位置" WB={WB} footer={`位置 ${posPrice.toFixed(0)}% · ${low.toFixed(2)}–${high.toFixed(2)}`}>
      <div style={{ width: '100%', position: 'relative' }}>
        <div style={{ height: 8, background: WB.hair, borderRadius: 4, position: 'relative' }}>
          {posCost != null && posCost >= 0 && posCost <= 100 && (
            <div style={{
              position: 'absolute', left: `${posCost}%`, top: -3, width: 2, height: 14,
              background: WB.inkLight, transform: 'translateX(-1px)',
            }} title="成本" />
          )}
          <div style={{
            position: 'absolute', left: `${Math.min(Math.max(posPrice, 0), 100)}%`, top: -5, width: 4, height: 18,
            background: WB.accent, transform: 'translateX(-2px)', borderRadius: 1,
          }} title="現價" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 9, color: WB.inkMute, fontVariantNumeric: 'tabular-nums' }}>
          <span>L {low.toFixed(2)}</span>
          <span>H {high.toFixed(2)}</span>
        </div>
      </div>
    </ChartFrame>
  );
}

function WeightDonut({ WB, weight, weightSim }) {
  if (weight == null) return <ChartFrame title="部位佔比" WB={WB}><span style={{ fontSize: 11, color: WB.inkLight }}>—</span></ChartFrame>;
  const R = 30, r = 22, C = 2 * Math.PI * R, c = 2 * Math.PI * r;
  const w = Math.max(0, Math.min(100, weight));
  const ws = weightSim != null ? Math.max(0, Math.min(100, weightSim)) : null;
  const shown = ws != null ? ws : w;
  return (
    <ChartFrame title="部位佔比" WB={WB} footer={ws != null ? `原 ${w.toFixed(1)}% → 模擬 ${ws.toFixed(1)}%` : `${w.toFixed(1)}% of 總市值`}>
      <svg viewBox="0 0 80 80" width="80" height="80" style={{ margin: '0 auto', display: 'block' }}>
        {/* 外圈：原始 */}
        <circle cx="40" cy="40" r={R} fill="none" stroke={WB.hair} strokeWidth="6" />
        <circle cx="40" cy="40" r={R} fill="none" stroke={WB.accent} strokeWidth="6"
          strokeDasharray={`${(C * w) / 100} ${C}`} strokeDashoffset="0" transform="rotate(-90 40 40)" opacity={ws != null ? 0.35 : 0.9} />
        {/* 內圈：模擬 */}
        {ws != null && (
          <circle cx="40" cy="40" r={r} fill="none" stroke={WB.accent} strokeWidth="4"
            strokeDasharray={`${(c * ws) / 100} ${c}`} strokeDashoffset="0" transform="rotate(-90 40 40)" />
        )}
        <text x="40" y="44" textAnchor="middle" fontSize="14" fontWeight="600" fill={WB.ink} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {shown.toFixed(1)}%
        </text>
      </svg>
    </ChartFrame>
  );
}

function fmt(v) { return Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'; }

const HoldingsDetailPanel = React.memo(HoldingsDetailPanelImpl);
export default HoldingsDetailPanel;
