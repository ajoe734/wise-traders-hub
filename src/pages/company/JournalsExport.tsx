import { useMemo, useState } from 'react';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import * as journalRepo from '@/lib/journalRepository';
import { toast } from 'sonner';
import { AlertTriangle, Download, FileText, Filter, RotateCw, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  ASSET_LABEL,
  buildJournalExport,
  buildMentorMarkdown,
  detectExportRisks,
  downloadBlob,
  fmtTaipei,
  groupRowsByMentor,
  safeSlug,
  type ExportRiskReport,
  type JournalRowExport,
} from '@/lib/journalsExport';
import { ExportRiskDialog } from '@/components/company/ExportRiskDialog';
import { trackRaw } from '@/lib/analytics/events';
import { taipeiMondayOf, taipeiWeekRangeUtc, taipeiWeekSundayIso } from '@/lib/taipeiWeek';

// ── Taipei week helpers（單一資料源：@/lib/taipeiWeek）───────
function weekRangeUtc(weekStart: string) {
  const { startIso, endIso } = taipeiWeekRangeUtc(weekStart);
  return {
    startIso,
    endIso,
    startLabel: weekStart,
    endLabel: taipeiWeekSundayIso(weekStart),
  };
}

// ── Markdown / download helpers now come from '@/lib/journalsExport' ──
// Keep local helpers only for UI-specific formatting that isn't reused.

type AssetFilter = 'all' | 'tw_stock' | 'us_stock' | 'crypto';
type StatusFilter = 'published_only' | 'all';

interface MentorLite {
  id: string;
  name: string | null;
  slug: string | null;
  asset_class: string | null;
  currency: string | null;
  status: string | null;
}

interface JournalRow {
  id: string;
  status: string | null;
  instrument: string | null;
  action: string | null;
  price_hint: number | null;
  quantity: number | null;
  quantity_unit: string | null;
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
    role: string | null;
    asset_class: string | null;
    currency: string | null;
  } | null;
}

// ── 自動排程與歷史匯出檔區塊 ─────────────────────────────
interface StoredExport {
  path: string;
  name: string;
  week: string;
  size: number | null;
  updatedAt: string | null;
}

interface ExportFailure {
  message: string;      // human short reason (toast title)
  detail?: string;      // extended cause line (banner + toast description)
  source: 'edge' | 'network' | 'payload' | 'server' | 'unknown';
  at: number;
}

/** Best-effort parser for supabase.functions.invoke errors (FunctionsHttpError / FetchError). */
async function describeInvokeError(err: unknown): Promise<{ message: string; detail?: string; source: ExportFailure['source'] }> {
  const anyErr = err as any;
  const name = anyErr?.name ?? '';
  let bodyText: string | undefined;
  try {
    if (anyErr?.context && typeof anyErr.context.text === 'function') {
      bodyText = await anyErr.context.text();
    }
  } catch { /* ignore */ }
  if (name === 'FunctionsHttpError') {
    return {
      message: 'Edge Function 回傳錯誤',
      detail: bodyText?.slice(0, 400) ?? anyErr?.message ?? 'HTTP 非 2xx',
      source: 'edge',
    };
  }
  if (name === 'FunctionsFetchError' || name === 'TypeError') {
    return { message: '無法連線 Edge Function', detail: anyErr?.message ?? '網路異常', source: 'network' };
  }
  return { message: '觸發失敗', detail: anyErr?.message ?? String(err ?? '未知錯誤'), source: 'unknown' };
}

