import { INIT_HOLDINGS, INIT_TARGETS, INIT_WATCHLIST, NEWS_EVENTS } from './seedData.js'
import { normalizeWatchlist } from './lib/watchlistUtils.js'

export const MEMO_Q = {
  買進: ['為什麼選這檔？核心邏輯是什麼？', '進場的技術或籌碼依據？', '出場計畫：目標價？停損價？'],
  賣出: ['為什麼在這個價位賣？', '達成原本預期了嗎？', '這筆資金的下一步？'],
  混合: [
    '這批成交的主要調整原因是什麼？',
    '哪些動作屬於計畫內執行，哪些是臨場修正？',
    '這批成交後接下來最需要追蹤的重點是什麼？',
  ],
}

export const PARSE_PROMPT = `你是台股券商成交回報截圖的解析器。解析截圖中的交易，以JSON格式輸出，不輸出其他文字：
{"tradeDate":"成交日期，格式 YYYY/MM/DD，沒有就填 null","trades":[{"action":"買進或賣出","code":"代碼","name":"名稱","qty":股數,"price":成交價,"amount":金額或null,"time":"成交時間，沒有就填空字串","date":"若該筆與 tradeDate 不同，填 YYYY/MM/DD，否則可省略"}],"targetPriceUpdates":[{"code":"代碼","firm":"券商名稱","target":目標價數字,"date":"日期"}],"note":"有疑問時說明","confidence":"high|medium|low"}
交易別判斷規則（極重要）：
- 現買、融買、借資買 → action 一律填「買進」
- 現賣、融賣、借券賣 → action 一律填「賣出」
- 看「交易別」欄位的文字，不要用顏色或其他欄位猜測買賣方向
- 若同一張截圖有多筆成交，請全部列出，不要只取第一筆
- 如果畫面上有實際成交日期，請優先填入 tradeDate；不要默認今天
targetPriceUpdates：如果截圖中有提到分析師目標價或研究報告目標價，請一併擷取。否則為空陣列。`

export const OWNER_PORTFOLIO_ID = 'me'
export const PORTFOLIO_VIEW_MODE = 'portfolio'
export const OVERVIEW_VIEW_MODE = 'overview'
export const API_ENDPOINTS = {
  ANALYZE: '/api/analyze',
  ANALYST_REPORTS: '/api/analyst-reports',
  BRAIN: '/api/brain',
  RESEARCH: '/api/research',
  RESEARCH_EXTRACT: '/api/research-extract',
  TWSE: '/api/twse',
}
export const MARKET_PRICE_CACHE_KEY = 'pf-market-price-cache-v1'
export const MARKET_PRICE_SYNC_KEY = 'pf-market-price-sync-v1'
export const MARKET_TIMEZONE = 'Asia/Taipei'
export const POST_CLOSE_SYNC_MINUTES = 13 * 60 + 35 // 13:35
export const CURRENT_SCHEMA_VERSION = 3
export const PORTFOLIOS_KEY = 'pf-portfolios-v1'
export const ACTIVE_PORTFOLIO_KEY = 'pf-active-portfolio-v1'
export const VIEW_MODE_KEY = 'pf-view-mode-v1'
export const SCHEMA_VERSION_KEY = 'pf-schema-version'
export const CLOUD_SYNC_TTL = 1000 * 60 * 30
export const CLOUD_SAVE_DEBOUNCE = 1000 * 20
export const GLOBAL_SYNC_KEYS = [
  'pf-cloud-sync-at',
  'pf-analysis-cloud-sync-at',
  'pf-research-cloud-sync-at',
]
export const GLOBAL_SYNC_KEY_SET = new Set(GLOBAL_SYNC_KEYS)
export const BACKUP_GLOBAL_KEYS = [
  PORTFOLIOS_KEY,
  ACTIVE_PORTFOLIO_KEY,
  VIEW_MODE_KEY,
  SCHEMA_VERSION_KEY,
]
export const BACKUP_GLOBAL_KEY_SET = new Set(BACKUP_GLOBAL_KEYS)
export const APPLIED_TRADE_PATCHES_KEY = 'pf-applied-trade-patches-v1'
export const DEFAULT_PORTFOLIO_NOTES = {
  riskProfile: '',
  preferences: '',
  customNotes: '',
}
export const EVENT_HISTORY_LIMIT = 90
export const HISTORY_ENTRY_LIMIT = 30
export const REPORT_REFRESH_DAILY_LIMIT = 5
export const REPORT_EXTRACT_MAX_ITEMS = 2
export const BRAIN_VALIDATION_CASE_LIMIT = 240
export const STATUS_MESSAGE_TIMEOUT_MS = {
  BRIEF: 2000,
  QUICK: 2200,
  SHORT: 2500,
  DEFAULT: 3000,
  NOTICE: 3200,
  LONG: 4000,
  EXTENDED: 6000,
}
export const DEFAULT_REVIEW_FORM = {
  actual: 'up',
  actualNote: '',
  lessons: '',
  exitDate: null,
  priceAtExit: null,
}
export const DEFAULT_NEW_EVENT = {
  date: '',
  title: '',
  detail: '',
  stocks: '',
  pred: 'up',
  predReason: '',
}
export const DEFAULT_FUNDAMENTAL_DRAFT = {
  code: '',
  revenueMonth: '',
  revenueYoY: '',
  revenueMoM: '',
  quarter: '',
  eps: '',
  grossMargin: '',
  roe: '',
  source: '',
  updatedAt: '',
  note: '',
}

