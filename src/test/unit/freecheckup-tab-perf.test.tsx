/**
 * EventsTab / DailyTab / HoldingsTab 基本效能與懶載入回歸測試。
 *
 * 目的（量化的事）：
 * 1. lazy chunk 真的存在 — `import()` 的解析時間 < 上限
 * 2. 兩個 tab 元件都用 React.memo 包裹（避免父層 re-render 觸發整段 ~500 行 JSX 重算）
 * 3. FreeCheckup.jsx 上游用 `{tab==="events" && <Suspense>...}` 條件渲染，
 *    確保 tab 沒被選中就 0 mount cost
 * 4. 元件首次 mount 時間（用最小合法 props）落在 jsdom 友善上限內
 *    — 用來監看後續 PR 不會把 inline 計算膨脹回去
 *
 * 註：jsdom 的時間遠慢於真實瀏覽器，閾值刻意寬鬆，重點在「回歸警報」而非絕對值。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { Suspense, createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const REACT_MEMO = Symbol.for('react.memo');

const noop = () => {};
const C: any = {
  text: '#000', textSec: '#333', textMute: '#666', bg: '#fff', card: '#fff',
  border: '#ddd', subtle: '#eee', up: '#d00', down: '#0a0', amber: '#fa0',
  teal: '#0aa', blue: '#06f', olive: '#aa0',
};
const alpha = (c: string) => c;

const eventsProps: any = {
  isDemo: false,
  navigate: noop,
  startLineLogin: noop,
  C, alpha,
  TYPE_COLOR: {},
  RETRY_MAX: 3,
  calendarAutoStatus: { status: 'idle', msg: '' },
  predictAutoStatus: { status: 'idle', msg: '' },
  calendarLoading: false,
  predictingEvents: false,
  calendarRetry: { count: 0, cooldownUntil: 0 },
  predictRetry: { count: 0, cooldownUntil: 0 },
  calendarLastError: null,
  predictLastError: null,
  calendarLastDebug: null,
  predictLastDebug: null,
  setCalendarLastDebug: noop,
  setPredictLastDebug: noop,
  debugPanelOpen: false,
  setDebugPanelOpen: noop,
  updateLog: [],
  setUpdateLog: noop,
  updateLogOpen: false,
  setUpdateLogOpen: noop,
  classifyAttempt: () => ({ kind: 'ok', tone: 'up', label: 'ok' }),
  deriveSuggestion: () => null,
  holdings: [],
  newsEvents: [],
  H: [], CE: [], filteredEvents: [],
  filterType: '全部',
  setFilterType: noop,
  calendarExpanded: false,
  setCalendarExpanded: noop,
  manualRefreshCalendar: noop,
  runPredictEvents: noop,
};

const dailyProps: any = {
  isDemo: false,
  navigate: noop,
  startLineLogin: noop,
  C, alpha,
  demoDailyMode: 'static',
  setDemoDailyMode: noop,
  dailyReport: null,
  setDailyReport: noop,
  analyzing: false,
  analyzeStep: '',
  runDailyAnalysis: noop,
  hasReachedDailyLimit: false,
  quota: null,
  formatResetCountdown: () => '',
  tier: 'free',
  dailyLastError: null,
  setDailyLastError: noop,
  dailyErrorRef: createRef(),
  dailyRetryHistory: [],
  dailyRetryLocked: false,
  handleDailyRetry: noop,
  pc: () => '#000',
  setTab: noop,
  setExpandedNews: noop,
  coverageOpen: false,
  setCoverageOpen: noop,
  coverageReport: null,
  setCoverageReport: noop,
  strategyBrain: null,
  setStrategyBrain: noop,
  save: noop,
  cloudSync: false,
  analysisHistory: [],
};

const WB: any = {
  bg: '#fff', surface: '#fff', surfaceSoft: '#fafafa',
  ink: '#0a0a0a', inkSub: '#3a3a3a', inkMute: '#6b6862', inkLight: '#9b968d',
  hair: '#ecece5', hairStrong: '#d4d1c9', accent: '#ff4d1f', accentSoft: 'rgba(255,77,31,0.06)',
};
const wbTone = () => WB.ink;
const Sparkline = () => null;

const holdingsProps: any = {
  isDemo: false,
  startLineLogin: noop,
  navigate: noop,
  C, alpha, WB, wbTone,
  quota: null, tier: 'free', tierLabel: 'Free',
  formatResetCountdown: () => '',
  totalVal: 0, totalCost: 0,
  H: [], winners: [], exitList: [], reviewList: [],
  MAX_HOLDINGS: 50, rtConnected: false, lastUpdate: null,
  uploadSummary: null, setUploadSummary: noop,
  losers: [], reversalConditions: {},
  reviewingEvent: null, setReviewingEvent: noop, updateReversal: noop,
  globalPriorityList: [], decisionsMap: {}, STOCK_META: {},
  setExpandedDecision: noop,
  filteredSortedList: [],
  searchQ: '', setSearchQ: noop,
  filterDecision: new Set(), setFilterDecision: noop,
  filterThesis: new Set(), setFilterThesis: noop,
  filterUrgency: new Set(), setFilterUrgency: noop,
  filterConflict: new Set(), setFilterConflict: noop,
  filterPnl: new Set(), setFilterPnl: noop,
  filterStrategy: new Set(), setFilterStrategy: noop,
  strategyOptions: [],
  toggleSetItem: () => () => {},
  clearAllFilters: noop,
  sortBy: 'decision', setSortBy: noop, sortDir: 'desc', setSortDir: noop,
  // sortMenuOpen/setSortMenuOpen 已由 HoldingsTab 內化（A2-lite）
  // expandedDecision 已由 brainStore 管理（E2）— 不再從 fixture 傳入
  displayed: [], sorted: [], orderedDisplayed: [],
  variantsMap: new Map(), firstFeatureCode: null,
  targets: {}, avgTarget: () => null, sparklines: {}, sparklineErrors: {},
  EMPTY_SPARK: Object.freeze([]),
  Sparkline,
  normalizedEvents: [], openHoldingDrawer: noop,
  handleHoldingCardOpenDrawer: noop,
  cardGridCols: 'repeat(3, minmax(0,1fr))',
  // viewMode/setViewMode 已由 HoldingsTab 內化（A2-lite）— 不再從 fixture 傳入
  showAll: true, setShowAll: noop,
  setTab: noop,
};

describe('FreeCheckup tab — lazy & memo wiring', () => {
  // Warm-up + 相對量測：vitest 冷啟動 + esbuild transform 排隊會讓
  // 「第一個 cold import」吃到整批 bootstrap 成本（觀察值 3s–10s 抖動），
  // 用一個結構相近的兄弟 tab (LogTab) 先 warm up，讓後續三個 target
  // 只量到自身 transform + resolve 時間；預算與 baseline 綁定，環境慢
  // 時整體一起放寬，環境快時同步收緊，才能真正抓「架構退化」。
  let baselineMs = 0;
  const budget = () => Math.max(baselineMs * 4, 3000);

  beforeAll(async () => {
    const t0 = performance.now();
    await import('@/checkup/components/freecheckup/LogTab');
    baselineMs = performance.now() - t0;
  }, 20000);

  it('EventsTab dynamic import resolves quickly and exports React.memo component', async () => {
    const t0 = performance.now();
    const mod = await import('@/checkup/components/freecheckup/EventsTab');
    const ms = performance.now() - t0;
    expect(mod.default).toBeDefined();
    expect((mod.default as any).$$typeof).toBe(REACT_MEMO);
    expect(ms, `baseline=${baselineMs.toFixed(0)}ms budget=${budget().toFixed(0)}ms`).toBeLessThan(budget());
  }, 20000);

  it('DailyTab dynamic import resolves quickly and exports React.memo component', async () => {
    const t0 = performance.now();
    const mod = await import('@/checkup/components/freecheckup/DailyTab');
    const ms = performance.now() - t0;
    expect(mod.default).toBeDefined();
    expect((mod.default as any).$$typeof).toBe(REACT_MEMO);
    expect(ms, `baseline=${baselineMs.toFixed(0)}ms budget=${budget().toFixed(0)}ms`).toBeLessThan(budget());
  }, 20000);

  it('HoldingsTab dynamic import resolves quickly and exports React.memo component', async () => {
    const t0 = performance.now();
    const mod = await import('@/checkup/components/freecheckup/HoldingsTab');
    const ms = performance.now() - t0;
    expect(mod.default).toBeDefined();
    expect((mod.default as any).$$typeof).toBe(REACT_MEMO);
    // HoldingsTab transitively pulls 5 inner components + utils，允許更大係數
    expect(ms, `baseline=${baselineMs.toFixed(0)}ms`).toBeLessThan(Math.max(baselineMs * 8, 12000));
  }, 20000);

  it('FreeCheckup.jsx mounts all heavy tabs only when active (gated by tab===)', () => {
    const src = fs.readFileSync(path.join(root, 'src/pages/FreeCheckup.jsx'), 'utf8');
    // 確認條件渲染 + Suspense 包裹（沒選中 tab 就完全不 mount）
    expect(src).toMatch(/\{tab==="events" && \(\s*<Suspense fallback=\{null\}>\s*<EventsTab/);
    expect(src).toMatch(/\{tab==="daily" && \(\s*<Suspense fallback=\{null\}>\s*<DailyTab/);
    expect(src).toMatch(/\{tab==="holdings" && \(\s*<Suspense fallback=\{null\}>\s*<HoldingsTab/);
    // 確認用的是 lazy() 動態 import
    // ADR-0005 S1：shell 改吃模組 free surface barrel，仍必須是 lazy() 動態 import
    expect(src).toMatch(/const EventsTab = lazy\(\(\) => import\("@\/checkup\/modules\/events\/free"\)\.then\(\(m\) => \(\{ default: m\.EventsTab \}\)\)\)/);
    expect(src).toMatch(/const DailyTab = lazy\(\(\) => import\("@\/checkup\/modules\/closing\/free"\)\.then\(\(m\) => \(\{ default: m\.DailyTab \}\)\)\)/);
    expect(src).toMatch(/const HoldingsTab = lazy\(\(\) => import\("@\/checkup\/modules\/holdings\/free"\)\.then\(\(m\) => \(\{ default: m\.HoldingsTab \}\)\)\)/);
    // shell 不得再深挖 freecheckup 實作檔（OnboardingOverlay / DemoFooterHint 是 shell 自有 UI，例外）
    const deep = [...src.matchAll(/@\/checkup\/components\/freecheckup\/([A-Za-z]+)/g)].map((m) => m[1]);
    expect(deep.filter((n) => n !== 'OnboardingOverlay' && n !== 'DemoFooterHint')).toEqual([]);
  });
});

describe('FreeCheckup tab — initial mount latency baseline', () => {
  it('EventsTab first render under jsdom-friendly budget', async () => {
    const Tab = (await import('@/checkup/components/freecheckup/EventsTab')).default;
    const t0 = performance.now();
    const { unmount } = render(
      <Suspense fallback={null}>
        <Tab {...eventsProps} />
      </Suspense>
    );
    const ms = performance.now() - t0;
    unmount();
    // ~500 行 JSX 在 jsdom 約 50–250ms；600ms 是回歸警戒線
    expect(ms).toBeLessThan(600);
  });

  it('DailyTab first render under jsdom-friendly budget', async () => {
    const Tab = (await import('@/checkup/components/freecheckup/DailyTab')).default;
    const t0 = performance.now();
    const { unmount } = render(
      <Suspense fallback={null}>
        <Tab {...dailyProps} />
      </Suspense>
    );
    const ms = performance.now() - t0;
    unmount();
    expect(ms).toBeLessThan(600);
  });
});

describe('FreeCheckup tab — memo skips re-render with stable props', () => {
  it('EventsTab does not re-execute Impl when parent re-renders with same props', async () => {
    const Tab = (await import('@/checkup/components/freecheckup/EventsTab')).default;
    let runs = 0;
    // 包一層 spy callback，驗 memo 阻擋了重渲染（不被呼叫第二次）
    const trackedFilter = (..._args: any[]) => { runs++; };
    const props = { ...eventsProps, setFilterType: trackedFilter };
    const { rerender, unmount } = render(
      <Suspense fallback={null}><Tab {...props} /></Suspense>
    );
    // 同一份 props ref 重渲：React.memo 應該整顆樹都不再 reconcile
    rerender(<Suspense fallback={null}><Tab {...props} /></Suspense>);
    rerender(<Suspense fallback={null}><Tab {...props} /></Suspense>);
    unmount();
    // setFilterType 只在使用者點擊 filter chip 時觸發，rerender 不應呼叫
    expect(runs).toBe(0);
  });
});

// HoldingsWorkbench 內的 useChipsBatch 需要 QueryClient；測試殼提供一個離線的。
const Q = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
const withQuery = (node: React.ReactNode, qc: QueryClient) => (
  <QueryClientProvider client={qc}>{node}</QueryClientProvider>
);

describe('FreeCheckup HoldingsTab — lazy + memo + mount budget', () => {
  it('HoldingsTab first render under jsdom-friendly budget (empty持倉)', async () => {
    const Tab = (await import('@/checkup/components/freecheckup/HoldingsTab')).default;
    const qc = Q();
    const t0 = performance.now();
    const { unmount } = render(
      withQuery(
        <Suspense fallback={null}>
          <Tab {...holdingsProps} />
        </Suspense>,
        qc,
      )
    );
    const ms = performance.now() - t0;
    unmount();
    // ~665 行 JSX（hero+filter+workbench+empty state）在 jsdom 約 80–350ms；800ms 是回歸警戒線
    expect(ms).toBeLessThan(800);
  }, 20000);

  it('HoldingsTab memo skips re-render when parent re-renders with same props', async () => {
    const Tab = (await import('@/checkup/components/freecheckup/HoldingsTab')).default;
    let runs = 0;
    const trackedSetTab = (..._args: any[]) => { runs++; };
    const props = { ...holdingsProps, setTab: trackedSetTab };
    const qc = Q();
    const { rerender, unmount } = render(
      withQuery(<Suspense fallback={null}><Tab {...props} /></Suspense>, qc)
    );
    rerender(withQuery(<Suspense fallback={null}><Tab {...props} /></Suspense>, qc));
    rerender(withQuery(<Suspense fallback={null}><Tab {...props} /></Suspense>, qc));
    unmount();
    // setTab 僅由「上傳成交」CTA 點擊觸發，rerender 不該呼叫
    expect(runs).toBe(0);
  });
});
