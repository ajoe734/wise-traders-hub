/**
 * Pure helpers for exporting mentor weekly journals as Markdown.
 * Extracted from `src/pages/company/JournalsExport.tsx` so both the page
 * and E2E harness can share the same generation logic.
 */
import JSZip from 'jszip';
import { lotsToShares, SHARES_PER_LOT } from '@/lib/lotSize';

export interface JournalRowExport {
  id: string;
  status: string | null;
  instrument: string | null;
  action: string | null;
  price_hint: number | null;
  quantity?: number | null;
  quantity_unit?: string | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string | null;
  created_at: string | null;
  expert_id: string;
  experts?: {
    name: string | null;
    slug: string | null;
    role?: string | null;
    asset_class: string | null;
    currency: string | null;
  } | null;
}

export interface WeekRangeLabels {
  startLabel: string; // YYYY-MM-DD
  endLabel: string;   // YYYY-MM-DD
}

export const ASSET_LABEL: Record<string, string> = {
  tw_stock: '台股',
  us_stock: '美股',
  tw_future: '台指期',
  tw_option: '台指選',
  us_future: '美期',
  us_option: '美選',
  crypto: '加密',
};

// 由 asset_class 決定合法單位；quantity_unit 缺值或不合法時，回退到該類別預設。
// 絕不因缺值退回硬編「股」或「張」。
const UNIT_ALLOWED: Record<string, string[]> = {
  tw_stock: ['張', '股'],
  us_stock: ['股'],
  tw_future: ['口'],
  tw_option: ['口'],
  us_future: ['口'],
  us_option: ['口'],
  crypto: ['顆'],
};
const UNIT_DEFAULT: Record<string, string> = {
  tw_stock: '張',
  us_stock: '股',
  tw_future: '口',
  tw_option: '口',
  us_future: '口',
  us_option: '口',
  crypto: '顆',
};
export function resolveExportUnit(row: JournalRowExport): string {
  const cls = String(row.experts?.asset_class ?? '').trim();
  const raw = String(row.quantity_unit ?? '').trim();
  const allowed = UNIT_ALLOWED[cls];
  if (allowed) {
    if (raw && allowed.includes(raw)) return raw;
    return UNIT_DEFAULT[cls];
  }
  if (raw) return raw;
  const currency = String(row.experts?.currency ?? '').toUpperCase();
  if (currency === 'USD') return '股';
  return '張';
}

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