function AutoExportSection() {
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<ExportFailure | null>(null);

  const { data: files = [], isLoading, refetch } = useQuery({
    queryKey: ['company-journals-export', 'storage-history'],
    queryFn: async (): Promise<StoredExport[]> => {
      // 列出所有週資料夾（bucket 根目錄）
      const { data: folders, error } = await supabase.storage
        .from('journal-exports')
        .list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } });
      if (error) throw error;

      const out: StoredExport[] = [];
      for (const f of folders ?? []) {
        if (!f.name || !/^\d{4}-\d{2}-\d{2}$/.test(f.name)) continue;
        const { data: inner } = await supabase.storage
          .from('journal-exports')
          .list(f.name, { limit: 20, sortBy: { column: 'updated_at', order: 'desc' } });
        for (const file of inner ?? []) {
          out.push({
            path: `${f.name}/${file.name}`,
            name: file.name,
            week: f.name,
            size: (file.metadata as any)?.size ?? null,
            updatedAt: file.updated_at ?? file.created_at ?? null,
          });
        }
      }
      return out.sort((a, b) => b.week.localeCompare(a.week));
    },
    staleTime: 60_000,
  });

  const openDownload = async (path: string) => {
    const { data, error } = await supabase.storage
      .from('journal-exports')
      .createSignedUrl(path, 60 * 10); // 10 分鐘臨時連結
    if (error || !data?.signedUrl) {
      toast.error(`取得下載連結失敗：${error?.message ?? '未知錯誤'}`);
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const triggerNow = async () => {
    setRunning(true);
    setFailure(null);
    try {
      const { data, error } = await supabase.functions.invoke('weekly-journal-export', { body: {} });
      if (error) {
        const info = await describeInvokeError(error);
        setFailure({ ...info, at: Date.now() });
        toast.error(info.message, { description: info.detail, duration: 8000 });
        return;
      }
      // 檢查回傳 payload 結構是否合預期
      if (!data || typeof data !== 'object') {
        const info: ExportFailure = {
          message: '匯出回傳異常',
          detail: `Edge Function 沒有回傳 JSON 內容（收到 ${data === null ? 'null' : typeof data}）`,
          source: 'payload',
          at: Date.now(),
        };
        setFailure(info);
        toast.error(info.message, { description: info.detail, duration: 8000 });
        return;
      }
      if ((data as any).ok === false) {
        const info: ExportFailure = {
          message: '匯出流程回報失敗',
          detail: String((data as any).error ?? '未提供錯誤原因'),
          source: 'server',
          at: Date.now(),
        };
        setFailure(info);
        toast.error(info.message, { description: info.detail, duration: 8000 });
        return;
      }
      const journals = Number((data as any).journals ?? 0);
      const mentors = Number((data as any).mentors ?? 0);
      toast.success(`已手動觸發：${journals} 則 / ${mentors} 位老師`);
      refetch();
    } catch (e) {
      const info = await describeInvokeError(e);
      setFailure({ ...info, at: Date.now() });
      toast.error(info.message, { description: info.detail, duration: 8000 });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">4. 自動排程 & 歷史匯出</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            系統於<span className="font-medium text-foreground"> 每週五 23:30 (Asia/Taipei)</span> 自動為當週<strong>每位 mentor 產出一份 Markdown</strong>，
            上傳至受保護的 Storage，並以站內通知連向下方歷史列表。舊檔於 30 天後自動清理。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>重新整理</Button>
          <Button size="sm" onClick={triggerNow} disabled={running} data-testid="je-manual-trigger">
            {running ? '執行中…' : '立即手動觸發'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {failure && (
          <div
            role="alert"
            data-testid="je-manual-error"
            data-error-source={failure.source}
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-destructive">
                    匯出失敗：{failure.message}
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                      來源：{failure.source} · {fmtTaipei(new Date(failure.at).toISOString())}
                    </span>
                  </div>
                  {failure.detail && (
                    <div className="text-xs text-muted-foreground break-all mt-1" data-testid="je-manual-error-detail">
                      {failure.detail}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={triggerNow}
                  disabled={running}
                  className="gap-1"
                  data-testid="je-manual-retry"
                >
                  <RotateCw className="h-3 w-3" /> 重試
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFailure(null)}
                  aria-label="關閉錯誤提示"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        )}
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">載入中…</div>
        ) : files.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            尚無自動匯出紀錄。首次執行為下個週五 23:30，或點「立即手動觸發」測試。
          </div>
        ) : (
          <div className="border rounded-md divide-y">
            {files.map((f) => (
              <div key={f.path} className="flex items-center justify-between px-4 py-2 text-sm gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{f.name}</div>
                  <div className="text-xs text-muted-foreground">
                    週別 {f.week}
                    {f.updatedAt ? ` · 產生於 ${fmtTaipei(f.updatedAt)}` : ''}
                    {f.size ? ` · ${(f.size / 1024).toFixed(1)} KB` : ''}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => openDownload(f.path)} className="gap-1 shrink-0">
                  <Download className="h-3 w-3" /> 下載
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}



const JournalsExport = () => {
  const [weekStart, setWeekStart] = useState<string>(() => taipeiMondayOf(new Date()));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishedOnly, setPublishedOnly] = useState(true);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
  const [selectedMentors, setSelectedMentors] = useState<Set<string>>(new Set());
  const [mdBuilding, setMdBuilding] = useState(false);
  const [mdFailure, setMdFailure] = useState<ExportFailure | null>(null);
  const [previewMentorId, setPreviewMentorId] = useState<string | null>(null);
  // 對話框內每位老師的勾選狀態；null 代表尚未初始化（開啟對話框時預設全選）
  const [dialogSelected, setDialogSelected] = useState<Set<string> | null>(null);
  const [riskReport, setRiskReport] = useState<ExportRiskReport | null>(null);
  const [riskDialogOpen, setRiskDialogOpen] = useState(false);
  const [pendingExportScope, setPendingExportScope] = useState<Set<string> | null>(null);
  const range = useMemo(() => weekRangeUtc(weekStart), [weekStart]);


  // ── 全部 mentor（給下拉多選用；不受週別/資產影響）────
  const { data: mentors = [] } = useQuery({
    queryKey: ['company-journals-export', 'mentors'],
    queryFn: async (): Promise<MentorLite[]> => {
      const { data, error } = await supabase
        .from('experts')
        .select('id, name, slug, asset_class, currency, status')
        .eq('role', 'mentor')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as any as MentorLite[];
    },
    staleTime: 5 * 60_000,
  });

  // ── 該週原始資料（DB 端只做狀態與時間篩選；mentor/資產在 client 過濾）
  const statusFilter: StatusFilter = publishedOnly ? 'published_only' : 'all';

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['company-journals-export', weekStart, statusFilter],
    queryFn: async (): Promise<JournalRow[]> => {
      const { rows, error } = await journalRepo.forExport<JournalRow>(supabase as any, {
        startIso: range.startIso,
        endIso: range.endIso,
        publishedOnly,
      });
      if (error) throw new Error(error);
      return rows;
    },
    staleTime: 30_000,
  });

  const allRows = data ?? [];

  // ── Client-side 篩選 ────────────────────────────────────
  const rows = useMemo(() => {
    return allRows.filter((r) => {
      if (selectedMentors.size > 0 && !selectedMentors.has(r.expert_id)) return false;
      if (assetFilter !== 'all') {
        const ac = r.experts?.asset_class ?? 'tw_stock';
        if (ac !== assetFilter) return false;
      }
      return true;
    });
  }, [allRows, selectedMentors, assetFilter]);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; count: number; assetClass: string }>();
    for (const r of rows) {
      const name = r.experts?.name ?? '(未知)';
      const assetClass = r.experts?.asset_class ?? 'tw_stock';
      const g = m.get(r.expert_id) ?? { name, count: 0, assetClass };
      g.count += 1;
      m.set(r.expert_id, g);
    }
    return Array.from(m.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  }, [rows]);

  // Build per-mentor MD previews for the confirm dialog so users can eyeball
  // the exact content that will be downloaded before committing.
  const previews = useMemo(() => {
    if (rows.length === 0) return [] as { expertId: string; mentorName: string; slug: string; filename: string; md: string; rowCount: number }[];
    const byMentor = groupRowsByMentor(rows as unknown as JournalRowExport[]);
    const singleMentor = byMentor.size === 1;
    const suffix = publishedOnly ? 'published' : 'all';
    const list: { expertId: string; mentorName: string; slug: string; filename: string; md: string; rowCount: number }[] = [];
    for (const [expertId, mentorRows] of byMentor) {
      const md = buildMentorMarkdown(mentorRows, { startLabel: range.startLabel, endLabel: range.endLabel });
      const slug = safeSlug(mentorRows[0].experts?.slug ?? expertId, expertId);
      const filename = singleMentor
        ? `legendflow-journal-${slug}-${range.startLabel}_to_${range.endLabel}_${suffix}.md`
        : `${slug}.md`;
      list.push({
        expertId,
        mentorName: mentorRows[0].experts?.name ?? '(未命名)',
        slug,
        filename,
        md,
        rowCount: mentorRows.length,
      });
    }
    return list.sort((a, b) => a.mentorName.localeCompare(b.mentorName, 'zh-Hant'));
  }, [rows, range.startLabel, range.endLabel, publishedOnly]);

  const activePreview = useMemo(() => {
    if (previews.length === 0) return null;
    return previews.find((p) => p.expertId === previewMentorId) ?? previews[0];
  }, [previews, previewMentorId]);

  const toggleMentor = (id: string) => {
    setSelectedMentors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedMentors(new Set());
    setAssetFilter('all');
    setPublishedOnly(true);
  };

  const activeFilterCount =
    (selectedMentors.size > 0 ? 1 : 0) +
    (assetFilter !== 'all' ? 1 : 0) +
    (!publishedOnly ? 1 : 0);

  const doExportMarkdown = async (mentorFilter?: Set<string>, opts?: { force?: boolean }) => {
    const scoped = mentorFilter && mentorFilter.size > 0
      ? rows.filter((r) => mentorFilter.has(r.expert_id))
      : rows;
    if (scoped.length === 0) {
      toast.warning('目前條件下沒有可匯出的週記（請至少勾選一位老師）');
      return;
    }

    // 風險守門：偵測單位/方向不一致
    if (!opts?.force) {
      const report = detectExportRisks(scoped as unknown as JournalRowExport[], { publishedOnly });
      try {
        trackRaw('journal_export_risk_gate', {
          blocked: report.blocked,
          block: report.summary.block,
          warn: report.summary.warn,
          rows: scoped.length,
          force: false,
        });
      } catch { /* never block export */ }
      if (report.blocked) {
        setRiskReport(report);
        setPendingExportScope(mentorFilter ?? null);
        setRiskDialogOpen(true);
        toast.error(`匯出已阻擋：偵測到 ${report.summary.block} 項高風險資料`, {
          description: '請於對話框中檢視、修正後再匯出，或明確確認後強制匯出。',
          duration: 8000,
        });
        return;
      }
      // 僅有 warn → 直接匯出但保留 report 提示
      if (report.summary.warn > 0) {
        setRiskReport(report);
        toast.warning(`已匯出，另有 ${report.summary.warn} 項提醒`, {
          description: '可按下方「檢視風險提醒」按鈕查看細節。',
          duration: 6000,
        });
      } else {
        setRiskReport(null);
      }
    } else {
      try {
        trackRaw('journal_export_risk_gate', {
          blocked: false,
          block: 0,
          warn: 0,
          rows: scoped.length,
          force: true,
        });
      } catch { /* never block export */ }
    }

    setMdBuilding(true);
    setMdFailure(null);
    try {
      const result = await buildJournalExport(
        scoped as unknown as JournalRowExport[],
        { startLabel: range.startLabel, endLabel: range.endLabel },
        publishedOnly,
      );
      if (!result) {
        const info: ExportFailure = {
          message: '匯出建構回傳空值',
          detail: '同批資料經 buildJournalExport 後無有效輸出，請重試或刷新資料。',
          source: 'payload',
          at: Date.now(),
        };
        setMdFailure(info);
        toast.error(info.message, { description: info.detail, duration: 8000 });
        return;
      }
      downloadBlob(result.filename, result.blob);
      toast.success(`已匯出 ${result.totalRows} 則週記（${result.mentorCount} 位老師 · Markdown）`);
    } catch (e: any) {
      const info: ExportFailure = {
        message: 'Markdown 匯出過程失敗',
        detail: e?.message ?? String(e ?? '未知錯誤'),
        source: 'unknown',
      at: Date.now(),
      };
      setMdFailure(info);
      toast.error(info.message, { description: info.detail, duration: 8000 });
    } finally {
      setMdBuilding(false);
    }
  };

  const handleForceExport = () => {
    setRiskDialogOpen(false);
    void doExportMarkdown(pendingExportScope ?? undefined, { force: true });
  };


  return (
    <CompanyLayout>

      <SEO title="週記匯出 | 公司後台" description="批次匯出實戰導師本週已發布週記" path="/company/journals-export" noindex />
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" /> 週記匯出
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            匯出實戰導師（mentor）於指定週別（週一 00:00 ~ 週日 23:59 Asia/Taipei）之週記為 <strong>Markdown</strong>，每位老師一份獨立檔案（多位老師會打包成 zip）。可依老師、資產類別、發布狀態精準篩選。
          </p>
        </div>

        {/* 週別 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. 選擇週別</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="week-start" className="text-xs">週一（Asia/Taipei）</Label>
                <Input
                  id="week-start"
                  type="date"
                  value={weekStart}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setWeekStart(taipeiMondayOf(new Date(`${v}T12:00:00+08:00`)));
                  }}
                  className="w-[180px]"
                />
              </div>
              <div className="text-sm text-muted-foreground pb-2">
                範圍：<span className="font-medium text-foreground">{range.startLabel}</span> ~ <span className="font-medium text-foreground">{range.endLabel}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setWeekStart(taipeiMondayOf(new Date()))}>本週</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const d = new Date(`${weekStart}T00:00:00+08:00`);
                d.setUTCDate(d.getUTCDate() - 7);
                setWeekStart(taipeiMondayOf(d));
              }}>上一週</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const d = new Date(`${weekStart}T00:00:00+08:00`);
                d.setUTCDate(d.getUTCDate() + 7);
                setWeekStart(taipeiMondayOf(d));
              }}>下一週</Button>
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>重新整理</Button>
            </div>
          </CardContent>
        </Card>

        {/* 篩選條件 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" /> 2. 篩選條件
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1">{activeFilterCount} 項</Badge>
              )}
            </CardTitle>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                <X className="h-3 w-3" /> 清除全部
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-6">
              {/* Mentor 多選 */}
              <div className="space-y-1">
                <Label className="text-xs">實戰導師（可複選）</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="min-w-[220px] justify-between">
                      {selectedMentors.size === 0
                        ? `全部老師（共 ${mentors.length} 位）`
                        : `已選 ${selectedMentors.size} / ${mentors.length} 位`}
                      <Filter className="h-3 w-3 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <div className="p-2 border-b flex items-center justify-between text-xs">
                      <button
                        className="text-primary hover:underline"
                        onClick={() => setSelectedMentors(new Set(mentors.map((m) => m.id)))}
                      >全選</button>
                      <button
                        className="text-muted-foreground hover:underline"
                        onClick={() => setSelectedMentors(new Set())}
                      >清除</button>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto p-1">
                      {mentors.length === 0 ? (
                        <div className="py-4 text-center text-xs text-muted-foreground">尚無實戰導師</div>
                      ) : (
                        mentors.map((m) => {
                          const checked = selectedMentors.has(m.id);
                          const acLabel = ASSET_LABEL[m.asset_class ?? ''] ?? '未設定';
                          return (
                            <label
                              key={m.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                            >
                              <Checkbox checked={checked} onCheckedChange={() => toggleMentor(m.id)} />
                              <span className="flex-1 truncate">{m.name ?? '(未命名)'}</span>
                              <Badge variant="outline" className="text-[10px] px-1 py-0">{acLabel}</Badge>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* 資產類別 */}
              <div className="space-y-1">
                <Label className="text-xs">資產類別</Label>
                <Select value={assetFilter} onValueChange={(v) => setAssetFilter(v as AssetFilter)}>
                  <SelectTrigger className="w-[160px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部資產</SelectItem>
                    <SelectItem value="tw_stock">台股</SelectItem>
                    <SelectItem value="us_stock">美股</SelectItem>
                    <SelectItem value="crypto">加密</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 只匯出已發布 */}
              <div className="space-y-1">
                <Label className="text-xs">發布狀態</Label>
                <div className="flex items-center gap-2 h-9">
                  <Switch id="published-only" checked={publishedOnly} onCheckedChange={setPublishedOnly} />
                  <Label htmlFor="published-only" className="text-sm font-normal cursor-pointer">
                    只匯出「已發布」週記
                  </Label>
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">
                  {publishedOnly
                    ? '範圍以 published_at 為準，排除草稿與撤回。'
                    : '範圍以 created_at 為準，含草稿、撤回、已發布全部狀態。'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 預覽 + 匯出 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">3. 預覽 & 匯出</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                符合條件：<span className="font-semibold text-foreground">{rows.length}</span> 則週記 / <span className="font-semibold text-foreground">{groups.length}</span> 位老師
                {allRows.length !== rows.length && (
                  <span className="ml-2 text-[11px]">（原始 {allRows.length} 則 → 篩選後 {rows.length} 則）</span>
                )}
              </p>
            </div>
            <Button onClick={() => setConfirmOpen(true)} disabled={isLoading || rows.length === 0} className="gap-2">
              <Download className="h-4 w-4" />
              匯出 Markdown
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {mdFailure && (
              <div
                role="alert"
                data-testid="je-md-error"
                data-error-source={mdFailure.source}
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-destructive">
                        匯出失敗：{mdFailure.message}
                        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                          來源：{mdFailure.source} · {fmtTaipei(new Date(mdFailure.at).toISOString())}
                        </span>
                      </div>
                      {mdFailure.detail && (
                        <div className="text-xs text-muted-foreground break-all mt-1" data-testid="je-md-error-detail">
                          {mdFailure.detail}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void doExportMarkdown()}
                      disabled={mdBuilding || isLoading || rows.length === 0}
                      className="gap-1"
                      data-testid="je-md-retry"
                    >
                      <RotateCw className="h-3 w-3" /> 重試
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setMdFailure(null)}
                      aria-label="關閉錯誤提示"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {riskReport && (riskReport.blocked || riskReport.summary.warn > 0) && (
              <div
                role="alert"
                data-testid="je-risk-banner"
                data-blocked={riskReport.blocked ? 'true' : 'false'}
                className={`rounded-md border p-3 text-sm ${
                  riskReport.blocked
                    ? 'border-destructive/40 bg-destructive/5'
                    : 'border-amber-500/40 bg-amber-500/5'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle
                      className={`h-4 w-4 mt-0.5 shrink-0 ${
                        riskReport.blocked ? 'text-destructive' : 'text-amber-600'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className={`font-medium ${riskReport.blocked ? 'text-destructive' : 'text-amber-700'}`}>
                        {riskReport.blocked
                          ? `匯出已阻擋：${riskReport.summary.block} 項高風險`
                          : `匯出已完成，另有 ${riskReport.summary.warn} 項提醒`}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {riskReport.blocked
                          ? '請點右側「檢視風險報告」查看詳細清單與修正建議；修正後可再次匯出，或於報告中確認後強制匯出。'
                          : '警告等級不會阻擋匯出，但建議在報告中檢視後於下次修正。'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant={riskReport.blocked ? 'destructive' : 'outline'}
                      onClick={() => setRiskDialogOpen(true)}
                      data-testid="je-risk-open-report"
                    >
                      檢視風險報告
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRiskReport(null)}
                      aria-label="關閉風險提示"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            )}


            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">載入中…</div>
            ) : groups.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                此條件下沒有任何週記。試試變更週別或清除篩選。
              </div>
            ) : (
              <>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">各老師發文則數</div>
                  <div className="border rounded-md divide-y">
                    {groups.map((g) => (
                      <div key={g.id} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span className="font-medium flex items-center gap-2">
                          {g.name}
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {ASSET_LABEL[g.assetClass] ?? g.assetClass}
                          </Badge>
                        </span>
                        <span className="text-muted-foreground">{g.count} 則</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">週記內容預覽（將全部匯出）</div>
                  <div className="border rounded-md overflow-x-auto max-h-[520px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead className="w-[60px]">#</TableHead>
                          <TableHead>老師</TableHead>
                          <TableHead>資產</TableHead>
                          <TableHead>狀態</TableHead>
                          <TableHead className="whitespace-nowrap">時間</TableHead>
                          <TableHead>標的</TableHead>
                          <TableHead>動作</TableHead>
                          <TableHead className="text-right">參考價</TableHead>
                          <TableHead>重點摘要</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r, i) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium whitespace-nowrap">{r.experts?.name ?? '-'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                {ASSET_LABEL[r.experts?.asset_class ?? ''] ?? '-'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={r.status === 'published' ? 'default' : 'secondary'} className="text-[10px] px-1 py-0">
                                {r.status ?? '-'}
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {fmtTaipei(r.published_at || r.created_at)}
                            </TableCell>
                            <TableCell
                              className="max-w-[240px] min-w-[140px] break-words [overflow-wrap:anywhere] align-top"
                              title={r.instrument ?? ''}
                            >
                              {r.instrument ?? '-'}
                            </TableCell>
                            <TableCell>{r.action ?? '-'}</TableCell>
                            <TableCell className="text-right">{r.price_hint ?? '-'}</TableCell>
                            <TableCell className="max-w-[320px] truncate" title={r.reason_summary ?? ''}>
                              {r.reason_summary ?? '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <AutoExportSection />
      </div>


      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (open) {
            // 開啟時預設全部老師勾選
            setDialogSelected(new Set(previews.map((p) => p.expertId)));
          } else {
            setDialogSelected(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>確認匯出週記 Markdown？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div data-testid="je-confirm-week">週別：<span className="font-medium text-foreground">{range.startLabel} ~ {range.endLabel}</span></div>
                <div>發布狀態：<span className="font-medium text-foreground">{publishedOnly ? '只匯出已發布' : '含全部狀態（草稿/撤回/已發布）'}</span></div>
                <div>資產類別：<span className="font-medium text-foreground">{assetFilter === 'all' ? '全部' : ASSET_LABEL[assetFilter]}</span></div>
                {(() => {
                  const sel = dialogSelected ?? new Set(previews.map((p) => p.expertId));
                  const chosen = previews.filter((p) => sel.has(p.expertId));
                  const chosenRows = chosen.reduce((sum, p) => sum + p.rowCount, 0);
                  const suffix = publishedOnly ? 'published' : 'all';
                  let filenameHint = '';
                  if (chosen.length === 0) {
                    filenameHint = '尚未勾選任何老師';
                  } else if (chosen.length === 1) {
                    filenameHint = `檔名：legendflow-journal-${chosen[0].slug}-${range.startLabel}_to_${range.endLabel}_${suffix}.md`;
                  } else {
                    filenameHint = `檔名：legendflow-journals-${range.startLabel}_to_${range.endLabel}_${suffix}.zip（內含每位老師一份 .md）`;
                  }
                  return (
                    <>
                      <div className="pt-1" data-testid="je-confirm-summary">
                        將為 <span className="font-semibold text-foreground">{chosen.length}</span> / {previews.length} 位老師產出 Markdown
                        （共 <span className="font-semibold text-foreground">{chosenRows}</span> 則週記）。
                      </div>
                      <div className="text-xs text-muted-foreground" data-testid="je-confirm-filename-hint">
                        {filenameHint}
                      </div>
                    </>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {previews.length > 0 && (
            <div className="space-y-2 border-t pt-3" data-testid="je-confirm-preview">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs font-medium text-muted-foreground">
                  勾選要匯出的老師（點文字切換預覽 / 勾選框控制是否納入下載）
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    data-testid="je-dialog-select-all"
                    onClick={() => setDialogSelected(new Set(previews.map((p) => p.expertId)))}
                  >全選</button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:underline"
                    data-testid="je-dialog-clear-all"
                    onClick={() => setDialogSelected(new Set())}
                  >清除</button>
                </div>
              </div>
              {activePreview && (
                <div className="text-[11px] font-mono text-muted-foreground truncate" title={activePreview.filename} data-testid="je-preview-active-filename">
                  預覽中：{activePreview.filename} · {activePreview.md.length.toLocaleString()} 字元
                </div>
              )}
              <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto" role="tablist">
                {previews.map((p) => {
                  const isActive = activePreview?.expertId === p.expertId;
                  const sel = dialogSelected ?? new Set(previews.map((x) => x.expertId));
                  const isChecked = sel.has(p.expertId);
                  return (
                    <div
                      key={p.expertId}
                      className={`flex items-center gap-1 text-xs pl-1.5 pr-2 py-1 rounded border transition ${isActive ? 'border-primary ring-1 ring-primary/40' : 'border-border'} ${isChecked ? 'bg-background' : 'bg-muted/40 opacity-70'}`}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) => {
                          setDialogSelected((prev) => {
                            const base = prev ?? new Set(previews.map((x) => x.expertId));
                            const next = new Set(base);
                            if (v) next.add(p.expertId); else next.delete(p.expertId);
                            return next;
                          });
                        }}
                        aria-label={`匯出 ${p.mentorName}`}
                        data-testid={`je-dialog-mentor-check-${p.slug}`}
                      />
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setPreviewMentorId(p.expertId)}
                        data-testid={`je-preview-tab-${p.slug}`}
                        className={`${isActive ? 'font-medium text-primary' : ''}`}
                      >
                        {p.mentorName} <span className="opacity-70">· {p.rowCount}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
              {activePreview && (
                <pre
                  data-testid="je-preview-content"
                  className="text-[11px] leading-relaxed whitespace-pre-wrap break-words border rounded bg-muted/30 p-3 max-h-[320px] overflow-y-auto font-mono"
                >
                  {activePreview.md.length > 4000
                    ? `${activePreview.md.slice(0, 4000)}\n\n… (已截斷 ${activePreview.md.length - 4000} 字元，實際下載為完整內容)`
                    : activePreview.md}
                </pre>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="je-confirm-download"
              disabled={(dialogSelected?.size ?? previews.length) === 0}
              onClick={() => {
                const sel = new Set(dialogSelected ?? new Set(previews.map((p) => p.expertId)));
                setConfirmOpen(false);
                void doExportMarkdown(sel);
              }}
            >
              確認下載
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ExportRiskDialog
        open={riskDialogOpen}
        onOpenChange={setRiskDialogOpen}
        report={riskReport}
        onForceExport={handleForceExport}
        weekLabel={range.startLabel}
      />
    </CompanyLayout>
  );
};

export default JournalsExport;
