/**
 * 週記匯出：瀏覽器側入口（zip / blob / 下載）。
 *
 * 生成規則（Markdown、單位、風險偵測）一律來自 @/lib/journalExportCore
 * ——它是 supabase/functions/_shared/journalExportCore.ts 的鏡像，
 * 因此「後台頁面下載的檔案」與「cron 上傳到 storage 的檔案」逐字相同。
 * 本檔只准放瀏覽器專屬的東西（JSZip / Blob / <a download>）。
 */
import JSZip from 'jszip';
import {
  buildMentorMarkdown,
  groupRowsByMentor,
  safeSlug,
  uniqueMentorFilename,
  type JournalRowExport,
  type MentorMarkdownCtx,
  type WeekRangeLabels,
} from '@/lib/journalExportCore';

export {
  ASSET_LABEL,
  buildMentorMarkdown,
  deriveCostBasis,
  deriveOpeningBalances,
  detectExportRisks,
  EXPORT_RISK_LABEL,
  fmtTaipei,
  groupRowsByMentor,
  mdSection,
  normalizeQuantityUnit,
  resolveExportUnit,
  safeSlug,
  stripHtml,
  uniqueMentorFilename,
} from '@/lib/journalExportCore';
export type {
  DetectExportRisksCtx,
  ExportRiskCode,
  ExportRiskIssue,
  ExportRiskReport,
  ExportRiskSeverity,
  JournalRowExport,
  MentorMarkdownCtx,
  OpeningBalanceTradeRecord,
  WeekRangeLabels,
} from '@/lib/journalExportCore';

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
  ctx: MentorMarkdownCtx = {},
): Promise<ExportBuildResult | null> {
  if (rows.length === 0) return null;
  const byMentor = groupRowsByMentor(rows);
  const suffix = publishedOnly ? 'published' : 'all';

  if (byMentor.size === 1) {
    const [[expertId, mentorRows]] = Array.from(byMentor);
    const md = buildMentorMarkdown(mentorRows, range, ctx);
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
  const usedNames = new Set<string>();
  for (const [expertId, mentorRows] of byMentor) {
    const md = buildMentorMarkdown(mentorRows, range, ctx);
    const rawSlug = safeSlug(mentorRows[0].experts?.slug ?? expertId, expertId);
    const name = uniqueMentorFilename(usedNames, rawSlug, expertId);
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