export function stripHtml(html: string): string {
  return html
    .replace(/<\s*(br|BR)\s*\/?>/g, '\n')
    .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function mdSection(label: string, raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const text = /<[a-z][\s\S]*>/i.test(v) ? stripHtml(v) : v;
  if (!text.trim()) return '';
  return `**${label}**\n\n${text.trim()}\n\n`;
}

export function safeSlug(s: string, fallback: string): string {
  const cleaned = (s || '').normalize('NFKC').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').trim();
  return cleaned || fallback;
}

export function fmtTaipei(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const shifted = new Date(d.getTime() + TZ_OFFSET_MS);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

// 本週總計採「掛出量」口徑：加總本次匯出範圍內、有列出的所有進出場動作。
// 進場側 = buy + add；出場側 = sell + trim + exit。非交易動作（如 hold / 教學筆記）不列入。
const ENTRY_ACTIONS_MD = new Set(['buy', 'add']);
const EXIT_ACTIONS_MD = new Set(['sell', 'trim', 'exit']);
const ACTION_ZH: Record<string, string> = {
  buy: '買進', add: '加碼',
  sell: '賣出', trim: '減碼', exit: '出場',
  hold: '續抱',
};

export function buildMentorMarkdown(mentorRows: JournalRowExport[], range: WeekRangeLabels): string {
  const first = mentorRows[0];
  const name = first.experts?.name ?? '(未命名)';
  const slug = first.experts?.slug ?? first.expert_id;
  const asset = ASSET_LABEL[first.experts?.asset_class ?? ''] ?? (first.experts?.asset_class ?? '');
  const currency = first.experts?.currency ?? '';
  const lines: string[] = [];
  lines.push(`# ${name} 週記`);
  lines.push('');
  lines.push(`- 週別：${range.startLabel} ~ ${range.endLabel}`);
  lines.push(`- Slug：\`${slug}\``);
  lines.push(`- 資產類別：${asset || '-'}`);
  lines.push(`- 幣別：${currency || '-'}`);
  lines.push(`- 則數：${mentorRows.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const entryTotals = new Map<string, number>();
  const exitTotals = new Map<string, number>();
  const entryActionCount = new Map<string, number>();
  const exitActionCount = new Map<string, number>();
  let excludedNoQty = 0;
  let nonTradeRows = 0;

  mentorRows.forEach((r, idx) => {
    const time = fmtTaipei(r.published_at || r.created_at);
    const title = r.reason_summary ? stripHtml(String(r.reason_summary)).slice(0, 80) : (r.instrument || '教學筆記');
    lines.push(`## ${idx + 1}. ${title}`);
    lines.push('');
    const meta: string[] = [];
    if (time) meta.push(`時間：${time}`);
    if (r.status) meta.push(`狀態：${r.status}`);
    if (r.instrument) meta.push(`標的：${r.instrument}`);
    const actionRaw = String(r.action ?? '').toLowerCase();
    if (r.action) meta.push(`動作：${ACTION_ZH[actionRaw] ?? r.action}`);
    if (r.price_hint !== null && r.price_hint !== undefined) meta.push(`參考價：${r.price_hint}`);

    const isEntry = ENTRY_ACTIONS_MD.has(actionRaw);
    const isExit = EXIT_ACTIONS_MD.has(actionRaw);
    const isTrade = isEntry || isExit;

    if (r.quantity !== null && r.quantity !== undefined && r.quantity !== 0) {
      const unit = resolveExportUnit(r);
      const zhAction = ACTION_ZH[actionRaw] ?? '數量';
      meta.push(`${zhAction}數量：${r.quantity} ${unit}`);
      if (isEntry) {
        entryTotals.set(unit, (entryTotals.get(unit) ?? 0) + Number(r.quantity));
        entryActionCount.set(actionRaw, (entryActionCount.get(actionRaw) ?? 0) + 1);
      } else if (isExit) {
        exitTotals.set(unit, (exitTotals.get(unit) ?? 0) + Number(r.quantity));
        exitActionCount.set(actionRaw, (exitActionCount.get(actionRaw) ?? 0) + 1);
      }
    } else if (isTrade) {
      excludedNoQty += 1;
    }
    if (!isTrade) nonTradeRows += 1;

    if (meta.length) { lines.push(meta.map((m) => `- ${m}`).join('\n')); lines.push(''); }
    lines.push(mdSection('重點摘要', r.reason_summary));
    lines.push(mdSection('詳細分析', r.reason_detail));
    lines.push(mdSection('風險提醒', r.risk_notes));
    lines.push(mdSection('學習重點', r.learning_points));
    lines.push(`> 訊號 ID：\`${r.id}\``);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  const fmtActionBreakdown = (m: Map<string, number>) => {
    if (m.size === 0) return '';
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([act, n]) => `${ACTION_ZH[act] ?? act} ${n} 筆`)
      .join('、');
  };

  const pushTotals = (label: string, m: Map<string, number>, breakdown: string) => {
    const suffix = breakdown ? `（${breakdown}）` : '';
    if (m.size === 0) {
      lines.push(`- ${label}${suffix}：無`);
      return;
    }
    if (m.size === 1) {
      const [unit, n] = Array.from(m.entries())[0];
      lines.push(`- ${label}${suffix}：${n} ${unit}`);
      return;
    }
    const entries = Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    lines.push(`- ${label}${suffix}（依單位分列，未換算）：`);
    for (const [unit, n] of entries) {
      lines.push(`  - ${n} ${unit}`);
    }
  };

  lines.push('## 本週總計');
  lines.push('');
  lines.push('> **計算口徑**：僅加總本份週記「有列出的交易訊號」；進場側 = 買進 (buy) + 加碼 (add)，出場側 = 賣出 (sell) + 減碼 (trim) + 出場 (exit)。續抱 / 教學筆記等非交易動作不計入。單位保留原始「張 / 股 / 口」等，不做換算，避免不同商品混算誤導。');
  lines.push('');
  pushTotals('進場側合計 (buy + add)', entryTotals, fmtActionBreakdown(entryActionCount));
  pushTotals('出場側合計 (sell + trim + exit)', exitTotals, fmtActionBreakdown(exitActionCount));
  lines.push('');
  const notes: string[] = [];
  if (nonTradeRows > 0) notes.push(`未計入 ${nonTradeRows} 筆非交易動作（續抱 / 教學筆記等）`);
  if (excludedNoQty > 0) notes.push(`另有 ${excludedNoQty} 筆交易訊號未填數量，已排除於加總`);
  if (notes.length) {
    lines.push(`> 備註：${notes.join('；')}。`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── Export risk gate ─────────────────────────────────────
// 在匯出前檢查資料一致性，若偵測到單位或方向不一致 → 阻擋（block）或提醒（warn）。

export type ExportRiskCode =
  | 'UNIT_MIX'
  | 'UNIT_MISSING'
  | 'DIRECTION_NO_ENTRY'
  | 'DIRECTION_OVERSELL'
  | 'QTY_INVALID'
  | 'PENDING_IN_EXPORT';

export type ExportRiskSeverity = 'block' | 'warn';

export interface ExportRiskIssue {
  code: ExportRiskCode;
  severity: ExportRiskSeverity;
  expert_id: string;
  expert_name?: string | null;
  instrument: string | null;
  detail: string;
  rowIds: string[];
}

export interface ExportRiskReport {
  issues: ExportRiskIssue[];
  blocked: boolean;
  summary: { block: number; warn: number };
  openingBalancesProvided: boolean;
}

export interface DetectExportRisksCtx {
  /** key = `${expert_id}::${instrument}`; value = 股（shares） */
  openingBalances?: Map<string, number>;
  /** publishedOnly=true 時，若仍出現非 published row，會列為 PENDING_IN_EXPORT (warn) */
  publishedOnly?: boolean;
}

const BUY_ACTIONS = new Set(['buy', 'add']);
const SELL_ACTIONS = new Set(['sell', 'trim', 'exit']);
const TRADE_ACTIONS = new Set([...BUY_ACTIONS, ...SELL_ACTIONS]);

export function normalizeQuantityUnit(unit: string | null | undefined): 'lot' | 'share' | 'contract' | 'other' | 'missing' {
  const raw = (unit ?? '').trim();
  if (!raw) return 'missing';
  const s = raw.toLowerCase();
  if (raw === '張' || s === 'lot' || s === 'lots') return 'lot';
  if (raw === '股' || s === 'share' || s === 'shares') return 'share';
  if (raw === '口' || s === 'contract' || s === 'contracts') return 'contract';
  return 'other';
}

/** 折算為「股」；未知單位以 NaN 表達（呼叫端自行決定是否忽略） */
function toShares(qty: number, unit: ReturnType<typeof normalizeQuantityUnit>): number {
  if (unit === 'lot') return lotsToShares(qty);
  if (unit === 'share' || unit === 'missing') return qty;
  return Number.NaN;
}

export function detectExportRisks(
  rows: JournalRowExport[],
  ctx: DetectExportRisksCtx = {},
): ExportRiskReport {
  const issues: ExportRiskIssue[] = [];
  const openingBalancesProvided = !!ctx.openingBalances;

  // 依 (expert_id, instrument) 分桶
  const byKey = new Map<string, { rows: JournalRowExport[]; expertId: string; expertName: string | null; instrument: string | null }>();
  for (const r of rows) {
    const key = `${r.expert_id}::${r.instrument ?? ''}`;
    const g = byKey.get(key) ?? {
      rows: [],
      expertId: r.expert_id,
      expertName: r.experts?.name ?? null,
      instrument: r.instrument,
    };
    g.rows.push(r);
    byKey.set(key, g);
  }

  for (const [key, bucket] of byKey) {
    const { rows: bRows, expertId, expertName, instrument } = bucket;

    // PENDING_IN_EXPORT (warn) — publishedOnly=true 卻含未發布
    if (ctx.publishedOnly) {
      const pending = bRows.filter((r) => (r.status ?? '') !== 'published');
      if (pending.length > 0) {
        issues.push({
          code: 'PENDING_IN_EXPORT',
          severity: 'warn',
          expert_id: expertId,
          expert_name: expertName,
          instrument,
          detail: `含 ${pending.length} 則非 published 狀態訊號（勾了「僅發布」卻仍出現）`,
          rowIds: pending.map((r) => r.id),
        });
      }
    }

    // QTY_INVALID (block) — 交易動作但 qty <= 0 或 NaN
    const invalidQty = bRows.filter((r) => {
      if (!TRADE_ACTIONS.has(String(r.action ?? '').toLowerCase())) return false;
      if (r.quantity === null || r.quantity === undefined) return false;
      const n = Number(r.quantity);
      return !Number.isFinite(n) || n <= 0;
    });
    if (invalidQty.length > 0) {
      issues.push({
        code: 'QTY_INVALID',
        severity: 'block',
        expert_id: expertId,
        expert_name: expertName,
        instrument,
        detail: `${invalidQty.length} 筆交易訊號的數量為 0 或無效數字`,
        rowIds: invalidQty.map((r) => r.id),
      });
    }

    // UNIT_MIX (block) — 同 (expert, instrument) 出現 lot & share 同時存在
    const unitBuckets = new Map<string, JournalRowExport[]>();
    let missingUnitRows: JournalRowExport[] = [];
    for (const r of bRows) {
      if (r.quantity === null || r.quantity === undefined) continue;
      if (!TRADE_ACTIONS.has(String(r.action ?? '').toLowerCase())) continue;
      const u = normalizeQuantityUnit(r.quantity_unit);
      if (u === 'missing') missingUnitRows.push(r);
      const list = unitBuckets.get(u) ?? [];
      list.push(r);
      unitBuckets.set(u, list);
    }
    const hasLot = (unitBuckets.get('lot')?.length ?? 0) > 0;
    const hasShare = (unitBuckets.get('share')?.length ?? 0) > 0;
    if (hasLot && hasShare) {
      const related = [...(unitBuckets.get('lot') ?? []), ...(unitBuckets.get('share') ?? [])];
      issues.push({
        code: 'UNIT_MIX',
        severity: 'block',
        expert_id: expertId,
        expert_name: expertName,
        instrument,
        detail: `同一標的同時使用「張」與「股」兩種單位（張 ${unitBuckets.get('lot')?.length ?? 0} 筆、股 ${unitBuckets.get('share')?.length ?? 0} 筆）`,
        rowIds: related.map((r) => r.id),
      });
    }

    // UNIT_MISSING (warn) — 台股/美股訊號 qty != null 但 unit 空
    if (missingUnitRows.length > 0) {
      const first = missingUnitRows[0];
      const asset = first.experts?.asset_class ?? '';
      if (asset === 'tw_stock' || asset === 'us_stock') {
        issues.push({
          code: 'UNIT_MISSING',
          severity: 'warn',
          expert_id: expertId,
          expert_name: expertName,
          instrument,
          detail: `${missingUnitRows.length} 筆訊號未填寫單位（預設會顯示為「股」，建議明確補齊）`,
          rowIds: missingUnitRows.map((r) => r.id),
        });
      }
    }

    // 方向類：計算 buy vs sell 累計股數
    let buyShares = 0;
    let sellShares = 0;
    let hasEntry = false;
    let hasExit = false;
    const sellRowIds: string[] = [];
    const buyRowIds: string[] = [];
    for (const r of bRows) {
      const action = String(r.action ?? '').toLowerCase();
      if (!TRADE_ACTIONS.has(action)) continue;
      if (r.quantity === null || r.quantity === undefined) continue;
      const qty = Number(r.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const u = normalizeQuantityUnit(r.quantity_unit);
      const shares = toShares(qty, u);
      if (!Number.isFinite(shares)) continue;
      if (BUY_ACTIONS.has(action)) {
        buyShares += shares;
        hasEntry = true;
        buyRowIds.push(r.id);
      } else if (SELL_ACTIONS.has(action)) {
        sellShares += shares;
        hasExit = true;
        sellRowIds.push(r.id);
      }
    }
    const opening = ctx.openingBalances?.get(key) ?? 0;

    // DIRECTION_NO_ENTRY (block) — 只賣未買，且期初庫存 <= 0
    if (hasExit && !hasEntry && opening <= 0) {
      issues.push({
        code: 'DIRECTION_NO_ENTRY',
        severity: 'block',
        expert_id: expertId,
        expert_name: expertName,
        instrument,
        detail: openingBalancesProvided
          ? '本週只有賣出/減碼/出場，且 trade_records 查無期初持倉'
          : '本週只有賣出/減碼/出場（未帶入歷史庫存，僅本批判定）',
        rowIds: sellRowIds,
      });
    }

    // DIRECTION_OVERSELL (block) — 賣超（僅在 openingBalances 提供時判定，避免誤報）
    if (openingBalancesProvided && sellShares > buyShares + opening) {
      issues.push({
        code: 'DIRECTION_OVERSELL',
        severity: 'block',
        expert_id: expertId,
        expert_name: expertName,
        instrument,
        detail: `賣出/減碼合計 ${sellShares} 股 > 買進/加碼 ${buyShares} 股 + 期初 ${opening} 股`,
        rowIds: [...sellRowIds, ...buyRowIds],
      });
    }
  }

  const block = issues.filter((i) => i.severity === 'block').length;
  const warn = issues.filter((i) => i.severity === 'warn').length;
  return {
    issues,
    blocked: block > 0,
    summary: { block, warn },
    openingBalancesProvided,
  };
}

export const EXPORT_RISK_LABEL: Record<ExportRiskCode, string> = {
  UNIT_MIX: '單位混用',
  UNIT_MISSING: '單位缺失',
  DIRECTION_NO_ENTRY: '只賣未買',
  DIRECTION_OVERSELL: '賣超',
  QTY_INVALID: '數量無效',
  PENDING_IN_EXPORT: '含未發布',
};

export function groupRowsByMentor(rows: JournalRowExport[]): Map<string, JournalRowExport[]> {
  const byMentor = new Map<string, JournalRowExport[]>();
  for (const r of rows) {
    const arr = byMentor.get(r.expert_id) ?? [];
    arr.push(r);
    byMentor.set(r.expert_id, arr);
  }
  return byMentor;
}

export type ExportBuildResult =
  | { kind: 'single'; filename: string; blob: Blob; mentorCount: 1; totalRows: number }
  | { kind: 'zip'; filename: string; blob: Blob; files: string[]; mentorCount: number; totalRows: number };

/**
 * Build a downloadable blob for the given rows:
 *  - 1 mentor  → single `.md`
 *  - >1 mentor → `.zip` archive with one `<slug>.md` per mentor
 */
export async function buildJournalExport(
  rows: JournalRowExport[],
  range: WeekRangeLabels,
  publishedOnly: boolean,
): Promise<ExportBuildResult | null> {
  if (rows.length === 0) return null;
  const byMentor = groupRowsByMentor(rows);
  const suffix = publishedOnly ? 'published' : 'all';

  if (byMentor.size === 1) {
    const [[expertId, mentorRows]] = Array.from(byMentor);
    const md = buildMentorMarkdown(mentorRows, range);
    const slug = safeSlug(mentorRows[0].experts?.slug ?? expertId, expertId);
    return {
      kind: 'single',
      filename: `legendflow-journal-${slug}-${range.startLabel}_to_${range.endLabel}_${suffix}.md`,
      blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }),
      mentorCount: 1,
      totalRows: rows.length,
    };
  }

  const zip = new JSZip();
  const files: string[] = [];
  // Dedup: 若不同 expert_id 的 slug 撞名（或 slug 缺失時 fallback expert_id 撞名），
  // 追加 `-<expertId>` 後綴確保 zip 內檔名唯一，避免 JSZip.file() 後者覆蓋前者
  // 造成整份 mentor 週記被吞掉。
  const usedNames = new Set<string>();
  for (const [expertId, mentorRows] of byMentor) {
    const md = buildMentorMarkdown(mentorRows, range);
    const rawSlug = safeSlug(mentorRows[0].experts?.slug ?? expertId, expertId);
    let name = `${rawSlug}.md`;
    if (usedNames.has(name)) {
      const suffix = safeSlug(expertId, expertId);
      name = `${rawSlug}-${suffix}.md`;
      let i = 2;
      while (usedNames.has(name)) {
        name = `${rawSlug}-${suffix}-${i}.md`;
        i += 1;
      }
    }
    usedNames.add(name);
    zip.file(name, md);
    files.push(name);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    kind: 'zip',
    filename: `legendflow-journals-${range.startLabel}_to_${range.endLabel}_${suffix}.zip`,
    blob,
    files,
    mentorCount: byMentor.size,
    totalRows: rows.length,
  };
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