// ── Phase 0-2: 資料收集與風險管理 ─────────────────────────────

export const DEFAULT_THESIS = {
  id: null,
  stockId: null,
  createdAt: null,
  reason: '',
  expectation: '',
  invalidation: '',
  targetPrice: null,
  stopLossPercent: null,
  status: 'active',
  reviewHistory: [],
}

export const DEFAULT_THESIS_PILLAR = {
  id: null,
  text: '',
  status: 'on_track', // on_track / watch / behind / broken
  trend: 'stable', // up / stable / down
  lastChecked: null,
}

export const DEFAULT_THESIS_RISK = {
  id: null,
  text: '',
  triggered: false,
}

export const PILLAR_STATUSES = ['on_track', 'watch', 'behind', 'broken']
export const PILLAR_TRENDS = ['up', 'stable', 'down']
export const CONVICTION_LEVELS = ['high', 'medium', 'low']
export const UPDATE_LOG_IMPACTS = ['strengthen', 'weaken', 'neutral']
export const UPDATE_LOG_ACTIONS = ['hold', 'add', 'trim', 'exit']

export const CATALYST_TYPES = ['earnings', 'corporate', 'industry', 'macro', 'technical']
export const IMPACT_LEVELS = ['high', 'medium', 'low']

export const DEFAULT_RISK_SETTINGS = {
  totalCapital: null,
  riskPerTrade: 2,
  maxPosition: 30,
  maxSector: 50,
  maxLoss: 10,
  stopLossDefault: 8,
}

export const DATA_FRESHNESS = {
  PRICE: 5 * 60 * 1000,
  INSTITUTIONAL: 24 * 60 * 60 * 1000,
  REVENUE: 30 * 24 * 60 * 60 * 1000,
  CONFERENCE: 7 * 24 * 60 * 60 * 1000,
}

