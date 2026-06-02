import type { Json } from '@/integrations/supabase/types';

export interface RunRow {
  id: string;
  knowledge_item_id: string | null;
  status: string;
  win_rate: number | null;
  total_hits: number;
  error_message: string | null;
  run_mode: string;
  created_at: string;
  completed_at: string | null;
  parameters: Json | null;
}

export type StepState = 'done' | 'running' | 'pending' | 'failed' | 'idle';
export interface StepInfo {
  key: string;
  label: string;
  state: StepState;
  detail: string;
  hint?: string;
}

export interface FailedBackfillRow {
  symbol: string;
  yyyymm: string;
  error_message: string | null;
  attempted_at: string | null;
}

export interface NotifyLog {
  created_at: string;
  email_sent: number;
  email_failed: number;
  errors: string[];
}

export interface NotifyLogRow {
  created_at: string;
  payload: { email_sent?: number; email_failed?: number; errors?: unknown } | null;
}

export interface BackfillProgressRow {
  status: string;
}

export interface BackfillSymbolRow {
  symbol: string | null;
  yyyymm: string | null;
}

export interface BackfillSnapshot {
  pending: number;
  done: number;
  empty: number;
  failed: number;
  total: number;
  latest_month: string | null;
  latest_date: string | null;
  current_symbol: string | null;
  current_yyyymm: string | null;
  recent_done_5min: number;
  eta_minutes: number | null;
  last_attempted_at: string | null;
}

export interface KnowledgeItemRow {
  id: string;
  title: string;
}

export interface FailedReason {
  reason: string;
  count: number;
}

export interface MonitorSnapshot {
  runs: RunRow[];
  items: Record<string, { title: string }>;
  failedBackfills: FailedBackfillRow[];
  failedBackfillReasons: FailedReason[];
  notifyLog: NotifyLog | null;
  backfill: BackfillSnapshot | null;
  lastCron: string | null;
}
