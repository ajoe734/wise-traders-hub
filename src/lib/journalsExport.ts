/**
 * Pure helpers for exporting mentor weekly journals as Markdown.
 * Extracted from `src/pages/company/JournalsExport.tsx` so both the page
 * and E2E harness can share the same generation logic.
 */
import JSZip from 'jszip';

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
  crypto: '加密',
};

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
  const buyTotals = new Map<string, number>();
  const sellTotals = new Map<string, number>();
  mentorRows.forEach((r, idx) => {
    const time = fmtTaipei(r.published_at || r.created_at);
    const title = r.reason_summary ? stripHtml(String(r.reason_summary)).slice(0, 80) : (r.instrument || '教學筆記');
    lines.push(`## ${idx + 1}. ${title}`);
    lines.push('');
    const meta: string[] = [];
    if (time) meta.push(`時間：${time}`);
    if (r.status) meta.push(`狀態：${r.status}`);
    if (r.instrument) meta.push(`標的：${r.instrument}`);
    if (r.action) meta.push(`動作：${r.action}`);
    if (r.price_hint !== null && r.price_hint !== undefined) meta.push(`參考價：${r.price_hint}`);
    if (r.quantity !== null && r.quantity !== undefined && r.quantity !== 0) {
      const unit = (r.quantity_unit ?? '').trim() || '股';
      const verb = r.action === 'sell' ? '賣出' : r.action === 'buy' ? '買進' : '數量';
      meta.push(`${verb}股數：${r.quantity} ${unit}`);
      if (r.action === 'buy') buyTotals.set(unit, (buyTotals.get(unit) ?? 0) + Number(r.quantity));
      else if (r.action === 'sell') sellTotals.set(unit, (sellTotals.get(unit) ?? 0) + Number(r.quantity));
    }
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
  // 混合單位（例如同時有「張」與「股」）時，分行標註以避免加總語意混淆。
  const pushTotals = (label: string, m: Map<string, number>) => {
    if (m.size === 0) {
      lines.push(`- ${label}：0 股`);
      return;
    }
    if (m.size === 1) {
      const [unit, n] = Array.from(m.entries())[0];
      lines.push(`- ${label}：${n} ${unit}`);
      return;
    }
    // 依單位字典序排序，確保輸出穩定
    const entries = Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    lines.push(`- ${label}（依單位分列）：`);
    for (const [unit, n] of entries) {
      lines.push(`  - ${unit}：${n} ${unit}`);
    }
  };
  lines.push('## 本週總計');
  lines.push('');
  pushTotals('總買進股數', buyTotals);
  pushTotals('總賣出股數', sellTotals);
  lines.push('');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

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
  for (const [expertId, mentorRows] of byMentor) {
    const md = buildMentorMarkdown(mentorRows, range);
    const slug = safeSlug(mentorRows[0].experts?.slug ?? expertId, expertId);
    const name = `${slug}.md`;
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
