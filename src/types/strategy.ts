// Strategy & Performance Types - Complete Data Model
// For AI multi-persona system to generate full strategy reports

export type ExpertType = 'advisor' | 'coach';

export type StrategyLevel = 'advisor_t1' | 'advisor_t2' | 'coach_weekly';

export type DelayMode = 'realtime' | 't1' | 't7';

export type PerfPeriod = '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'SI';

export type RiskLevel = '低' | '中' | '高';

export type TradeSide = '多' | '空';

export type TradeAction = '買進' | '賣出' | '加碼' | '減碼' | '停損';

export type AlertLevel = 'info' | 'warning' | 'danger';

export type FactorImpact = 'Low' | 'Medium' | 'High';

export type FactorDirection = '正向' | '反向';

// ============================================
// Core Strategy Interfaces
// ============================================

/** 專家/老師 */
export interface StrategyExpert {
  id: string;
  slug: string;
  type: ExpertType;
  displayName: string;
  title: '投顧分析師' | '實戰導師';
  avatarUrl: string;
  heroImageUrl?: string;
  tagline: string;
  bio: string;
  markets: string[];
  styleTags: string[];
  riskLevel: RiskLevel;
  lineOALink?: string;
  systems: StrategySystem[];
  plans: StrategyPlan[];
}

/** 單一策略／交易系統 */
export interface StrategySystem {
  id: string;
  expertId: string;
  name: string;
  level: StrategyLevel;
  summary: string;
  tags: string[];
  delayMode: DelayMode;

  // ---- 策略層級的績效與風險 ----
  performanceSummary: PerformanceSummary;
  performanceByPeriod: PerformanceSnapshot[];
  equityHistory: EquityPoint[];
  tradeStats: TradeStats;
  riskSummary: RiskSummary;
  xaiSummary: XaiSummary;

  // ---- 現有持股與歷史交易 ----
  positions: Position[];
  recentTrades: Trade[];

  // ---- 教學內容 ----
  teachingIntro?: string;
  teachingSections?: TeachingSection[];
}

export interface TeachingSection {
  title: string;
  bullets: string[];
}

/** 訂閱方案 */
export interface StrategyPlan {
  id: string;
  expertId: string;
  systemId: string;
  level: StrategyLevel;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  features: string[];
  isActive: boolean;
}

// ============================================
// Performance Interfaces
// ============================================

/** 成績單總覽：一眼看到整體表現 */
export interface PerformanceSummary {
  sinceInceptionReturnPct: number;  // 自成立以來累積報酬 (%)
  annualizedReturnPct?: number;     // 年化報酬率 (%)
  maxDrawdownPct: number;           // 最大回撤 (%)
  volatilityPct?: number;           // 報酬波動度 (%)
  sharpeRatio?: number;
  winRatePct?: number;              // 勝率 (%)
  profitFactor?: number;            // 獲利因子 (總贏/總輸)
  tradesCount?: number;             // 交易次數
  avgHoldingDays?: number;          // 平均持有天數
}

/** 分期間成績單：用於表格 1M/3M/6M/1Y/YTD/SI */
export interface PerformanceSnapshot {
  period: PerfPeriod;
  cumulativeReturnPct: number;   // 該期間累積報酬
  annualizedReturnPct?: number;  // 若適用
  maxDrawdownPct?: number;
  volatilityPct?: number;
  sharpeRatio?: number;
  bestMonthReturnPct?: number;
  worstMonthReturnPct?: number;
  tradesCount?: number;
  winRatePct?: number;
}

/** 用於畫 Equity Curve / Drawdown */
export interface EquityPoint {
  date: string;           // ISO date
  equity: number;         // 策略淨值
  benchmarkEquity?: number; // 參考指數淨值
  drawdownPct?: number;   // 當日回撤（for underwater chart）
}

// ============================================
// Position & Trade Interfaces
// ============================================

