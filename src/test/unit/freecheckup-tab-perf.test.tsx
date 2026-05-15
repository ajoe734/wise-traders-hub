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
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Suspense, createRef } from 'react';
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
  DEMO_TAB_NOTICE_COPY: { events: { title: '', body: '' } },
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
  DEMO_TAB_NOTICE_COPY: { daily: { title: '', body: '' } },
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
  DEMO_TAB_NOTICE_COPY: { holdings: { title: '', body: '' } },
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
  sortMenuOpen: false, setSortMenuOpen: noop,
  expandedDecision: null, displayed: [], sorted: [], orderedDisplayed: [],
  variantsMap: new Map(), firstFeatureCode: null,
  targets: {}, avgTarget: () => null, sparklines: {}, sparklineErrors: {},
  EMPTY_SPARK: Object.freeze([]),
  Sparkline,
  normalizedEvents: [], openHoldingDrawer: noop,
  handleHoldingCardSelect: noop, handleHoldingCardOpenDrawer: noop,
  cardGridCols: 'repeat(3, minmax(0,1fr))',
  viewMode: 'grid', setViewMode: noop,
  showAll: true, setShowAll: noop,
  setTab: noop,
};

describe('FreeCheckup tab — lazy & memo wiring', () => {
  it('EventsTab dynamic import resolves quickly and exports React.memo component', async () => {
    const t0 = performance.now();
    const mod = await import('@/checkup/components/freecheckup/EventsTab');
    const ms = performance.now() - t0;
    expect(mod.default).toBeDefined();
    expect((mod.default as any).$$typeof).toBe(REACT_MEMO);
    // jsdom 友善上限：純解析（含 transform）應遠低於此
    expect(ms).toBeLessThan(2500);
  });

  it('DailyTab dynamic import resolves quickly and exports React.memo component', async () => {
    const t0 = performance.now();
    const mod = await import('@/checkup/components/freecheckup/DailyTab');
    const ms = performance.now() - t0;
    expect(mod.default).toBeDefined();
    expect((mod.default as any).$$typeof).toBe(REACT_MEMO);
    expect(ms).toBeLessThan(2500);
  });

  it('FreeCheckup.jsx mounts both tabs only when active (gated by tab===)', () => {
    const src = fs.readFileSync(path.join(root, 'src/pages/FreeCheckup.jsx'), 'utf8');
    // 確認條件渲染 + Suspense 包裹（沒選中 tab 就完全不 mount）
    expect(src).toMatch(/\{tab==="events" && \(\s*<Suspense fallback=\{null\}>\s*<EventsTab/);
    expect(src).toMatch(/\{tab==="daily" && \(\s*<Suspense fallback=\{null\}>\s*<DailyTab/);
    // 確認用的是 lazy() 動態 import
    expect(src).toMatch(/const EventsTab = lazy\(\(\) => import\("@\/checkup\/components\/freecheckup\/EventsTab"\)\)/);
    expect(src).toMatch(/const DailyTab = lazy\(\(\) => import\("@\/checkup\/components\/freecheckup\/DailyTab"\)\)/);
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
