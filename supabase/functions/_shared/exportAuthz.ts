// deno-lint-ignore-file no-explicit-any
/**
 * exportAuthz — weekly-journal-export 的授權與 force 風險確認契約（單一資料源）。
 *
 * 安全契約（SECURITY_ACCESS_FIX 2）：
 *  1. 人工觸發一律要求 company_admin：一般登入使用者 → 403 FORBIDDEN_ADMIN。
 *  2. cron 走 X-Cron-Key hybrid；cron 永遠不得 force。
 *  3. force 必須附上 risk_ack_hash，且需與當次實際 block 風險內容的 hash 完全相符，
 *     不符 → 409 RISK_ACK_MISMATCH，且回傳正確 hash 供人工二次確認。
 *     → 舊的「盲目 force:true 直接繞過」路徑已不存在。
 */

import { AuthError, requireCaller, requireCronKey } from './authGuard.ts';
import { ADMIN_FORBIDDEN_MESSAGE, FORBIDDEN_ADMIN, isCompanyAdmin } from './adminGuard.ts';
import type { ExportRiskIssue, ExportRiskReport } from './journalExportCore.ts';

export type ExportCaller =
  | { mode: 'cron'; userId: null }
  | { mode: 'admin'; userId: string };

export interface ResolveCallerDeps {
  requireCronKeyFn?: (req: Request) => void;
  requireCallerFn?: (req: Request) => Promise<string>;
  isCompanyAdminFn?: (userId: string) => Promise<boolean>;
}

/**
 * cron-or-company-admin hybrid。任何其它情況一律丟 AuthError。
 */
export async function resolveExportCaller(req: Request, deps: ResolveCallerDeps = {}): Promise<ExportCaller> {
  const cronFn = deps.requireCronKeyFn ?? requireCronKey;
  const callerFn = deps.requireCallerFn ?? requireCaller;
  const adminFn = deps.isCompanyAdminFn ?? isCompanyAdmin;

  try {
    cronFn(req);
    return { mode: 'cron', userId: null };
  } catch {
    /* fall through to the user lane */
  }

  const userId = await callerFn(req); // throws AuthError(401) when unauthenticated
  const admin = await adminFn(userId);
  if (!admin) {
    throw new AuthError(403, FORBIDDEN_ADMIN, ADMIN_FORBIDDEN_MESSAGE);
  }
  return { mode: 'admin', userId };
}

/** 只取 block 級風險，做穩定排序後的 canonical 形式。 */
export function canonicalBlockingRisks(report: ExportRiskReport | null): Array<Record<string, unknown>> {
  const issues: ExportRiskIssue[] = (report?.issues ?? []).filter((i) => i.severity === 'block');
  return issues
    .map((i) => ({
      code: i.code,
      expert_id: i.expert_id,
      instrument: i.instrument ?? null,
      rowIds: [...(i.rowIds ?? [])].sort(),
    }))
    .sort((a, b) =>
      `${a.code}|${a.expert_id}|${a.instrument}|${a.rowIds.join(',')}`
        .localeCompare(`${b.code}|${b.expert_id}|${b.instrument}|${b.rowIds.join(',')}`)
    );
}

/**
 * 針對「本週實際偵測到的 block 風險」計算 ack hash。
 * 只要風險內容改變（多一筆、少一筆、換一檔），hash 就會改變，舊 ack 立即失效。
 */
export async function computeRiskAckHash(weekStart: string, report: ExportRiskReport | null): Promise<string> {
  const payload = JSON.stringify({ weekStart, blocking: canonicalBlockingRisks(report) });
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type ForceDecision =
  | { allowed: true; forced: boolean }
  | { allowed: false; status: number; code: string; error: string; expected_risk_ack_hash?: string };

export interface ForceCheckInput {
  caller: ExportCaller;
  force: boolean;
  riskAckHash: string | null;
  expectedHash: string;
  blocked: boolean;
}

/**
 * 決定是否放行 force。
 *  - 沒有 block 風險 → force 無意義，直接放行（forced=false）。
 *  - cron 觸發 → 永遠不得 force。
 *  - 有 block 風險且未 force → 由呼叫端回 409 EXPORT_BLOCKED。
 *  - force 但 hash 缺漏／不符 → 409 RISK_ACK_MISSING / RISK_ACK_MISMATCH。
 */
export function decideForce(input: ForceCheckInput): ForceDecision {
  if (!input.blocked) return { allowed: true, forced: false };

  if (!input.force) {
    return {
      allowed: false,
      status: 409,
      code: 'EXPORT_BLOCKED',
      error: '偵測到高風險資料，已阻擋匯出。company_admin 需附上 risk_ack_hash 才能強制匯出。',
      expected_risk_ack_hash: input.expectedHash,
    };
  }

  if (input.caller.mode !== 'admin') {
    return {
      allowed: false,
      status: 403,
      code: 'FORCE_REQUIRES_ADMIN',
      error: '排程觸發不得強制匯出，請由公司管理員人工確認。',
    };
  }

  const provided = (input.riskAckHash ?? '').trim().toLowerCase();
  if (!provided) {
    return {
      allowed: false,
      status: 409,
      code: 'RISK_ACK_MISSING',
      error: 'force 需同時提供 risk_ack_hash。',
      expected_risk_ack_hash: input.expectedHash,
    };
  }
  if (provided !== input.expectedHash.toLowerCase()) {
    return {
      allowed: false,
      status: 409,
      code: 'RISK_ACK_MISMATCH',
      error: 'risk_ack_hash 與目前偵測到的風險內容不符（資料已變動），請重新確認。',
      expected_risk_ack_hash: input.expectedHash,
    };
  }
  return { allowed: true, forced: true };
}