/** 現有持股：一定要顯示，讓系統看起來真的有在跑 */
export interface Position {
  symbol: string;            // 2330.TW
  name?: string;             // 台積電
  side: TradeSide;
  quantity: number;          // 股數／口數
  avgPrice: number;          // 成本價
  lastPrice: number;         // 最新價（可以是延遲）
  marketValue: number;       // 市值
  pnlAmt: number;            // 未實現損益金額
  pnlPct: number;            // 未實現損益 (%)
  weightPct: number;         // 在此策略中的部位比重 (%)
  sector?: string;           // 產業別
  note?: string;             // 補充說明（例如「示範用」「教學案例」）
}

/** 單筆交易紀錄：給訊號牆＋週回顧＋案例解析用 */
export interface Trade {
  id: string;
  strategyId: string;
  expertId: string;
  openTime: string;          // 建倉時間
  closeTime?: string;        // 平倉時間（未平倉可省略）
  symbol: string;
  name?: string;
  side: TradeAction;
  quantity: number;
  price: number;             // 交易價格
  feeAmt?: number;           // 手續費 / 交易成本
  pnlAmt?: number;           // 本筆已實現損益
  pnlPct?: number;           // 報酬率
  holdingDays?: number;      // 持有天數（平倉後計算）
  reasonShort: string;       // 一句話說明進出場原因
  tags: string[];            // ["突破前高","量能放大"]
}

/** 交易成績拆解：給績效成績單用 */
export interface TradeStats {
  totalTrades: number;
  longTrades: number;
  shortTrades: number;
  winTrades: number;
  loseTrades: number;
  winRatePct: number;
  avgWinPct?: number;
  avgLossPct?: number;
  maxWinPct?: number;
  maxLossPct?: number;
  profitFactor?: number;
  avgRMultiple?: number;       // 平均 R 倍數
  bestTrade?: TradeRef;
  worstTrade?: TradeRef;
}

export interface TradeRef {
  tradeId: string;
  symbol: string;
  pnlPct: number;
  pnlAmt: number;
}

// ============================================
// Risk Interfaces
// ============================================

/** 風險摘要：給風險區與診斷頁用 */
export interface RiskSummary {
  riskLevel: RiskLevel;
  currentExposurePct: number;   // 當前總曝險 %
  grossExposurePct?: number;    // 總多空曝險 %
  netExposurePct?: number;      // 淨曝險 %
  maxSinglePositionPct: number; // 單一標的上限 %
  sectorConcentrationTop?: number; // 最大產業集中度 %
  var1dPct?: number;            // 一日 VaR (%)
  recentAlerts: RiskAlert[];
}

export interface RiskAlert {
  id: string;
  level: AlertLevel;
  title: string;
  description: string;
  createdAt: string;
  resolved?: boolean;
}

// ============================================
// XAI (Explainable AI) Interfaces
// ============================================

/** 策略解釋摘要（XAI） */
export interface XaiSummary {
  lastUpdate: string;
  synopsis: string;               // 一段整體說明
  keyPoints: string[];            // 幾個重點 bullet
  contributingFactors: FactorContribution[];
}

export interface FactorContribution {
  factorId: string;
  name: string;                   // 例如「突破前高 + 放量」
  description: string;            // 教學式解釋
  contributionPct: number;        // 對決策貢獻比例（%）
  impact: FactorImpact;
  direction: FactorDirection;
}

// ============================================
// Weekly Review (Coach)
// ============================================

/** 實戰導師的週回顧資料（每週六發布） */
export interface WeeklyReview {
  id: string;
  expertId: string;
  strategyId: string;
  weekStart: string;   // 週起日
  weekEnd: string;     // 週迄日

  summary: WeeklyReviewSummary;
  equityHistory: EquityPoint[];  // 該週 equity 走勢
  trades: Trade[];               // 本週所有交易
}

export interface WeeklyReviewSummary {
  totalReturnPct: number;
  maxDrawdownPct: number;
  tradesCount: number;
  winRatePct: number;
  bestTrade?: TradeRef;
  worstTrade?: TradeRef;
  comment: string;   // 本週教學重點
}
