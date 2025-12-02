// Domain types for the investment advisory platform

export enum PersonRole {
  ADVISOR = 'ADVISOR',  // 投顧分析師 - licensed, real-time calls
  MENTOR = 'MENTOR'     // 實戰導師 - non-licensed, T+7 content
}

export enum PlanType {
  ANALYST_SIGNAL_L1 = 'ANALYST_SIGNAL_L1',           // 即時策略訂閱
  ANALYST_SIGNAL_DIAG_L2 = 'ANALYST_SIGNAL_DIAG_L2', // 即時策略＋持股健檢
  MENTOR_WEEKLY_JOURNAL = 'MENTOR_WEEKLY_JOURNAL'    // T+7 實戰週記教學
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED'
}

export enum SignalAction {
  BUY = 'BUY',
  SELL = 'SELL',
  ADD = 'ADD',
  TRIM = 'TRIM',
  EXIT = 'EXIT'
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  lineUserId?: string; // Reserved for LINE binding
}

export interface Person {
  id: string;
  slug: string;
  name: string;
  role: PersonRole;
  avatarUrl?: string;
  bio: string;
  description: string;
  styleTags: string[];
  markets: string[];
  riskTolerance?: string;
  timeframe?: string;
  lineChannelId?: string; // Reserved for LINE OA
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
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
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
}

// Extended types with relations for UI
export interface PersonWithPlans extends Person {
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
