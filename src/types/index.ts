// Domain types for the investment advisory platform
// All string literal types align with Supabase DB enums

// Expert role — maps to DB enum expert_role
export type ExpertRole = 'advisor' | 'mentor';

// Legacy alias
export type ExpertType = ExpertRole;

// Plan type — maps to DB enum plan_type
export type PlanType = 'analyst_signal_l1' | 'analyst_signal_diag_l2' | 'mentor_weekly_journal';

// Plan level for cleaner typing
export type PlanLevel = 'advisor_L1' | 'advisor_L2' | 'coach_basic';

// Subscription status — maps to DB enum subscription_status
export type SubscriptionStatus = 'active' | 'canceled' | 'expired';

// Signal action — maps to DB enum signal_action
export type SignalAction = 'buy' | 'sell' | 'add' | 'trim' | 'exit';

export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  lineUserId?: string; // Reserved for LINE binding
}

// Expert interface (replacing Person)
export interface Expert {
  id: string;
  slug: string;
  name: string;
  title: '投顧分析師' | '實戰導師';
  type: ExpertRole;
  avatarUrl?: string;
  coverUrl?: string;
  biography: string;
  bio: string; // Short intro
  description: string;
  styleTags: string[];
  markets: string[];
  teachingFocus: string[];
  riskTolerance?: string;
  timeframe?: string;
  lineChannelId?: string; // Reserved for LINE OA
  strategies: StrategySummary[];
}

// Strategy summary for expert profiles
export interface StrategySummary {
  id: string;
  name: string;
  description: string;
  mainMetrics: {
    cumulativeReturn: number;
    annualReturn?: number;
    maxDrawdown?: number;
    sharpe?: number;
  };
}

// Person type — role uses DB string
export interface Person {
  id: string;
  slug: string;
  name: string;
  role: ExpertRole;
  avatarUrl?: string;
  bio: string;
  description: string;
  styleTags: string[];
  markets: string[];
  strategySummary?: string;
  backtestReturn1y?: number | null;
  backtestMaxDrawdown?: number | null;
  backtestAnnualReturn?: number | null;
  riskTolerance?: string;
  timeframe?: string;
  lineChannelId?: string;
  startingCapital?: number | null;
  riskPreference?: string | null;
  operationCycle?: string | null;
  strategyName?: string | null;
  /** experts.asset_class；清單 RPC 不回傳 → 可能為 null。 */
  assetClass?: string | null;
}

export interface TradingSystem {
  id: string;
  personId: string;
  name: string;
  description: string;
  styleTags: string[];
  markets: string[];
  riskProfile?: string;
  holdingPeriod?: string;
  teachingIntro?: string;
  teachingSections?: { title: string; bullets: string[] }[];
}

export interface Plan {
  id: string;
  personId: string;
  systemId?: string;
  planType: PlanType;
  level?: PlanLevel;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  features?: string[];
  isActive: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  startDate: Date;
  endDate: Date;
  renewMode?: string;
}

export interface Signal {
  id: string;
  personId: string;
  systemId: string;
  planType: PlanType;
  strategyName: string;
  instrument: string;
  action: SignalAction;
  priceHint?: string;
  reasonSummary: string;
  reasonDetail: string;
  timeTrade: Date;
  timeVisible: Date;
  createdAt: Date;
  riskNotes: string[];
  positionNotes: string[];
  learningPoints: string[];
  delayedUntil?: Date; // For mentor delayed content
  explanationId?: string; // For XAI reference
}

export interface WeeklyJournal {
  id: string;
  personId: string;
  systemId?: string;
  weekStart: Date;
  weekEnd: Date;
  title: string;
  summary: string;
  learningPoints: string[];
  trades?: JournalTrade[];
}

export interface JournalTrade {
  id: string;
  date: Date;
  instrument: string;
  action: SignalAction;
  reason: string;
  outcome?: string;
  detailedAnalysis?: string; // 詳細分析（修煉派週記擴充欄位）
  lessonsLearned?: string;   // 學習心得（修煉派週記擴充欄位）
}

// Extended types with relations for UI
export interface PersonWithPlans extends Person {
  plans: Plan[];
  tradingSystems: TradingSystem[];
}

export interface ExpertWithPlans extends Expert {
  plans: Plan[];
  tradingSystems: TradingSystem[];
}

export interface SubscriptionWithDetails extends Subscription {
  plan: Plan;
  person: Person;
  system?: TradingSystem;
}

export interface SignalWithPerson extends Signal {
  person: Person;
  system: TradingSystem;
}

export interface JournalWithPerson extends WeeklyJournal {
  person: Person;
  system?: TradingSystem;
}

// Helper function to get expert title from role
export function getExpertTitle(role: ExpertRole): '投顧分析師' | '實戰導師' {
  return role === 'advisor' ? '投顧分析師' : '實戰導師';
}

// Helper function to check if expert is advisor
export function isAdvisor(role: ExpertRole): boolean {
  return role === 'advisor';
}