export const STORAGE_KEYS = {
  MARKET_PRICE_CACHE: 'pf-market-price-cache-v1',
  MARKET_PRICE_SYNC: 'pf-market-price-sync-v1',
  INSTITUTIONAL_TRADING: 'pf-institutional-trading-v1',
  MONTHLY_REVENUE: 'pf-monthly-revenue-v1',
  CONFERENCE_SCHEDULE: 'pf-conference-schedule-v1',
  THESIS: 'pf-thesis-v1',
  RISK_SETTINGS: 'pf-risk-settings-v1',
  CONTRIBUTION_POINTS: 'pf-contribution-points-v1',
}
export const TRADE_BACKFILL_PATCHES = [
  {
    // This is an example patch, it should be applied only once
    id: '2026-03-25-sell-039108-5000',
    portfolioId: OWNER_PORTFOLIO_ID,
    expectedQtyAfter: 3000,
    entry: {
      id: 202603250001,
      patchId: '2026-03-25-sell-039108-5000',
      date: '2026/3/25',
      time: '15:00',
      action: '賣出',
      code: '039108',
      name: '禾伸堂元富57購',
      qty: 5000,
      price: 1.9,
      qa: [
        { q: MEMO_Q['賣出'][0], a: '補登 2026/03/25 實際賣出 5000 股，修正 OCR 漏讀。' },
        { q: MEMO_Q['賣出'][1], a: '是，先落袋部分獲利並降低權證時間價值風險。' },
        { q: MEMO_Q['賣出'][2], a: '保留剩餘 3000 股續追蹤，等待下一步配置。' },
      ],
    },
  },
]
export const PORTFOLIO_STORAGE_FIELDS = [
  {
    suffix: 'holdings-v2',
    alias: 'holdings',
    ownerFallback: () => INIT_HOLDINGS,
    emptyFallback: () => [],
  },
  { suffix: 'log-v2', alias: 'tradeLog', ownerFallback: () => [], emptyFallback: () => [] },
  {
    suffix: 'targets-v1',
    alias: 'targets',
    ownerFallback: () => INIT_TARGETS,
    emptyFallback: () => ({}),
  },
  {
    suffix: 'fundamentals-v1',
    alias: 'fundamentals',
    ownerFallback: () => ({}),
    emptyFallback: () => ({}),
    hasLegacy: false,
  },
  {
    suffix: 'watchlist-v1',
    alias: 'watchlist',
    ownerFallback: () => normalizeWatchlist(INIT_WATCHLIST),
    emptyFallback: () => [],
    hasLegacy: false,
  },
  {
    suffix: 'analyst-reports-v1',
    alias: 'analystReports',
    ownerFallback: () => ({}),
    emptyFallback: () => ({}),
    hasLegacy: false,
  },
  {
    suffix: 'report-refresh-meta-v1',
    alias: 'reportRefreshMeta',
    ownerFallback: () => ({}),
    emptyFallback: () => ({}),
    hasLegacy: false,
  },
  {
    suffix: 'holding-dossiers-v1',
    alias: 'holdingDossiers',
    ownerFallback: () => [],
    emptyFallback: () => [],
    hasLegacy: false,
  },
  {
    suffix: 'news-events-v1',
    alias: 'newsEvents',
    ownerFallback: () => NEWS_EVENTS,
    emptyFallback: () => [],
  },
  {
    suffix: 'analysis-history-v1',
    alias: 'analysisHistory',
    ownerFallback: () => [],
    emptyFallback: () => [],
  },
  {
    suffix: 'daily-report-v1',
    alias: 'dailyReport',
    ownerFallback: () => null,
    emptyFallback: () => null,
  },
  {
    suffix: 'reversal-v1',
    alias: 'reversalConditions',
    ownerFallback: () => ({}),
    emptyFallback: () => ({}),
  },
  {
    suffix: 'brain-v1',
    alias: 'strategyBrain',
    ownerFallback: () => null,
    emptyFallback: () => null,
  },
  {
    suffix: 'brain-validation-v1',
    alias: 'brainValidation',
    ownerFallback: () => ({ version: 1, cases: [] }),
    emptyFallback: () => ({ version: 1, cases: [] }),
    hasLegacy: false,
  },
  {
    suffix: 'research-history-v1',
    alias: 'researchHistory',
    ownerFallback: () => [],
    emptyFallback: () => [],
  },
  {
    suffix: 'notes-v1',
    alias: 'portfolioNotes',
    ownerFallback: () => ({ ...DEFAULT_PORTFOLIO_NOTES }),
    emptyFallback: () => ({ ...DEFAULT_PORTFOLIO_NOTES }),
    hasLegacy: false,
  },
]
export const PORTFOLIO_SUFFIX_TO_FIELD = Object.fromEntries(
  PORTFOLIO_STORAGE_FIELDS.map((item) => [item.suffix, item])
)
export const PORTFOLIO_ALIAS_TO_SUFFIX = Object.fromEntries(
  PORTFOLIO_STORAGE_FIELDS.map((item) => [item.alias, item.suffix])
)
export const LEGACY_STORAGE_KEYS = PORTFOLIO_STORAGE_FIELDS.filter(
  (item) => item.hasLegacy !== false
).map((item) => `pf-${item.suffix}`)
export const CLOSED_EVENT_STATUSES = new Set(['past', 'closed'])
export const GLOBAL_STORAGE_KEYS = [...BACKUP_GLOBAL_KEYS, ...GLOBAL_SYNC_KEYS]

export function buildPortfolioRoute(portfolioId = OWNER_PORTFOLIO_ID, tab = 'holdings') {
  return `/portfolio/${portfolioId}/${tab}`
}

export const DEFAULT_PORTFOLIO_ROUTE = buildPortfolioRoute()
