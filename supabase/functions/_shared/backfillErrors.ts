// Canonical error codes + structured run logging for the backfill pipeline
// (`backfill-worker`, chip_fact / institutional_daily / fundamentals datasets).
//
// Why: failures used to be free-form strings (`finmind_http_400:...`) scattered
// across console.warn, so "why did this run fail and what did it affect" needed
// log archaeology. Now every failure maps to one of a fixed set of codes and
// every job writes one structured row into `function_run_logs`.

export type BackfillErrorCode =
  | 'ADMISSION_REJECTED'   // quota/circuit admission denied — retryable, job stays pending
  | 'UPSTREAM_HTTP'        // FinMind non-2xx
  | 'UPSTREAM_BAD_JSON'    // FinMind returned non-JSON
  | 'UPSTREAM_API'         // FinMind 200 with error status payload
  | 'UPSTREAM_TIMEOUT'     // fetch aborted / timed out
  | 'UPSTREAM_EMPTY'       // no rows for the whole requested range
  | 'DB_UPSERT'            // writing facts/rollups failed
  | 'MATERIALIZE_FAILED'   // materialize_bsr_daily_from_fact failed for every date
  | 'UNKNOWN_DATASET'      // job.dataset not handled
  | 'JOB_NOT_FOUND'
  | 'KILL_SWITCH'
  | 'INTERNAL';

export interface ClassifiedBackfillError {
  code: BackfillErrorCode;
  /** true → transient; job should go back to pending instead of failed. */
  retryable: boolean;
  /** Raw upstream message, truncated. */
  detail: string;
  /** HTTP status when the failure came from an upstream HTTP call. */
  upstreamStatus?: number;
}

const TRUNCATE = 300;

export function classifyBackfillError(input: unknown): ClassifiedBackfillError {
  const raw = input instanceof Error ? input.message : String(input ?? '');
  const detail = raw.slice(0, TRUNCATE);
  const mk = (code: BackfillErrorCode, retryable: boolean, upstreamStatus?: number) =>
    ({ code, retryable, detail, ...(upstreamStatus ? { upstreamStatus } : {}) }) as ClassifiedBackfillError;

  if (raw.startsWith('admission_rejected')) return mk('ADMISSION_REJECTED', true);
  const http = raw.match(/finmind_http_(\d{3})/);
  if (http) {
    const status = Number(http[1]);
    // 400 = malformed request (our bug, not retryable); 429/5xx = transient.
    return mk('UPSTREAM_HTTP', status === 429 || status >= 500, status);
  }
  if (raw.includes('finmind_bad_json')) return mk('UPSTREAM_BAD_JSON', true);
  if (raw.includes('finmind_api_')) return mk('UPSTREAM_API', true);
  if (/timed? ?out|AbortError|signal timed out/i.test(raw)) return mk('UPSTREAM_TIMEOUT', true);
  if (raw.includes('_all_days_failed')) {
    // Bubble up the nested reason so a whole-range failure keeps its true cause.
    const nested = raw.split('_all_days_failed:')[1] ?? '';
    const inner = nested ? classifyBackfillError(nested) : null;
    if (inner && inner.code !== 'INTERNAL') return { ...inner, detail };
    return mk('UPSTREAM_HTTP', true);
  }
  if (/_upsert:/.test(raw)) return mk('DB_UPSERT', true);
  if (raw.startsWith('materialize_failed')) return mk('MATERIALIZE_FAILED', true);
  if (raw.startsWith('unknown_dataset')) return mk('UNKNOWN_DATASET', false);
  if (raw.startsWith('job_not_found')) return mk('JOB_NOT_FOUND', false);
  if (raw.startsWith('kill_switch')) return mk('KILL_SWITCH', false);
  return mk('INTERNAL', false);
}

/** Blast radius of a single job — what data range/stock was (not) written. */
export interface BackfillImpact {
  dataset: string;
  stock_id: string;
  start_date: string;
  end_date: string;
  /** trading days attempted (chip_fact expands the range day-by-day) */
  days_total?: number;
  days_ok?: number;
  days_failed?: number;
  failed_dates?: string[];
  rows_fetched?: number;
  rows_written?: number;
  materialized_dates?: number;
  materialize_failed_dates?: string[];
}

export type RunLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RunLogRow {
  fn: string;
  run_id: string;
  level: RunLogLevel;
  stage: string;
  msg: string;
  payload: Record<string, unknown>;
}

export interface RunLogger {
  runId: string;
  log: (level: RunLogLevel, stage: string, msg: string, payload?: Record<string, unknown>) => void;
  /** Persist buffered rows into `function_run_logs`. Never throws. */
  flush: () => Promise<void>;
  buffered: () => RunLogRow[];
}

interface MinimalClient {
  from: (table: string) => { insert: (rows: unknown) => Promise<{ error: unknown }> };
}

export function createRunLogger(
  supa: MinimalClient | null,
  fn: string,
  runId: string,
  base: Record<string, unknown> = {},
): RunLogger {
  const buffer: RunLogRow[] = [];
  return {
    runId,
    log(level, stage, msg, payload = {}) {
      const row: RunLogRow = { fn, run_id: runId, level, stage, msg, payload: { ...base, ...payload } };
      buffer.push(row);
      const line = JSON.stringify({ ts: new Date().toISOString(), ...row });
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    },
    buffered: () => buffer.slice(),
    async flush() {
      if (!supa || buffer.length === 0) return;
      const rows = buffer.splice(0, buffer.length);
      try {
        const { error } = await supa.from('function_run_logs').insert(rows);
        if (error) console.warn(`[${fn}] run_log_flush_failed`, error);
      } catch (e) {
        console.warn(`[${fn}] run_log_flush_threw`, (e as Error).message);
      }
    },
  };
}
