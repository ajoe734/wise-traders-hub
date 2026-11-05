/**
 * 月結薪資匯出列（純函式）。每列一筆本月認列項目，附會員名字與是否「前 20 筆不抽成」。
 * 不匯出 Email／電話。金額直接取 computePayroll 的認列項目，不重算。
 */
import type { PayrollRow } from './expertPayroll';

export interface PayrollExportCtx {
  expertName: (id: string) => string;
  memberName: (subscriptionId: string | null) => string;
  /** 會員去重鍵（user_id）。 */
  memberKey: (subscriptionId: string | null) => string | undefined;
  planName: (subscriptionId: string | null) => string;
  cycle: (subscriptionId: string | null) => string;
  promoTx: Set<string>;
  fmtDate: (iso: string) => string;
}

export const PAYROLL_EXPORT_HEADER = ['老師', '會員名字', '方案', '週期', '付款日', '服務期間', '本月認列期數', '本月認列金額', '前20筆不抽成'];

export function buildPayrollExportRows(rows: PayrollRow[], ctx: PayrollExportCtx): (string | number)[][] {
  const out: (string | number)[][] = [PAYROLL_EXPORT_HEADER];
  let count = 0, total = 0;
  const members = new Set<string>();
  for (const r of rows) {
    for (const it of r.items) {
      const name = ctx.memberName(it.subscription_id) || '未命名';
      members.add(`${r.expert_id}|${ctx.memberKey(it.subscription_id) || it.transaction_id}`);
      out.push([
        ctx.expertName(r.expert_id), name, ctx.planName(it.subscription_id) || '-',
        /year|annual/i.test(ctx.cycle(it.subscription_id)) ? '年繳' : '月繳',
        ctx.fmtDate(it.paid_at), `${ctx.fmtDate(it.paid_at)}~${ctx.fmtDate(it.end_at)}`,
        `${it.k}/${it.n}`, it.amount, ctx.promoTx.has(it.transaction_id) ? '是' : '否',
      ]);
      count++; total += it.amount;
    }
  }
  out.push(['小計', `${members.size} 位會員`, '', '', '', '', `${count} 筆`, Math.round(total * 100) / 100, '']);
  return out;
}
